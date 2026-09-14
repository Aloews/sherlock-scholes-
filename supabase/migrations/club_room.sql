-- ============================================================================
-- Комната болельщиков клуба: обсуждение рядом с составом и новостями.
--
-- Владелец: «добавь комнату болельщиков для команд, где можно было изучить
-- состав команды, новости и обсудить их».
--
-- Две трети этого УЖЕ БЫЛО на `/club/:key` — состав (`club_squad_view`,
-- `club_roster_list`, Soccer Wiki) и новости (`club_news`). Не было третьей:
-- места, где о них говорят. Она здесь.
--
-- ⚠️ ПОЧЕМУ ОТДЕЛЬНАЯ ТАБЛИЦА, А НЕ `assistant_chat`. Тот чат — переписка
-- ОДНОГО человека с моделью: строки видит только автор, и собеседник там не
-- человек. Здесь наоборот: пишут люди, читают все болельщики клуба. Общего у
-- них ровно слово «сообщение».
--
-- ⚠️ ЧИТАТЬ ТОЖЕ ТОЛЬКО ПО initData, И ЭТО НЕ ПЕРЕСТРАХОВКА. В строках стоят
-- имена и аватары живых людей из `players`. `club_news` открыт анониму
-- законно — там чужие заголовки из RSS; здесь были бы наши игроки, и отдать
-- их анонимному ключу, зашитому в бандл, значит отдать их кому угодно.
--
-- ⚠️ ЧТО ЗДЕСЬ НЕ СДЕЛАНО, СКАЗАНО ПРЯМО: модерации нет. Есть длина, есть
-- частота, автор может снести своё. Фильтра брани и жалоб нет — их нельзя
-- сделать «на всякий случай» правильно, а сделать «как-нибудь» хуже, чем не
-- делать: экран обещал бы защиту, которой нет.
-- ============================================================================

create table if not exists public.club_post (
  id         bigint generated always as identity primary key,

  -- Ключ клуба — тот же, что у экрана и у `club_news`: `football_club.club_key`.
  -- Не ссылка на `fan_club`: комната есть у каждого клуба, до того как в нём
  -- завёлся хоть один фан-клуб, и вступление в неё не условие разговора.
  club_key   text   not null,

  author_id  bigint not null references public.players(id) on delete cascade,
  body       text   not null,

  -- Новость, о которой речь. NULL — просто реплика. Ссылка, а не id: лента
  -- общая (`news_items`), живёт сутками и вычищается, а разговор остаётся;
  -- внешний ключ сюда превратил бы уборку ленты в удаление чужих сообщений.
  news_url   text,
  news_title text,

  created_at timestamptz not null default now()
);

comment on table public.club_post is
  'Реплики болельщиков в комнате клуба. Читают все свои, пишут по initData.';

-- Чтение всегда «последние в этом клубе» — индекс ровно под него.
create index if not exists club_post_club_idx
  on public.club_post (club_key, created_at desc);
-- Под ограничение частоты: «сколько я написал за последний час».
create index if not exists club_post_author_idx
  on public.club_post (author_id, created_at desc);

alter table public.club_post enable row level security;
-- Политики нет намеренно: таблица закрыта, ходить в неё можно только через
-- функции ниже — они и проверяют, кто спрашивает.
revoke all on table public.club_post from public, anon, authenticated;
grant select, insert, update, delete on table public.club_post to service_role;

-- ---------------------------------------------------------------------------
-- Что в комнате говорили.
-- ---------------------------------------------------------------------------
create or replace function public.club_room_posts(
  p_init_data text,
  p_club      text,
  p_limit     integer default 50
)
returns table (
  id         bigint,
  body       text,
  news_url   text,
  news_title text,
  created_at timestamptz,
  author_id  bigint,
  author     text,
  avatar_url text,
  mine       boolean
)
language plpgsql security definer set search_path to 'public' as $$
declare
  v_me bigint := tg_validate_init_data(p_init_data);
begin
  if v_me is null then
    raise exception 'invalid init data' using errcode = '28000';
  end if;

  return query
    select p.id, p.body, p.news_url, p.news_title, p.created_at,
           p.author_id,
           -- Имя собирается здесь, а не на экране: у половины игроков нет
           -- фамилии, у части нет и имени — остаётся @username. Собрать это
           -- в трёх местах по-разному значит показать одного человека под
           -- тремя подписями.
           nullif(trim(coalesce(pl.first_name, '') || ' ' || coalesce(pl.last_name, '')), ''),
           pl.avatar_url,
           p.author_id = v_me
      from club_post p
      join players  pl on pl.id = p.author_id
     where p.club_key = p_club
     -- Старые сверху: разговор читается сверху вниз, а не наоборот. Предел
     -- при этом отсекает САМЫЕ СТАРЫЕ, поэтому сначала берём свежие.
     order by p.created_at desc
     limit greatest(1, least(coalesce(p_limit, 50), 200));
