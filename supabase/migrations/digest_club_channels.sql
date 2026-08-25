-- ============================================================================
-- 47 КЛУБНЫХ КАНАЛОВ + РОТАЦИЯ ОПРОСА.
--
-- ЗАЧЕМ. Жалоба: «хайлайты с Челси набрали 1.7 млн просмотров, а в дайджест не
-- попали». Причина простая: в digest_source не было НИ ОДНОГО клубного канала
-- — только девять лиг. Всё, что клуб выкладывает у себя (а Челси, Реал и
-- Барселона выкладывают обзоры своих матчей раньше и чаще лиги), дайджест не
-- видел вовсе.
--
-- ⚠️ ПОЧЕМУ НЕЛЬЗЯ ПРОСТО ДОБАВИТЬ 47 СТРОК. Квота YouTube — 10 000 единиц в
-- сутки, и она уже посчитана в schedule_football_digest.sql: fetchClipsViaApi
-- тратит ДВЕ единицы на канал (playlistItems + videos.list part=statistics),
-- прогон идёт каждые 10 минут, то есть 144 раза в сутки.
--
--   9 лиг                    18 ед./прогон   2 592 в сутки   26%
--   9 лиг + 47 клубов       112 ед./прогон  16 128 в сутки  161%  ← мимо
--
-- То есть наивное добавление не «немного дороже», а ГАРАНТИРОВАННАЯ остановка
-- дайджеста каждый день после обеда, причём тихая: квота кончается, вызовы
-- начинают возвращать ошибку, лента просто перестаёт пополняться.
--
-- РЕШЕНИЕ — poll_group. Лиги остаются в группе 0 и опрашиваются КАЖДЫЙ прогон:
-- они и есть свежесть. Клубы разложены по группам 1..6, и за прогон берётся
-- ровно одна группа — то есть каждый клуб опрашивается РАЗ В ЧАС.
--
--   9 лиг + 8 клубов         34 ед./прогон   4 896 в сутки   49%
--
-- Час задержки для клубного обзора — не потеря: клуб выкладывает его через
-- десятки минут после матча, и лишние полчаса ничего не решают. Квота решает.
--
-- ⚠️ КАНАЛЫ ПРОВЕРЕНЫ ПО СОДЕРЖИМОМУ, А НЕ ПО ХЭНДЛУ. В этой же таблице лежит
-- выключенная строка EFL с пометкой: «@EFL разрешается в канал с заголовком
-- efl строчными — тёзка». Поэтому каждый из 50 присланных адресов разрешён в
-- UC-идентификатор, а потом ПРОВЕРЕН по своей RSS-ленте: сколько роликов,
-- когда последний, о чём они. Отсев получился крупный и он показателен:
--
--   @BocaJuniorsOficial → «♠Androtecnologi♠», распаковка Xbox 360, 2014
--   @olympiacos         → «Daniel Evangelopoulos», 2 ролика, «Warzone», 2021
--   @REDSOFFICIAL       → «Martin Habasque», 2 ролика, 2011
--   @AlNassrFC          → 7 роликов, последний 2010 год
--   @AlhilalFC          → последний ролик 2012 год
--   @DynamoKyiv         → НОЛЬ роликов, 2007
--
-- Шесть занятых или брошенных адресов из пятидесяти. Проверка по названию их
-- бы НЕ поймала: «AlNassrFC» и «alhilalfc» называются правильно. Ловит только
-- вопрос «а что этот канал выкладывает».
--
-- Для шести из них нашлись настоящие каналы под другими хэндлами (Шахтёр,
-- Марсель, Аль-Хиляль, Олимпиакос, Динамо Киев, Ан-Наср). Не нашлись три:
-- Байер Леверкузен, Бока Хуниорс и Урава Ред Даймондс — их в этой миграции
-- НЕТ, и это лучше, чем подписаться на тёзку. Для них нужен прямой адрес вида
-- youtube.com/channel/UC… от владельца.
--
-- Отдельно: @urawa_reds ПРОШЁЛ автоматическую проверку на свежесть (ролики
-- новые, их много) и всё равно отвергнут вручную — это канал «ゆん» с
-- переводами корейских песен. Свежесть доказывает, что канал жив, а не что он
-- тот самый; последнее слово остаётся за глазами.
--
-- Гранты у таблицы не меняются: пишет её только service_role.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Группа опроса. 0 — каждый прогон (лиги), 1..6 — по одной группе за прогон.
-- ---------------------------------------------------------------------------
alter table digest_source
  add column if not exists poll_group smallint not null default 0;

