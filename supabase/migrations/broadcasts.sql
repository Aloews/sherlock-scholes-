-- «Где смотреть» — официальная страница турнира, а не список стримов.
--
-- ЧЕГО ЗДЕСЬ НЕТ И НЕ БУДЕТ: перечня «источников видео с матчами». Права на
-- каждый матч принадлежат одному-двум вещателям в стране, и сотня источников
-- бывает ровно одного происхождения. Такой блок подставляет приложение.
--
-- ЗДЕСЬ ТАКЖЕ НЕТ УТВЕРЖДЕНИЙ ВИДА «в России это показывает такой-то канал».
-- Права перепродаются каждый сезон, и таблица с ними устаревает молча —
-- пользователь идёт по ссылке и попадает не туда, а приложение при этом
-- выглядит уверенным. Вместо этого ссылка ведёт на СОБСТВЕННУЮ страницу
-- турнира, которая всегда актуальна, потому что её ведёт правообладатель.
--
-- КАЖДЫЙ АДРЕС НИЖЕ ПРОВЕРЕН ЗАПРОСОМ, а не взят по памяти. Проверка сразу
-- себя окупила: страница bundesliga.com/en/bundesliga/broadcasters, которая
-- выглядит очевидной и которую я собирался записать, отдаёт 404.
--
-- Турниров в расписании больше, чем строк здесь. Это намеренно: адреса
-- tff.org и cbf.com.br из этой сети не открылись, а записывать непроверенное
-- значит обещать ссылку, которая не работает. Экран просто не покажет ссылку
-- там, где её нет.
--
-- ⚠️ «НЕ ОТКРЫЛИСЬ» УТОЧНЕНО, И УТОЧНЕНИЕ ВАЖНО: сайты живы, режет их дорога
-- отсюда. Замер: прямое TLS-рукопожатие с www.cbf.com.br и www.tff.org
-- проходит и сертификат валиден (TLSv1.3), а `http://www.tff.org` отдаёт 200 и
-- собственный заголовок «Türkiye Futbol Federasyonu Resmi İnternet Sitesi».
-- И только запрос ЧЕРЕЗ исходящий прокси этой среды не проходит — и в urllib,
-- и в curl, тогда как thecfa.cn и uefa.com тем же путём отвечают 200.
--
-- Из этого следует не «сайты мёртвые», а «проверять надо не отсюда». Если бы
-- здесь осталось прежнее «не открылись», следующий добросовестно вычеркнул бы
-- Бразилию и Турцию как безнадёжные — а их достаточно один раз проверить из
-- другой сети и дописать.
--
-- ⚠️ brasileirao.com.br отвечает 200 и выглядит готовым ответом для Бразилии —
-- НЕ БЕРИТЕ ЕГО. Заголовок страницы «Brasileirão — Tudo sobre futebol nacional
-- e internacional»: это новостной сайт про футбол, а не собственная страница
-- турнира. Вся ценность этой таблицы в том, что по ссылке ведёт правообладатель
-- и потому она не устаревает; новостник даёт ровно ту же ссылку, что и любой
-- поиск, и стареет так же молча, как список каналов.

create table if not exists public.broadcasts (
  sport_key   text primary key,
  -- Как назвать место, куда ведёт ссылка. Не «канал»: это официальная
  -- страница турнира, и назвать её каналом было бы неправдой.
  name        text not null,
  url         text not null,
  -- Когда адрес в последний раз проверяли живым запросом. Права и адреса
  -- меняются, и дата — единственное, что отличает «проверено» от «когда-то
  -- работало».
  checked_at  timestamptz not null default now()
);

alter table public.broadcasts enable row level security;

-- Политика без гранта — это таблица, которую никто не может прочитать.
-- Поэтому грант стоит рядом, а не в другом файле.
drop policy if exists broadcasts_read on public.broadcasts;
create policy broadcasts_read on public.broadcasts for select using (true);
grant select on public.broadcasts to anon, authenticated;
grant select, insert, update, delete on public.broadcasts to service_role;

insert into public.broadcasts (sport_key, name, url) values
  -- Канонический адрес, а не первый работающий. `/broadcast-schedules` тоже
  -- открывается, но двумя переходами: 301 на `/en/broadcasting`, оттуда 302
  -- сюда. Ссылка, которая работает через редиректы, ломается тихо — переезд
  -- отменяют, и остаётся 404 в таблице, которую никто не перечитывает.
  ('soccer_epl',                        'Premier League',        'https://www.premierleague.com/en/media/broadcasters'),
  ('soccer_spain_la_liga',              'LaLiga',                'https://www.laliga.com'),
  ('soccer_italy_serie_a',              'Lega Serie A',          'https://www.legaseriea.it/en/serie-a'),
  ('soccer_germany_bundesliga',         'Bundesliga',            'https://www.bundesliga.com/en/bundesliga'),
  ('soccer_france_ligue_one',           'Ligue 1',               'https://ligue1.com'),
  ('soccer_netherlands_eredivisie',     'Eredivisie',            'https://eredivisie.nl'),
  ('soccer_portugal_primeira_liga',     'Liga Portugal',         'https://www.ligaportugal.pt'),
  ('soccer_russia_premier_league',      'РПЛ',                   'https://premierliga.ru'),
  ('soccer_usa_mls',                    'MLS',                   'https://www.mlssoccer.com'),
  ('soccer_mexico_ligamx',              'Liga MX',               'https://www.ligamx.net'),
  ('soccer_argentina_primera_division', 'AFA',                   'https://www.afa.com.ar'),
  ('soccer_japan_j_league',             'J.League',              'https://www.jleague.jp'),
  ('soccer_korea_kleague1',             'K League',              'https://www.kleague.com'),
  ('soccer_uefa_champs_league',         'UEFA Champions League', 'https://www.uefa.com/uefachampionsleague'),
  ('soccer_uefa_europa_league',         'UEFA Europa League',    'https://www.uefa.com/uefaeuropaleague/'),
  ('soccer_uefa_nations_league',        'UEFA Nations League',   'https://www.uefa.com/uefanationsleague/'),
  ('soccer_uefa_european_championship', 'UEFA EURO',             'https://www.uefa.com/uefaeuro/'),
  ('soccer_fifa_world_cup',             'FIFA World Cup',        'https://www.fifa.com/en/tournaments/mens/worldcup'),
  ('soccer_conmebol_copa_libertadores', 'CONMEBOL',              'https://www.conmebol.com'),
  ('soccer_conmebol_copa_sudamericana', 'CONMEBOL',              'https://www.conmebol.com'),

  -- Добавлены после замера дыры: в расписании были матчи, а ссылки под ними
  -- не было вовсе. Четыре турнира не имели строки; закрыты два, по которым
  -- адрес удалось ПРОВЕРИТЬ отсюда (17 матчей из 36).
  --
  -- Квалификация — та же страница, что и основной турнир, и это не небрежность:
  -- УЕФА ведёт её одним разделом, отдельной страницы у квалификации нет.
  ('soccer_uefa_champs_league_qualification', 'UEFA Champions League', 'https://www.uefa.com/uefachampionsleague'),

  -- Федерация, а не лига — как у AFA и CONMEBOL выше. Собственный раздел лиги
  -- (`/csl/`) отвечает 200 и говорит «页面升级维护», то есть «страница на
  -- обслуживании»: вести туда значит вести на заглушку.
  ('soccer_china_superleague',           'CFA',                   'https://www.thecfa.cn')
on conflict (sport_key) do update
  set name = excluded.name, url = excluded.url, checked_at = now();