end;
$$;

comment on function public.club_room_posts(text, text, integer) is
  'Последние реплики в комнате клуба, свежие первыми. Экран разворачивает.';

-- ---------------------------------------------------------------------------
-- Сказать.
-- ---------------------------------------------------------------------------
create or replace function public.post_club_message(
  p_init_data  text,
  p_club       text,
  p_body       text,
  p_news_url   text default null,
  p_news_title text default null
)
returns bigint
language plpgsql security definer set search_path to 'public' as $$
declare
  v_me   bigint := tg_validate_init_data(p_init_data);
  v_body text   := btrim(coalesce(p_body, ''));
  v_id   bigint;
  v_last timestamptz;
  v_hour integer;
begin
  if v_me is null then
    raise exception 'invalid init data' using errcode = '28000';
  end if;

  -- Клуб обязан существовать. Без этой проверки комнатой можно было бы
  -- объявить любую строку — та же причина, по которой заведён `is_real_club`
  -- у фан-клубов.
  if not exists (select 1 from football_club f where f.club_key = p_club) then
    raise exception 'unknown club' using errcode = '22023';
  end if;

  -- 500 знаков — это длинная мысль, но не статья. Предел нужен не ради
  -- красоты списка: без него одна реплика может весить мегабайт, и читать
  -- комнату станет дорого всем остальным.
  if v_body = '' or length(v_body) > 500 then
    raise exception 'bad body' using errcode = '22023';
  end if;

  -- ⚠️ ЧАСТОТА ОГРАНИЧЕНА ЗДЕСЬ, А НЕ НА ЭКРАНЕ. Кнопка, заблокированная в
  -- интерфейсе, не мешает послать тот же вызов напрямую — ключ anon лежит в
  -- бандле. Два предела о разном: секунды против случайного двойного нажатия
  -- и дрожащей связи, час — против того, кто решил залить комнату.
  select max(created_at), count(*) filter (where created_at > now() - interval '1 hour')
    into v_last, v_hour
    from club_post where author_id = v_me;

  if v_last is not null and v_last > now() - interval '5 seconds' then
    raise exception 'too fast' using errcode = '53400';
  end if;
  if v_hour >= 30 then
    raise exception 'too many' using errcode = '53400';
  end if;

  insert into club_post (club_key, author_id, body, news_url, news_title)
  values (p_club, v_me, v_body, nullif(btrim(coalesce(p_news_url, '')), ''),
          nullif(btrim(coalesce(p_news_title, '')), ''))
  returning id into v_id;
  return v_id;
end;
$$;

comment on function public.post_club_message(text, text, text, text, text) is
  'Реплика в комнате клуба. Проверяет подпись Telegram, клуб, длину и частоту.';

-- ---------------------------------------------------------------------------
-- Убрать своё.
-- ---------------------------------------------------------------------------
create or replace function public.delete_club_message(p_init_data text, p_id bigint)
returns boolean
language plpgsql security definer set search_path to 'public' as $$
declare
  v_me bigint := tg_validate_init_data(p_init_data);
  v_n  integer;
begin
  if v_me is null then
    raise exception 'invalid init data' using errcode = '28000';
  end if;
  -- `author_id = v_me` в самом DELETE, а не проверкой перед ним: проверка и
  -- удаление двумя операторами — это окно, в которое чужая строка может
  -- встать на место своей.
  delete from club_post where id = p_id and author_id = v_me;
  get diagnostics v_n = row_count;
  return v_n > 0;
end;
$$;

comment on function public.delete_club_message(text, bigint) is
  'Автор убирает свою реплику. Чужую не может: условие стоит в самом DELETE.';

-- ---------------------------------------------------------------------------
-- Гранты: таблица закрыта, функции открыты.
-- ---------------------------------------------------------------------------
revoke all on function public.club_room_posts(text, text, integer) from public;
revoke all on function public.post_club_message(text, text, text, text, text) from public;
revoke all on function public.delete_club_message(text, bigint) from public;
grant execute on function public.club_room_posts(text, text, integer) to anon, authenticated, service_role;
grant execute on function public.post_club_message(text, text, text, text, text) to anon, authenticated, service_role;
grant execute on function public.delete_club_message(text, bigint) to anon, authenticated, service_role;