comment on column digest_source.poll_group is
  'Ротация опроса ради квоты YouTube. 0 — каждый прогон (лиги). 1..6 — раз в '
  'час: football-digest берёт группу floor(minute/10) mod 6 + 1. Считано в '
  'digest_club_channels.sql: 47 клубов каждый прогон стоили бы 161% квоты.';

-- ---------------------------------------------------------------------------
-- Клубы. needs_key = true: без ключа они не опрашиваются вовсе — Atom-путь
-- закрыт robots.txt YouTube, и 47 каналов по нему ходить тем более нельзя.
-- ---------------------------------------------------------------------------
insert into digest_source (kind, name, ref, lang, needs_key, enabled, poll_group, note)
select v.kind, v.name, v.ref, null, v.needs_key, v.enabled, v.poll_group, v.note
  from (values
    ('channel', 'Ajax', 'UCGpf7WX7R1one-NwOvg_PbQ', true, true, 1, 'youtube.com/@AFCAjax'),
    ('channel', 'Al Ahly', 'UCA86pBGxVPZGrTeTecOtjew', true, true, 2, 'youtube.com/@alahly'),
    ('channel', 'Al Hilal', 'UChM_8YeNCava2-OSbgbpe_w', true, true, 3, 'youtube.com/@Alhilal'),
    ('channel', 'Al Nassr', 'UCHEQtltsiDd3p8ga-5nC-ow', true, true, 4, 'youtube.com/@AlNassrSaudi'),
    ('channel', 'Arsenal', 'UCpryVRk_VDudG8SHXgWcG0w', true, true, 5, 'youtube.com/@arsenal'),
    ('channel', 'Atletico Madrid', 'UCuzKFwdh7z2GHcIOX_tXgxA', true, true, 6, 'youtube.com/@atleticodemadrid'),
    ('channel', 'Barcelona', 'UC14UlmYlSNiQCBe9Eookf_A', true, true, 1, 'youtube.com/@FCBarcelona'),
    ('channel', 'Bayern Munchen', 'UCZkcxFIsqW5htimoUQKA0iA', true, true, 2, 'youtube.com/@fcbayern'),
    ('channel', 'Benfica', 'UC8zrah5cNf2c3jKKeD_Z3fw', true, true, 3, 'youtube.com/@SLBenfica'),
    ('channel', 'Besiktas', 'UCLJVUlpsxZcIMECVDcZaM2g', true, true, 4, 'youtube.com/@Besiktas'),
    ('channel', 'Borussia Dortmund', 'UCK8rTVgp3-MebXkmeJcQb1Q', true, true, 5, 'youtube.com/@BVB'),
    ('channel', 'Chelsea', 'UCU2PacFf99vhb3hNiYDmxww', true, true, 6, 'youtube.com/@chelseafc'),
    ('channel', 'Club America', 'UC3j75twE_C1Y3TKgkN2iffA', true, true, 1, 'youtube.com/@ClubAmerica'),
    ('channel', 'Corinthians', 'UCqRraVICLr0asn90cAvkIZQ', true, true, 2, 'youtube.com/@corinthians'),
    ('channel', 'Dynamo Kyiv', 'UC0yD2Aw5-HOYUyZCu7hyR9Q', true, true, 3, 'youtube.com/@fcdk'),
    ('channel', 'Fenerbahce', 'UCgqlho3-8a6FmDqQm7Q6gJw', true, true, 4, 'youtube.com/@Fenerbahce'),
    ('channel', 'Feyenoord', 'UCg_DGzRRIQlXpHxCrMMiAIQ', true, true, 5, 'youtube.com/@Feyenoord'),
    ('channel', 'Flamengo', 'UCOa-WaNwQaoyFHLCDk7qKIw', true, true, 6, 'youtube.com/@Flamengo'),
    ('channel', 'Galatasaray', 'UCQpeujIamj2ZOKXZnrxTRhA', true, true, 1, 'youtube.com/@Galatasaray'),
    ('channel', 'Gremio', 'UCHKbUAiKHsWCCZrkDY_PZ8Q', true, true, 2, 'youtube.com/@Gremio'),
    ('channel', 'Independiente', 'UCvjX3jBp_iLCZCpKqlXhHDw', true, true, 3, 'youtube.com/@Independiente'),
    ('channel', 'Inter', 'UCvXzEblUa0cfny4HAJ_ZOWw', true, true, 4, 'youtube.com/@Inter'),
    ('channel', 'Juventus', 'UCLzKhsxrExAC6yAdtZ-BOWw', true, true, 5, 'youtube.com/@Juventus'),
    ('channel', 'Liverpool', 'UC9LQwHZoucFT94I2h6JOcjw', true, true, 6, 'youtube.com/@LiverpoolFC'),
    ('channel', 'Manchester City', 'UCkzCjdRMrW2vXLx8mvPVLdQ', true, true, 1, 'youtube.com/@mancity'),
    ('channel', 'Manchester United', 'UC6yW44UGJJBvYTlfC7CRg2Q', true, true, 2, 'youtube.com/@manutd'),
    ('channel', 'Milan', 'UCKcx1uK38H4AOkmfv4ywlrg', true, true, 3, 'youtube.com/@ACMilan'),
    ('channel', 'Napoli', 'UCTnCzHi0P6MH83er5OfZbzQ', true, true, 4, 'youtube.com/@SSCNapoli'),
    ('channel', 'Olympiacos', 'UCLf7YXb-0PWEeq59Z_q318A', true, true, 5, 'youtube.com/@olympiacosfc'),
    ('channel', 'Olympique Lyonnais', 'UCzHCZXmqIdjqRnpdp0l_T6g', true, true, 6, 'youtube.com/@OlympiqueLyonnais'),
    ('channel', 'Olympique Marseille', 'UCoKweTwEeA-D9vuSVw_Z_DQ', true, true, 1, 'youtube.com/@OM_Officiel'),
    ('channel', 'Palmeiras', 'UCBKc-rPDivvwFiWdG-81wxw', true, true, 2, 'youtube.com/@Palmeiras'),
    ('channel', 'Paris Saint-Germain', 'UCt9a_qP9CqHCNwilf-iULag', true, true, 3, 'youtube.com/@PSG'),
    ('channel', 'Porto', 'UCQegzQwEExHgXvm_yHptzQg', true, true, 4, 'youtube.com/@FCPorto'),
    ('channel', 'PSV', 'UC_2ynsXrRrKP8zYrU7Hc06A', true, true, 5, 'youtube.com/@PSV'),
    ('channel', 'RB Leipzig', 'UCkZwB4IGoNBvRmVT2gaO4XA', true, true, 6, 'youtube.com/@RBLeipzig'),
    ('channel', 'Real Betis', 'UCeB7JZwcar2fVoK2w2f9OwA', true, true, 1, 'youtube.com/@RealBetis'),
    ('channel', 'Real Madrid', 'UCWV3obpZVGgJ3j9FVhEjF2Q', true, true, 2, 'youtube.com/@realmadrid'),
    ('channel', 'River Plate', 'UCXq6nwzvf5x4QKxA3CjHXbg', true, true, 3, 'youtube.com/@RiverPlate'),
    ('channel', 'Roma', 'UCLttSYJ6kPtlcurY96kXkQw', true, true, 4, 'youtube.com/@asroma'),
    ('channel', 'Santos', 'UC0uRT_armQXqds_rjTjqJ0g', true, true, 5, 'youtube.com/@SantosFC'),
    ('channel', 'Sao Paulo', 'UCX3zTAsEoZ61rQMYb_08Tow', true, true, 6, 'youtube.com/@saopaulofc'),
    ('channel', 'Sevilla', 'UCLy9lmj_0cqffXUzbGHNmYA', true, true, 1, 'youtube.com/@SevillaFC'),
    ('channel', 'Shakhtar Donetsk', 'UCmPCqUih--EyT2oxUn72MtA', true, true, 2, 'youtube.com/@FCShakhtar'),
    ('channel', 'Sporting CP', 'UCnJj6L93JX3Jrhzv81ayywA', true, true, 3, 'youtube.com/@SportingCP'),
    ('channel', 'Tottenham', 'UCEg25rdRZXg32iwai6N6l0w', true, true, 4, 'youtube.com/@TottenhamHotspur'),
    ('channel', 'Valencia', 'UCgvyo5x49J8ht5H9imKfxMQ', true, true, 5, 'youtube.com/@valenciacf')  ) as v(kind, name, ref, needs_key, enabled, poll_group, note)
 where not exists (select 1 from digest_source d where d.ref = v.ref);
