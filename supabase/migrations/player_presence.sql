-- ============================================================================
-- ПРИСУТСТВИЕ: кто сейчас в приложении.
--
-- ЗАЧЕМ. «Просмотр онлайн игроков и возможность их приглашать в видеочат для
-- совместного просмотра». Приглашения УЖЕ ЕСТЬ целиком — `invite_to_room`,
-- `pending_room_invites`, `decline_room_invite`, — как и связь
-- (LiveKit/Agora/Daily с failover, `VideoStage`). Не было ровно одного: знать,
-- кто сейчас в приложении. Пригласить некого, потому что список пуст.
--
-- ⚠️ ЛИЧНОСТЬ БЕРЁТСЯ ИЗ ПОДПИСАННОЙ initData, А НЕ ИЗ АРГУМЕНТА. Функция с
-- `p_player_id bigint` позволила бы любому пометить онлайн кого угодно и
-- прочитать чужое присутствие — то есть заявить, что человек в приложении,
-- когда его там нет. Идиома та же, что у всех остальных функций проекта:
-- `tg_validate_init_data` и отказ 28000, если подпись не сошлась.
--
-- ⚠️ ЕСТЬ ВЫКЛЮЧАТЕЛЬ, И ЭТО НЕ УКРАШЕНИЕ. Присутствие показывает живого
-- человека другим живым людям. `hidden` даёт уйти из списка, не выходя из
-- приложения; спрятавшийся не виден никому, но сам список видит — иначе
-- «спрятаться» означало бы «ослепнуть», и никто бы этим не пользовался.
--
-- ⚠️ СРОК ЖИЗНИ ОТМЕТКИ КОРОТКИЙ НАМЕРЕННО. Пять минут: клиент стучится раз
-- в минуту, так что пропуск двух-трёх ударов (метро, блокировка экрана) ещё
-- не выкидывает из списка, а закрытое приложение исчезает за минуты. Час
-- показывал бы «онлайн» у тех, кто давно ушёл, и приглашения уходили бы в
-- пустоту — а это хуже пустого списка: пустой честен.
--
-- Гранты перечислены явно: политика без гранта роняла этот проект дважды.
-- ============================================================================

create table if not exists player_presence (
  player_id bigint primary key references players(id) on delete cascade,
  seen_at   timestamptz not null default now(),
  -- Спрятаться из списка, оставаясь в приложении.
  hidden    boolean not null default false
);

comment on table player_presence is
  'Кто сейчас в приложении. Пишется только через touch_presence по подписанной '
  'initData. Читать напрямую нельзя — только online_players.';

create index if not exists player_presence_seen_idx
  on player_presence (seen_at desc) where not hidden;

-- ---------------------------------------------------------------------------
-- Окно «сейчас». Вынесено функцией, чтобы клиент и сервер не разошлись.
-- ---------------------------------------------------------------------------
create or replace function public.presence_window()
returns interval language sql immutable as $$ select interval '5 minutes' $$;

comment on function public.presence_window() is
  'Сколько отметка считается свежей. Клиент стучится раз в минуту: пропуск '
  'двух-трёх ударов не выкидывает из списка, закрытое приложение исчезает.';

-- ---------------------------------------------------------------------------
-- Удар сердца. Зовётся, пока приложение открыто.
-- ---------------------------------------------------------------------------
create or replace function public.touch_presence(p_init_data text, p_hidden boolean default null)
returns void
language plpgsql security definer set search_path to 'public' as $$
declare
  v_me bigint := tg_validate_init_data(p_init_data);
begin
  if v_me is null then
    raise exception 'invalid init data' using errcode = '28000';
  end if;

  insert into player_presence (player_id, seen_at, hidden)
  values (v_me, now(), coalesce(p_hidden, false))
  on conflict (player_id) do update
    -- ⚠️ coalesce, а не голое присваивание: удар сердца НЕ должен сбрасывать
    -- выбор «спрятаться». Клиент шлёт null, когда просто отмечается живым, и
    -- true/false только когда человек сам переключил видимость.
    set seen_at = now(),
        hidden  = coalesce(p_hidden, player_presence.hidden);
end;
$$;

comment on function public.touch_presence(text, boolean) is
  'Отметиться живым. p_hidden = null не трогает видимость — только переключение '
  'человеком её меняет.';

-- ---------------------------------------------------------------------------
-- Кто сейчас в приложении, кроме меня.
-- ---------------------------------------------------------------------------
create or replace function public.online_players(p_init_data text, p_limit int default 40)
returns table (
  player_id  bigint,
  first_name text,
  last_name  text,
  avatar_url text,
  seen_at    timestamptz,
  is_friend  boolean
)
language plpgsql security definer set search_path to 'public' as $$
declare
  v_me bigint := tg_validate_init_data(p_init_data);
begin
  if v_me is null then
    raise exception 'invalid init data' using errcode = '28000';
  end if;

  return query
    select pr.player_id, p.first_name, p.last_name, p.avatar_url, pr.seen_at,
           exists (
             select 1 from friendships f
              where (f.player_id = v_me and f.friend_id = pr.player_id)
                 or (f.player_id = pr.player_id and f.friend_id = v_me)
           ) as is_friend
      from player_presence pr
      join players p on p.id = pr.player_id
     where pr.seen_at > now() - presence_window()
       and not pr.hidden
       -- Себя в списке не показываем: позвать себя нельзя, а строка сбивает счёт.
       and pr.player_id <> v_me
     -- Друзья выше незнакомых: звать идут в первую очередь их.
     order by is_friend desc, pr.seen_at desc
     limit greatest(1, least(p_limit, 100));
end;
$$;

comment on function public.online_players(text, int) is
  'Кто в приложении за последние presence_window(). Спрятавшиеся и я сам не '
  'показываются. Друзья первыми.';

-- ---------------------------------------------------------------------------
-- Гранты. ⚠️ Таблица игрокам НЕ отдаётся: только через функции выше, иначе
-- присутствие можно было бы и прочитать целиком, и записать за другого.
-- ---------------------------------------------------------------------------
revoke all on table player_presence from public, anon, authenticated;
grant select, insert, update on table player_presence to service_role;

revoke all on function public.touch_presence(text, boolean) from public;
revoke all on function public.online_players(text, int) from public;
grant execute on function public.presence_window() to anon, authenticated, service_role;
grant execute on function public.touch_presence(text, boolean) to anon, authenticated, service_role;
grant execute on function public.online_players(text, int) to anon, authenticated, service_role;
