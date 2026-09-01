-- ===========================================================================
-- Трансферы как событие — «сейчас разгар трансферов, такие события нужно
-- указывать».
--
-- ⚠️ ГЛАВНОЕ ОГРАНИЧЕНИЕ, И ОНО НЕ ПРИДИРКА. `club_squad.joined_at` значит
-- РАЗНОЕ у разных источников, и в одной колонке это не видно:
--
--   source = 'wikidata'    — дата перехода из Викиданных (P580). НАСТОЯЩАЯ.
--   source = 'wiki_career' — ДАТА МАТЧА, а не перехода.
--   source = 'matches'     — дата первого матча за клуб.
--
-- Замер 01.09.2026, из-за которого это здесь и написано: у `wiki_career`
-- нашлось десять дат, на каждой 20+ игроков. 23.08 «пришли» 29 игроков из 14
-- НЕСВЯЗАННЫХ клубов — а в этот день сыграно 70 матчей. Тапсоба, Бонифейс и
-- Шик «перешли» в «Байер» в один день, играя там годами.
--
-- Поэтому фильтр по source ОБЯЗАТЕЛЕН. Без него лента объявила бы трансфером
-- каждый тур целиком, и выглядело бы это совершенно правдоподобно — списком
-- знакомых имён с вчерашней датой.
--
-- Откуда пришёл — из ЗАКРЫТОЙ строки того же игрока: сборщик закрывает
-- прежний состав (left_at) до вставки нового. Клуба может не быть (первое
-- появление игрока в составах) — тогда это «пришёл в», а не «перешёл из».
-- ===========================================================================
create or replace function public.recent_transfers(
  p_days  integer default 45,
  p_lang  text    default 'ru',
  p_limit integer default 20
)
returns table (
  card_id   uuid,
  name      text,
  level     smallint,
  to_key    text,
  to_club   text,
  to_crest  text,
  from_key  text,
  from_club text,
  moved_at  date
)
language sql stable security definer set search_path = public as $$
  select s.card_id,
         c.name,
         pl.level,
         s.club_key,
         club_display_name(s.club_key, p_lang),
         f.crest_url,
         prev.club_key,
         case when prev.club_key is null then null
              else club_display_name(prev.club_key, p_lang) end,
         s.joined_at
    from club_squad s
    join cards c on c.id = s.card_id and c.active and c.category = 'player'
    left join football_club f on f.club_key = s.club_key
    left join player_level pl on pl.card_id = s.card_id
    -- Прежний клуб: последняя ЗАКРЫТАЯ строка с ДРУГИМ клубом. Условие про
    -- другой клуб не formality: сборщик закрывает и переоткрывает строку в том
    -- же клубе при обновлении состава, и без него каждое такое обновление
    -- читалось бы как переход «из Арсенала в Арсенал».
    left join lateral (
      select p.club_key
        from club_squad p
       where p.card_id = s.card_id
         and p.left_at is not null
         and p.club_key <> s.club_key
       order by p.left_at desc
       limit 1
    ) prev on true
   where s.left_at is null
     and s.source = 'wikidata'
     and s.joined_at is not null
     and s.joined_at >= current_date - greatest(coalesce(p_days, 45), 1)
     and s.joined_at <= current_date
   -- Сперва заметные: владелец просил «особенно дорогих игроков». Уровень —
   -- то же число, что на карточке и в рейтинге, а не отдельная мера.
   order by pl.level desc nulls last, s.joined_at desc, c.name
   limit greatest(coalesce(p_limit, 20), 1);
$$;

-- Грант перечислен ЯВНО: политика без гранта роняла этот проект дважды.
revoke all on function public.recent_transfers(integer, text, integer) from public;
grant execute on function public.recent_transfers(integer, text, integer)
  to anon, authenticated, service_role;
