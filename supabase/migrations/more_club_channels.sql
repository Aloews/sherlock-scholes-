-- ============================================================================
-- Ещё двадцать шесть официальных каналов клубов.
--
-- Владелец: «добавь другие официальные ютуб каналы команд».
--
-- Место под них освободила `clips_hourly_scores_live.sql`: перевод всех
-- каналов на почасовой опрос уронил расход с 6768 единиц в сутки до 2688 из
-- 10 000. Каждый новый канал при почасовом опросе стоит 48 единиц, двадцать
-- шесть — 1248; итого 3936, 39% квоты.
--
-- ⚠️ КАЖДЫЙ ХЭНДЛ РАЗРЕШЁН В ИДЕНТИФИКАТОР И ПРОЧИТАН ГЛАЗАМИ, И ТРИ ИЗ
-- СОРОКА ДВУХ ПРОВЕРКУ НЕ ПРОШЛИ. Это не перестраховка: в этой же таблице уже
-- лежит строка `EFL`, где @-имя разрешилось в чужой канал, а неделей раньше
-- `@SPL` оказался каналом про уход за бассейнами. Отбраковка 09.09.2026:
--
--   * `@officialnffc` — «Nottingham Forest fans Club in Việt Nam».
--     Фан-канал, а не клуб. Название читается как официальное ровно до того
--     момента, пока его не прочтёшь целиком;
--   * `@azalkmaar` — «zdfbadfg fsafgadfg». Хэндл занят мусорным аккаунтом;
--   * `@wolves` — «This channel doesn't have any content». Пусто.
--
-- Ещё тринадцать хэндлов отдали 404 и потому не заведены вовсе: Crystal
-- Palace, Everton, Athletic Club, Atalanta, Fiorentina, Bologna, VfB
-- Stuttgart, Union Berlin, Mönchengladbach, Lille, Rennes, Red Bull Salzburg,
-- Braga. Угадывать их @-имена дальше — это ровно тот путь, которым в таблицу
-- попадает канал про бассейны.
--
-- ⚠️ ЧЕТЫРЕ КАНАЛА ЗАВЕДЕНЫ С ОГОВОРКОЙ, И ОНА НАПИСАНА В `note`. У Real
-- Sociedad, Torino, Bayer Leverkusen и Eintracht Frankfurt описание канала —
-- умолчание YouTube («Share your videos with friends…»), то есть подтверждает
-- их только совпадение хэндла с именем клуба. Проверять их надо ПО СОДЕРЖИМОМУ
-- после первого прогона, а не по названию.
-- ============================================================================

