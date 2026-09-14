-- ============================================================================
-- ПОЧИНКА КЛУБОВ, КОТОРАЯ ДОЖИВАЕТ ДО УТРА.
--
-- ⚠️ ОБЕ ПРЕДЫДУЩИЕ ПРАВКИ БЫЛИ ВРЕМЕННЫМИ, И НИ ОДНА БЫ НЕ ПЕРЕЖИЛА НОЧЬ.
-- Проверено по расписанию `cron.job`, а не на глаз:
--
--   06:10  rebuild_card_current_clubs   ставит club_key через resolve_club_key
--   06:25  rebuild_clubs_all            → rebuild_football_clubs
--                                          → build_club_aliases()
--                                          → prune_orphan_clubs()
--
-- 1. `build_club_aliases()` НАЧИНАЕТСЯ с `delete from club_alias` и собирает
--    таблицу заново из `club_alias_seed`. Семнадцать псевдонимов, вписанных
--    руками прямо в `club_alias` (десять из `club_alias_dangling_fix.sql` и
--    семь из `club_directory_missing_clubs.sql`), исчезли бы в 06:25, а в
--    06:10 следующего дня карточки снова повисли бы в никуда. Это записано в
--    `docs/MAP.md` ровно как ловушка — и в неё наступили дважды.
--
-- 2. `prune_orphan_clubs()` удаляет клуб, у которого нет ни карточки, ни
--    строки в `club_name_seen`, ни состава, ни матча в расписании. Все
--    двадцать клубов, заведённых прошлой миграцией, подходят под это описание
--    целиком: у них нет ничего, КРОМЕ ссылки из `card_current_club`. То есть
--    прошлая миграция починила висячие ссылки, а ночной обход снёс бы ровно те
--    строки, ради которых она писалась.
--
-- ЧТО СДЕЛАНО.
--
--   а) Все семнадцать псевдонимов перенесены в `club_alias_seed` — только там
--      ручное соответствие переживает пересбор.
--
--   б) `prune_orphan_clubs` научен считать ссылку из `card_current_club`
--      причиной оставить клуб. Это не послабление: `orphan_club_refs`, которой
--      меряется здоровье справочника, СЧИТАЕТ ЭТИ ЖЕ ССЫЛКИ и требует нуля.
--      Две функции противоречили друг другу — одна создавала сирот, вторая на
--      них жаловалась. Теперь обе смотрят на одно и то же.
-- ============================================================================

-- а) Ручные соответствия — в seed, иначе они живут до 06:25.
insert into club_alias_seed (alias_key, scope, club_key, note) values
  -- из club_alias_dangling_fix.sql
  ('zenit saint petersburg',    '', 'zenit st petersburg',   'одна команда, два написания'),
  ('mainz 05',                  '', '1 fsv mainz 05',        'одна команда, два написания'),
  ('torpedo moscow',            '', 'torpedo moskva',        'одна команда, два написания'),
  ('oviedo',                    '', 'real oviedo',           'короткое и полное имя'),
  ('reims',                     '', 'stade de reims',        'короткое и полное имя'),
  ('kortrijk',                  '', 'kv kortrijk',           'короткое и полное имя'),
  ('pari nn',                   '', 'pari nizhny novgorod',  'короткое и полное имя'),
  ('kamaz naberezhnye chelny',  '', 'kamaz',                 'короткое и полное имя'),
  ('yenisey krasnoyarsk',       '', 'enisey',                'одна команда, два написания'),
  ('gefle',                     '', 'efle',                  'ключ без диакритики: Gefle'),
  -- из club_directory_missing_clubs.sql
  ('dynamo moscow',             '', 'dinamo moscow',         'одна команда, два написания'),
  ('al duhail',                 '', 'al duhayl',             'одна команда, два написания'),
  ('real sociedad b',           '', 'real sosedad b',        'дубль под русским транслитом'),
  ('villarreal b',              '', 'vilyarreal b',          'дубль под русским транслитом'),
  ('bilbao athletic',           '', 'atletik b',             'дубль под русским транслитом'),
  ('daejeon hana citizen',      '', 'daejeon citizen',       'переименован в 2020'),
  ('chungbuk cheongju',         '', 'cheongju',              'переименован при выходе в K2')
on conflict (alias_key, scope) do nothing;

-- б) Клуб, на который указывает карточка, — не сирота.
create or replace function prune_orphan_clubs()
returns integer
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_count integer;
begin
  -- ⚠️ КЛЮЧИ РАСПИСАНИЯ СЧИТАЮТСЯ ОДИН РАЗ. Наивная версия звала
  -- resolve_club_key() внутри NOT EXISTS, то есть на каждую пару
  -- «клуб × фикстура»: 1743 × 589 × 2 ≈ 2 млн вызовов, и прогон не
  -- укладывался в минуту. Здесь их 1178.
  create temporary table _fixture_keys on commit drop as
    select distinct resolve_club_key(t.team, null) as club_key
      from (select home_team as team from fixtures
            union select away_team from fixtures) t
     where t.team is not null;
  create index on _fixture_keys (club_key);

  delete from football_club f
   where f.card_id is null
     and not exists (select 1 from club_name_seen s where s.club_key = f.club_key)
     and not exists (select 1 from club_squad q where q.club_key = f.club_key)
     and not exists (select 1 from _fixture_keys x where x.club_key = f.club_key)
     -- ⚠️ ЭТИХ ДВУХ СТРОК НЕ ХВАТАЛО, И ИМЕННО ОНИ ДЕЛАЛИ СИРОТ. Клуб,
     -- записанный карточке как текущий, удалялся здесь — а `orphan_club_refs`
     -- потом считала получившиеся ссылки в никуда и краснела в `check-prod`.
     -- Двадцать клубов низших и неевропейских лиг держатся только этой
     -- ссылкой: ни матчей, ни состава, ни карточки у них нет.
     and not exists (select 1 from card_current_club cc where cc.club_key = f.club_key)
     and not exists (select 1 from card_current_club cc where cc.resolved_key = f.club_key);

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
