-- ============================================================================
-- Мини-игра «Чей состав» — 5 имён игроков, угадать клуб.
--
-- Второй кандидат из списка docs/FANTASY_AND_MINIGAMES.md §7 без нового
-- источника: card_current_club (current_squads.sql) уже несёт клуб каждого
-- игрока, deck_squads() уже отбирает клубы с достаточным составом — этой
-- игре нужно было только раунд поверх обеих, тем же приёмом, что и
-- whos_more_famous.sql (§7, «Кто известнее», первый кандидат того же списка).
--
-- ⚠️ СОСТАВ НЕ ЖИВОЙ, И РАУНД ОБЯЗАН ЭТО ГОВОРИТЬ. card_current_club — это
-- клуб, который игрок не покидал на момент последнего чтения его статьи
-- (current_squads.sql), а не сегодняшний список на сайте клуба. Тот файл
-- прямым текстом требует «as of <date>», а не намёка на актуальность —
-- отсюда `fetched_at` в ответе: экран берёт готовый ключ `home.squad_as_of`
-- (уже переведён на все девять языков, используется в DeckPickerScreen для
-- того же самого предупреждения), а не изобретает своё.
--
-- НЕ ФАМИЛИИ, А ПОЛНЫЕ ИМЕНА. FANTASY_AND_MINIGAMES.md описывал раунд как
-- «5 фамилий», но вырезать фамилию из полного имени надёжно нельзя —
-- бразильцы играют под именем, а не фамилией (Винисиус Жуниор, Роналдиньо),
-- и обрубок сломал бы ровно те карточки, что интереснее всего. Имя уже
-- резолвится под язык зрителя, тем же порядком, что и в cardName.ts —
-- версия с фамилиями осталась бы нечестной ради красивой формулировки.
--
-- ОТВЕТ ПРИХОДИТ ВМЕСТЕ С РАУНДОМ, тот же приём, что у quiz_player_round и
-- whos_more_famous_round: игра одиночная, XP не начисляет.
--
-- Честная слабость v1, та же, что и в whos_more_famous.sql: клуб-ответ и три
-- отвлекающих берутся из deck_squads(5) полностью случайно, без выравнивания
-- по узнаваемости или лиге — сосед топ-клуба с равным успехом может
-- оказаться дублем второго дивизиона. Путь A сначала.
-- ============================================================================

create or replace function public.whose_squad_round(p_lang text default 'en')
returns table (
  answer_key text,
  players    jsonb,
  options    jsonb,
  fetched_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_lang   text := lower(left(coalesce(p_lang, 'en'), 2));
  v_answer record;
begin
  select club_key, club, fetched_at into v_answer
    from deck_squads(5)
   order by random()
   limit 1;

  if v_answer.club_key is null then
    return;
  end if;

  return query
    with names as (
      select
        case
          when v_lang = 'ru' then c.name
          when v_lang = 'en' then coalesce(nullif(c.name_en, ''), c.name)
          else coalesce(
            (select ct.name from card_translations ct
              where ct.card_id = c.id and ct.lang = v_lang),
            nullif(c.name_en, ''),
            c.name
          )
        end as display_name
      from card_current_club cc
      join cards c on c.id = cc.card_id and c.active
      where cc.club_key = v_answer.club_key
      order by random()
      limit 5
    ),
    distractors as (
      select club_key, club
        from deck_squads(5)
       where club_key <> v_answer.club_key
       order by random()
       limit 3
    ),
    all_options as (
      select v_answer.club_key as key, v_answer.club as name
      union all
      select club_key, club from distractors
    )
    select
      v_answer.club_key,
      (select jsonb_agg(n.display_name) from names n),
      (select jsonb_agg(jsonb_build_object('key', o.key, 'name', o.name) order by random())
         from all_options o),
      v_answer.fetched_at;
end;
$$;

revoke all on function public.whose_squad_round(text) from public;
grant execute on function public.whose_squad_round(text) to anon, authenticated, service_role;

comment on function public.whose_squad_round(text) is
  'Раунд «Чей состав»: 5 игроков одного клуба (card_current_club) и 4 клуба '
  'на выбор (deck_squads(5)), имена резолвятся под p_lang. fetched_at — для '
  'честного «состав на дату» на экране, состав не живой.';