insert into public.digest_source (kind, name, ref, lang, needs_key, enabled, wanted, note)
values
  ('channel', 'Newcastle United',    'UCywGl_BPp9QhD0uAcP2HsJw', null, true, true, true, 'youtube.com/@nufc — «Newcastle United»'),
  ('channel', 'Aston Villa',         'UCICNP0mvtr0prFwGUQIABfQ', null, true, true, true, 'youtube.com/@avfcofficial — «Aston Villa Football Club»'),
  ('channel', 'West Ham United',     'UCCNOsmurvpEit9paBOzWtUg', null, true, true, true, 'youtube.com/@westhamunited — «West Ham United FC»'),
  ('channel', 'Brighton',            'UCf-cpC9WAdOsas19JHipukA', null, true, true, true, 'youtube.com/@officialbhafc — «Official Brighton & Hove Albion FC»'),
  ('channel', 'Fulham',              'UC2VLfz92cTT8jHIFOecC-LA', null, true, true, true, 'youtube.com/@fulhamfc — «Fulham Football Club»'),
  ('channel', 'Brentford',           'UCAalMUm3LIf504ItA3rqfug', null, true, true, true, 'youtube.com/@brentfordfc — «Brentford Football Club»'),
  ('channel', 'Bournemouth',         'UCeOCuVSSweaEj6oVtJZEKQw', null, true, true, true, 'youtube.com/@afcbournemouth — «AFC Bournemouth»'),
  ('channel', 'Leeds United',        'UCyQcJHDN4uYfPa1DHzKVSnw', null, true, true, true, 'youtube.com/@leedsunited — «official YouTube channel of Leeds United»'),
  ('channel', 'Villarreal',          'UC0MLWyQ0L7uEZY8wbkDSTkw', null, true, true, true, 'youtube.com/@villarrealcf — «Villarreal CF»'),
  ('channel', 'Celta Vigo',          'UCCJLVZYqRb_85b2Flpg04cg', null, true, true, true, 'youtube.com/@rccelta — «RC Celta»'),
  ('channel', 'Lazio',               'UCVtDCsB0UlIkDn2kjsva3WA', null, true, true, true, 'youtube.com/@officialsslazio — «The official S.S. Lazio YouTube channel»'),
  ('channel', 'Udinese',             'UCbz89vmhZ0uerNuVKxur9lA', null, true, true, true, 'youtube.com/@udinesecalcio — «Udinese Calcio»'),
  ('channel', 'VfL Wolfsburg',       'UCfdfDFNp50xLjAjD0TKOa4g', null, true, true, true, 'youtube.com/@vflwolfsburg — «VfL Wolfsburg»'),
  ('channel', 'Werder Bremen',       'UCdjedrfgyFQEkqbkq1DJf3w', null, true, true, true, 'youtube.com/@werderbremen — «Werder Bremen»'),
  ('channel', 'SC Freiburg',         'UC_atVJpGbIdjIa9OC6E3yJA', null, true, true, true, 'youtube.com/@scfreiburg — «SC Freiburg»'),
  ('channel', 'Monaco',              'UCHy548EHHX9f-ETJlm18Jiw', null, true, true, true, 'youtube.com/@asmonaco — «AS MONACO»'),
  ('channel', 'Nice',                'UCAvm8jHWe-8K2kZK-7ynIHA', null, true, true, true, 'youtube.com/@ogcnice — «webtv officielle de OGC Nice»'),
  ('channel', 'Lens',                'UCE-f1Taamum6q2S-Ve4koSw', null, true, true, true, 'youtube.com/@rclens — «chaîne YouTube officielle du RC Lens»'),
  ('channel', 'Celtic',              'UCBN-bb-hE7jYlcp4exwXRsQ', null, true, true, true, 'youtube.com/@celticfc — «official Celtic YouTube channel»'),
  ('channel', 'Rangers',             'UCVaGyBPoEAZItDjlFPsRcSA', null, true, true, true, 'youtube.com/@rangersfc — «Rangers Football Club (Official)»'),
  ('channel', 'Club Brugge',         'UCr4sbmZGQY9T4p4KcknxSNw', null, true, true, true, 'youtube.com/@clubbrugge — «Club Brugge»'),
  ('channel', 'Trabzonspor',         'UCnZoe1ncVK7ApLBPfpZ_LEA', null, true, true, true, 'youtube.com/@trabzonspor — «Trabzonspor»'),
  ('channel', 'Real Sociedad',       'UCkNMta6lLRCaOuXl3t9iG-w', null, true, true, true, 'youtube.com/@realsociedad. ОГОВОРКА: описание канала — умолчание YouTube, подтверждает только совпадение хэндла. Проверить по содержимому.'),
  ('channel', 'Torino',              'UC1Xkk7IdUz3Syk3mwLv3eQQ', null, true, true, true, 'youtube.com/@torinofc1906. ОГОВОРКА: описание — умолчание YouTube. Проверить по содержимому.'),
  ('channel', 'Bayer Leverkusen',    'UC_DjAsoxu-gvjAahj0yiZJw', null, true, true, true, 'youtube.com/@bayer04fussball. ОГОВОРКА: описание — умолчание YouTube. Проверить по содержимому.'),
  ('channel', 'Eintracht Frankfurt', 'UCYV07xyw76ptF6GMosaVnHA', null, true, true, true, 'youtube.com/@eintrachtfrankfurt. ОГОВОРКА: описание — умолчание YouTube. Проверить по содержимому.')
on conflict (kind, ref) do update
  set wanted = true, name = excluded.name, note = excluded.note;

-- Отбракованные остаются с причиной — по правилу шапки digest_sources.sql.
insert into public.digest_source (kind, name, ref, lang, needs_key, enabled, wanted, note)
values
  ('channel', 'Nottingham Forest (фан-канал)', 'UCWJpSxxlgtYPsBk_bElrB5Q', null, true, false, false,
   'НЕ КЛУБ. youtube.com/@officialnffc разрешается в «Nottingham Forest fans Club in Việt Nam» — фан-канал. Хэндл выглядит официальным целиком до того, как прочтёшь название.'),
  ('channel', 'Wolverhampton (пусто)', 'UC3HQsXVXXt3cCoSL_aYiC5w', null, true, false, false,
   'ПУСТО. youtube.com/@wolves — «This channel doesn''t have any content».'),
  ('channel', 'AZ Alkmaar (занятый хэндл)', 'UCTCO3NaW_heI8H6U7f43Now', null, true, false, false,
   'НЕ КЛУБ. youtube.com/@azalkmaar разрешается в «zdfbadfg fsafgadfg» — мусорный аккаунт на занятом хэндле.')
on conflict (kind, ref) do update set wanted = false, enabled = false, note = excluded.note;

-- Раскладка по группам заново — иначе новые каналы легли бы все в умолчание 0
-- и опрашивались каждый прогон, ровно против того, о чём просили.
update public.digest_source d
   set poll_group = g.grp
  from (
    select id, (row_number() over (order by id) % 6)::int + 1 as grp
      from public.digest_source
     where kind = 'channel' and wanted
  ) g
 where d.id = g.id;
