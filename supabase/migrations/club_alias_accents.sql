-- ============================================================================
-- Псевдонимы для имён, которые наш ключ ломает или не узнаёт.
--
-- Нашла `check-prod`: «Bayern München -> никуда (ждали bayern munich);
-- Olympique Marseille -> никуда; Inter Milan -> inter milan (ждали
-- internazionale)».
--
-- ⚠️ ПРИЧИНА У ПЕРВЫХ ДВУХ — НЕ ОПИСКА, А ПОТЕРЯ БУКВЫ. `club_match_key`
-- вырезает всё, кроме [a-z0-9], и «ü» превращается в ПРОБЕЛ, а не в «u»:
-- `club_norm_key('Bayern München')` даёт «bayern m nchen». В справочнике же
-- лежит «bayern munich», и совпасть они не могут никогда.
--
-- Тот же изъян виден и в висячих ссылках: «alav s b», «alcorc n»,
-- «atl tico junior» — это «Alavés B», «Alcorcón», «Atlético Junior» с дыркой
-- на месте буквы.
--
-- ⚠️ ПОЧЕМУ Я НЕ ЧИНЮ `club_match_key` ЗДЕСЬ, ХОТЯ ЭТО КОРЕНЬ. Транслитерация
-- («ü»→«u») поменяет ключ у КАЖДОГО имени с диакритикой, а ключи уже лежат
-- в `football_club.club_key`, в `card_current_club`, в `club_alias` и в
-- ссылках на них. Менять правило без одновременного переименования всего
-- хранимого — это развалить связи молча и разом. Это отдельная работа с
-- переносом, а не строчка в конце вечера.
--
-- Здесь — три имени, у которых тождество не вызывает сомнений, и каждое взято
-- из живого расписания, а не придумано.
-- ============================================================================

insert into club_alias (alias_key, scope, club_key, source)
values
  (club_norm_key('Bayern München'),      '', 'bayern munich',          'check_prod'),
  (club_norm_key('Bayern Munchen'),      '', 'bayern munich',          'check_prod'),
  (club_norm_key('Olympique Marseille'), '', 'olympique de marseille', 'check_prod'),
  (club_norm_key('Inter Milan'),         '', 'internazionale',         'check_prod')
on conflict (alias_key, scope) do update
  set club_key = excluded.club_key, source = excluded.source;
