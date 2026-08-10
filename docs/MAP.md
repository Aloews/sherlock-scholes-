# Карта проекта

Справочник «что где лежит и как связано». `docs/ARCHITECTURE.md` рядом
говорит, **как должно быть** (правила FSD, запреты); этот файл — **как есть
сейчас**.

**Агенту:** прочитай отсюда нужный раздел вместо того, чтобы обходить дерево
grep'ом. Дальше — только те файлы, что названы. Если карта разошлась с кодом,
верен код: почини карту тем же PR.

---

## 1. Система целиком

```mermaid
flowchart LR
  TG["Telegram<br/>Mini App"] --> FE["React + Vite<br/>src/"]
  FE -->|PostgREST + RPC| SB[("Supabase<br/>Postgres")]
  FE -->|invoke| EF["Edge Functions<br/>supabase/functions/"]
  EF --> SB
  SCR["football_scraper/<br/>+ docs/*.py"] -->|раз в сутки| SB
  WIKI["Wikidata /<br/>Wikipedia"] --> SCR
  FE --> VRC["Vercel<br/>хостинг + аналитика"]

  style FE fill:#1f6feb,color:#fff
  style SB fill:#3fb950,color:#fff
  style SCR fill:#8957e5,color:#fff
```

Своего бэкенда нет. Клиент ходит в Supabase напрямую; всё, что нельзя
доверить клиенту, живёт в RPC с `SECURITY DEFINER` или в Edge Function.

---

## 2. Экраны и роуты

`src/app/Router.tsx` — единственное место, где заводятся роуты.

| Роут | Экран | Что делает |
|---|---|---|
| `/` | `HomeScreen` | лендинг, выбор режима, вход в комнату |
| `/lobby` | `LobbyScreen` | сбор команд, выбор колоды комнаты (`features/lobby/RoomDeckPanel.tsx`, правит только хост), старт игры, вход в голосовой канал |
| `/game` | `GameScreen` | сетевая игра по раундам; голосом управляют компактно, в шапке |
| `/end` | `EndScreen` | итоги, история карточек |
| `/training` | `TrainingScreen` | быстрая игра на одном телефоне |
| `/collection` | `CollectionScreen` → `collection/CardDossier` | коллекция и досье карточки (Pro) |
| `/profile` | `ProfileScreen` → `profile/WeeklyQuests` | уровень, XP, задания недели |
| `/friends` | `FriendsScreen` | рейтинг друзей по XP и кого добавить |
| `/pro` | `ProScreen` | покупка Pro за Telegram Stars |
| `/tutorial` | `TutorialScreen` | обучение |
| `/admin` | `AdminScreen` | кабинет: правка карточек, репорты (по паролю) |

`DeckPickerScreen` и `home/HomeLandingMaster` — не роуты, а части `HomeScreen`.

**Приглашение в комнату — две половины одной фичи.** `features/lobby/invite.ts`
строит ссылку `t.me/<бот>?startapp=<КОД>`, а `HomeScreen` читает её обратно
через `getStartParam()` (`shared/lib/telegram.ts` → `initDataUnsafe.start_param`)
и сразу пробует войти. Одна половина без другой бесполезна: ссылка откроет
приложение, но код не подставится. `start_param` — непроверенный ввод, поэтому
проходит через `normalizeCode()` до любого использования.

Третий путь — QR на ту же ссылку: `shared/lib/qr.ts` (свой кодировщик, без
зависимости в бандле) и `shared/ui/QrCode.tsx`. Правится он только вместе с
`qr.test.ts`, который читает нарисованное настоящим декодером: ошибка в битах
даёт код, который выглядит безупречно и не сканируется.

---

## 3. Путь колоды — главный инвариант

Число под кнопкой и розданные карточки обязаны совпадать. Поэтому фильтр
**один объект**, а предикат **один SQL**:

```mermaid
flowchart TD
  DP["DeckPickerScreen<br/>собирает DeckFilter"] -->|onStart| HS["HomeScreen.startGame"]
  DP -->|счётчик| CD["count_deck"]
  HS -->|navigate state| TS["TrainingScreen"]
  TS --> UT["useTraining"]
  UT --> CR["features/game/cardRandomizer.ts"]
  RDP["RoomDeckPanel<br/>хост правит колоду комнаты"] -->|set_room_deck_filter| RS[("rooms.settings.deck")]
  RS --> RDF["roomDeck.ts<br/>roomDeckFilter()"]
  RDF -->|счётчик в лобби| CD
  RDF --> AR["roomService.activateRound"]
  AR --> CR
  CR --> PRC["pick_random_cards"]
  CD --> CM{{"cards_matching<br/>ЕДИНСТВЕННЫЙ предикат"}}
  PRC --> CM
  CM --> T[("cards")]

  style CM fill:#d29922,color:#000
```

* Тип фильтра — `src/shared/types/deck.ts` (`DeckFilter`).
* SQL — `supabase/migrations/deck_rpc.sql`.
* У комнаты фильтр тоже **один**, в `settings.deck`, и читают его **только**
  через `roomDeckFilter()` (`src/features/room/roomDeck.ts`): она же
  подставляет `settings.categories` комнатам, созданным до появления `deck`.
  Пишет его только `set_room_deck_filter` — и заодно зеркалит `categories`,
  потому что раздать раунд может любой клиент в комнате, включая сборку,
  которая про `deck` не знает.
* `pick_random_cards` и `count_deck` — **единственные** обёртки над
  `cards_matching`. Новый способ выбирать карточки заводить нельзя: он
  разойдётся со счётчиком.
* Предыстория — `docs/FILTERS_REWORK.md`.

⚠️ В `deck_rpc.sql` лежит **легаси-версия `pick_random_cards` на 12
позиционных параметров**. Это временный шим: прод зовёт её позиционно, и её
удаление один раз уже уронило живое приложение. `DROP` выписан в том же
файле — выполнить только после того, как новый фронт раскатан везде.

---

## 4. Слои и зависимости

```mermaid
flowchart TD
  A["app/<br/>Router, TabBar"] --> S["screens/"]
  S --> F["features/<br/>бизнес-логика"]
  S --> SH["shared/"]
  F --> SH
  SH -.->|ЗАПРЕЩЕНО| F

  style SH fill:#238636,color:#fff
```

**`shared/` не импортирует из `features/` и `screens/`** — никогда. Это
правило из `docs/ARCHITECTURE.md`, и его нарушение ломает переиспользование.

| Слой | Путь | Что там |
|---|---|---|
| Состояние | `shared/store/` | `authStore`, `gameStore`, `proStore`, `settingsStore` (Zustand) |
| Типы | `shared/types/` | `database.ts` (зеркало схемы), `deck.ts` (фильтр), `game.ts` |
| Чистая логика | `shared/lib/` | `level`, `quests`, `tier`, `pro`, `photoFit`, `cardName`, `flag`, `sounds`, `telegram`, `useMainButton`, `useKeyboardOpen`, `qr`, `supabase` |
| Компоненты | `shared/ui/` | `Button`, `Chip`, `OptionRow`, `PlayerCard`, `Avatar`, `Timer`, … |
| Фичи | `features/<имя>/` | `use<Фича>.ts` + `<фича>Api.ts` |

Фичи: `auth`, `room`, `lobby`, `game`, `collection`, `pro`, `quests`,
`reports`, `admin`, `voice`, `friends`.

---

## 5. Фаза игры — только через машину состояний

`features/game/stateMachine.ts` — единственный способ менять фазу. Прямое
присваивание запрещено.

Зовут `transition()`: `features/room/useRoom.ts`,
`features/lobby/useLobby.ts`, `features/game/useGame.ts`.

---

## 6. Серверная поверхность

**RPC** (`supabase/migrations/`):

| Функция | Файл | Назначение |
|---|---|---|
| `cards_matching`, `pick_random_cards`, `count_deck` | `deck_rpc.sql` | колода |
| `fame_tier`, `refresh_card_fame` | `deck_fame.sql` | известность (перцентиль) и производные |
| `collection_views`, `collection_page` | `collection_page_by_lang.sql` | коллекция: страница каталога в порядке языка зрителя. **Не путь колоды** — карточку не раздаёт |
| `increment_player_stats` | `player_progression_xp.sql`, `weekly_quests.sql` | статистика + XP + прогресс заданий, `SECURITY DEFINER` |
| `get_weekly_quests`, `claim_weekly_task`, `weekly_task_codes`, `current_week_start` | `weekly_quests.sql` | задания недели |
| `get_user_status`, `tg_is_pro` | `pro_users.sql`, `pro_onboarding.sql` | Pro и проверка `initData` по HMAC |
| `create_team_room` | `create_team_room.sql` | создание комнаты |
| `set_room_deck_filter` | `room_deck_filter.sql` | хост выбирает колоду комнаты; пишет `settings.deck` и зеркалит `settings.categories`. Только хост, только пока `waiting` — `rooms` пишут все, политика `USING (true)` |
| `pause_round`, `resume_round`, `max_round_pause_ms` | `pause_round_on_voice_drop.sql` | пауза таймера, пока у объясняющего нет голоса; потолок — 2 минуты |
| `claim_room_voice_provider`, `move_room_voice_provider` | `room_voice_provider.sql` | голосовой сервис комнаты: захват и перевод всей комнаты на живой |
| `deck_squads`, `rebuild_card_current_clubs`, `club_match_key` | `current_squads.sql` | актуальные составы клубов для фильтра `clubs`. Пересобирается `pg_cron` в 06:10 UTC — `schedule_squad_rebuild.sql` |
| `spend_odds_credits`, `odds_credits_left`, `upsert_fixtures`, `club_card_by_name` | `fixtures_and_odds.sql` | расписание матчей и бюджет the-odds-api (500 кредитов в месяц) |
| `end_round` | `end_round_rpc.sql` | захват раунда, подсчёт и запись очков — **одной транзакцией** |
| `award_room_stats`, `on_room_finished` | `award_stats_on_finish.sql` | начисление статистики при переходе комнаты в `finished` |
| `sweep_stale_rooms` | `sweep_stale_rooms.sql` | серверная развёртка брошенных игр, `pg_cron` каждые 5 минут |
| `record_room_encounters`, `friends_with_rating`, `friend_suggestions`, `add_friend`, `remove_friend` | `friends_and_rating.sql` | кто с кем играл, рейтинг друзей и рекомендации |

⚠️ **`grant_pro` в репозитории нет.** `tg-pay` зовёт её по предполагаемой
сигнатуре `grant_pro(p_secret text, p_telegram_id bigint)`, а определение
живёт только в проде. Меняешь оплату — сначала посмотри функцию в базе, в
файлах её не найдёшь.

**Edge Functions** (`supabase/functions/`):

* `tg-pay` — оплата Telegram Stars; проверяет `initData` на сервере.
* `livekit-token` — токен голосового канала; канал **и сервис** выбирает
  сервер (`VOICE_PROVIDER`: livekit / daily / agora). Имя историческое —
  `docs/VOICE_PROVIDERS.md`.
* `assistant-bot` — личный ассистент владельца в отдельном боте. К игре
  отношения не имеет и **секретов с ней не делит**: читает
  `ASSISTANT_BOT_TOKEN`, тогда как `tg-pay` читает `TELEGRAM_BOT_TOKEN`, а
  `tg_validate_init_data` — запись Vault `telegram_bot_token`. Секрет вебхука
  не заводится вручную: это `sha256(ASSISTANT_BOT_TOKEN)`, поэтому установка и
  проверка не могут разойтись — но ротация токена требует повторного
  `{"action":"install"}`. Владелец фиксируется по первому написавшему
  (`assistant_owner`), остальные игнорируются молча. Две модели, выбор живёт в
  `assistant_owner.model` и переключается командой `/model`: Claude Opus 5 для
  разбора, Gemini Flash — дешёвый, и дешёвым его делает `thinkingBudget: 0`, а
  не имя.

**RLS**: `supabase/migrations/rls_lockdown.sql` — образец для новых таблиц.
Игрок читает свой прогресс, но **не пишет** его; запись — только через
`SECURITY DEFINER`.

---

## 7. Конвейер данных

```mermaid
flowchart LR
  W["Wikidata / Wikipedia<br/>API-Football"] --> R["football_scraper/run.py<br/>scraper/*.py"]
  R --> C["cache/<br/>без TTL, живёт между прогонами"]
  R --> D["docs/*.py<br/>35 скриптов обогащения"]
  WD["cards_missing_by_country_preview.py<br/>аудит покрытия по странам"] --> IN["cards_insert_missing_players.sql<br/>голые карточки"]
  IN --> SB
  IN -.->|"резолв: фото, страна, карьера"| D
  D --> SB[("cards")]
  GH["daily-enrich.yml<br/>05:00 UTC"] --> D
  D --> RF["refresh_card_fame<br/>последним шагом"]
  RF --> SB
```

`fame` — **перцентиль**, поэтому его пересчитывают после последнего шага,
меняющего `pageviews` или `pageviews_i18n`. Иначе шкала съезжает, а вместе с
ней `tier` и тег `legend`.

⚠️ Считается он **не от `cards.pageviews`**: та колонка — только ру-вики.
Метрика — `GREATEST(pageviews_ru, max по 8 языкам из pageviews_i18n)`
(`deck_fame.sql`). Ранговая корреляция ru-only с этой осью — 0.172, то есть
это разные величины; замер в `docs/PLAYER_ATTENTION_ANALYSIS.md`.

### Языковые просмотры: два резолва, а не один

`docs/cards_pageviews_i18n.py` наполняет `pageviews_i18n` и делает это
**по-разному для игроков и всех остальных**:

* **игрок** — батчами по 50 через ру-вики `action=query`: голое имя карточки
  и есть титул статьи, с точностью до нормализации и редиректа;
* **всё остальное** — через резолвер конвейера (`run.resolve_card_qid`), тот
  же, что у фото и описаний: сначала «<имя> (футбольный клуб)» / «(стадион)»,
  потом голое имя, потом полнотекстовый поиск, и на каждом шаге **P31-гард**.

⚠️ Голое название неигровой карточки — это обычно **не она**. «Зенит» в
ру-вики — астрономический зенит (Q82806), «Факел» — факел, «Брест» — город.
Отсюда `name_en = "Zenith"` и `"Torch"` в проде: их проставил резолв по
голому имени. Гард отбраковывает такое, и карточка остаётся **без** данных —
это правильный исход: пустой `pageviews_i18n` оставляет её на русском
порядке, а чужая слава испортила бы и сортировку, и рамку редкости.

Порядок сортировки коллекции — `collection_views()` (§6), и запасной путь
там **`COALESCE`, а не `GREATEST`**: максимум всегда возвращал бы русский
счёт, и француз по-прежнему открывал бы «Клубы» на «Зените».

⚠️ Кэш скрапера **не имеет TTL и переезжает между прогонами CI**. Один
записанный промах «ничего не найдено» глушил бы запрос вечно — поэтому
промахи не кешируются, а `docs/cache_prune_empty.py` чистит накопленные.
Симптом поломки: «115 карточек обработано, бюджет 0/20000».

---

## 8. Проверки

```bash
npx tsc --noEmit          # noUnusedLocals включён
npm test                  # vitest
npm run test:mutation     # stryker, порог 80 — понижать нельзя
node scripts/check-i18n.mjs
npm run build
cd football_scraper && python3 -m pytest -q          # только hypothesis-тест
cd football_scraper && for f in tests/test_*.py; do python3 "$f"; done

# Серверная логика — руками, базы в CI нет:
psql "$DATABASE_URL" -f supabase/tests/sweep_stale_rooms.test.sql
```

`supabase/tests/*.test.sql` — фикстуры и проверки внутри одной транзакции с
`ROLLBACK`. Гонять **не на проде**: развёртка обходит все комнаты, а тест
вызывает её и с нулевым запасом. Локальная копия или ветка Supabase.

Тесты фронта: `src/**/*.test.ts`, плюс `test/data-integrity/cards.test.ts`
поверх `sherlock_cards.csv`.

Тесты скрапера — **самостоятельные скрипты**, pytest собирает из них только
`test_property_canonical.py`. CI (`ci.yml`) прогоняет и то, и другое.

⚠️ GitHub Actions в этом репозитории **регулярно теряет событие
`pull_request`**. Пуш может остаться вообще без проверок — и это выглядит как
«ещё идут», а не как провал. После пуша смотри чеки PR; если там только
Vercel — запусти `ci.yml` через `workflow_dispatch`.

---

## 9. Что ломается чаще всего

| Грабли | Где написано |
|---|---|
| Строка добавлена не во все 9 локалей | `CLAUDE.md` |
| Формы множественного числа выдуманы для языка, где их нет | `CLAUDE.md` |
| Новый способ выбирать карточки в обход `cards_matching` | §3 |
| Удаление легаси-`pick_random_cards` до раскатки фронта | §3, `deck_rpc.sql` |
| `shared/` импортирует из `features/` | §4 |
| Фаза игры меняется мимо машины состояний | §5 |
| Новая таблица без RLS — игрок пишет себе награды | §6 |
| PR ответвлён от другой ветки `claude/*` → ложные конфликты после squash | `CLAUDE.md` |
| Секрет в переменной с префиксом `VITE_` → попадает в бандл | `supabase/functions/livekit-token/README.md` |
| Миграция молча зависит от другой, применённой руками | `weekly_quests.sql` §0 |
| Начисление статистики «выстрелил и забыл» с клиента | `award_stats_on_finish.sql` |
| Несколько записей подряд с клиента там, где realtime будит остальных после первой | `end_round_rpc.sql` |
| Страховка живёт только на клиенте — а клиентов не осталось | `sweep_stale_rooms.sql` |
| Клавиатура перекрывает кнопку; код комнаты не копируется | `docs/LOBBY_AND_VOICE_FIXES.md` |
| Подписка на дорожку принята за воспроизведение — LiveKit её не играет, нужен `attach()` в DOM | `docs/LOBBY_AND_VOICE_FIXES.md` §3 |
| Сессия голоса внутри экрана — размонтирование рвёт канал, поэтому она над роутером | `src/features/voice/VoiceProvider.tsx` |
| `npm run build` без переменных голоса вырезает его целиком — SDK-чанка в `dist/` нет | `docs/VOICE_PROVIDERS.md` §5 |
| `VOICE_PROVIDER` и `VITE_VOICE_PROVIDER` разошлись — токен валиден и бесполезен | `docs/VOICE_PROVIDERS.md` §1 |
| SDK сервиса импортирован статически — попадёт в бандл всем, включая тех, кто на другом сервисе | `src/features/voice/providers/index.ts` |
| Загрузка адаптера через `voiceProvider()`, а не сырой литерал — ветки не сворачиваются, и все три SDK едут в каждую сборку | `src/features/voice/providers/index.ts` |
| Daily оставлен незакрытым после провала — он один на страницу, и ломается не эта попытка, а все следующие | `docs/LOBBY_AND_VOICE_FIXES.md` §3, `providers/daily.ts` |
| Перебор сервисов продолжен после отказа в микрофоне — один «нет» превращается в три запроса подряд | `src/features/voice/failover.ts` |
| «Повторить» и «сменить сервис» смешаны в одно решение — игрок ждёт три круга, чтобы услышать то же самое про комнату | `failover.ts` против `connectPolicy.ts` |
| Двое в одной комнате на разных вендорах — оба видят «Связь есть» и молчат; отказ выглядит как успех | `room_voice_provider.sql`, `docs/VOICE_PROVIDERS.md` |
| `revoke ... from public` без явного `grant ... to service_role` — Edge Function получает permission denied, голос умирает у всех | `room_voice_provider.sql`, `pro_users.sql` |
| Клиент не говорит, какой сервис отказал — закрепление комнаты убивает перебор, каждая ступень получает того же мертвеца | `useVoiceChat.ts` → `failed`, Edge `agreeProvider` |
| Лестница шагает по ступеням, а не по реально опробованным сервисам — сервер может выдать другой, и ступень тратится впустую | `failover.ts` `nextProvider` |
| Agora входит в канал до запроса микрофона — отказ оставляет игрока в канале, слышащим всех, под экраном «нет доступа» | `providers/agora.ts` |
| `codec` у Agora — **видео**кодек. Передали `'opus'`, и `createClient` бросал `INVALID_PARAMS` до всего остального: сервис не подключался ни разу, а тесты были зелёные, потому что мок принимал любое значение | `providers/agora.ts`, `AGORA_VIDEO_CODECS` |
| Тест держит форму вызова, но не значение из чужого словаря — мок примет что угодно, а SDK нет | `providers/agora.test.ts` |
| `(get_user_status(x)).telegram_id` — функция возвращает **`json`**, а не композит: 42809 на каждом вызове, ещё до любой проверки. Кто зовёт — `tg_validate_init_data()`, она отдаёт `bigint` или `null` | `pause_round_on_voice_drop.sql`, `room_deck_filter.sql` |
| `RETURN QUERY` принят за выход из функции — он только дописывает строки, и ранний возврат проваливается в код под собой | `pause_round_on_voice_drop.sql` |
| Комната раздаёт `{ categories }` вместо своего фильтра — лиги, составы и порог известности остаются в тренировке | `features/room/roomDeck.ts`, §6 `set_room_deck_filter` |
| `update rooms` из клиента вместо RPC — политика `USING (true)`, и любой гость перекраивает колоду хоста | `room_deck_filter.sql` |
| «Я не писал грант» ≠ «гранта нет»: Supabase раздаёт `alter default privileges ... to anon, authenticated` для таблиц, созданных ролью `postgres`, — сработает дефолт или нет, по файлу не видно. Закрытая таблица закрывается явным `revoke` | `assistant_bot.sql` |
| Токен ассистента ротирован без повторного `install` — секрет вебхука выведен из токена, и Telegram получает 403 на каждый апдейт | `functions/assistant-bot/README.md` |
| «Flash» взят за экономию по названию — он думает по умолчанию и берёт за это деньги; дешёвым его делает `thinkingBudget: 0`, иначе это та же цена за модель поменьше | `functions/assistant-bot/index.ts`, `askGemini` |
| Роль `assistant` отправлена в Gemini — у него ассистент называется `model`, и поле, которое выглядит симметричным, отвечает 400 | `functions/assistant-bot/index.ts`, `askGemini` |
| **Политика RLS без `GRANT SELECT`** — Postgres проверяет грант ПЕРВЫМ, и вызывающий получает `42501` ещё до политики. `card_current_club` уехала так, и это уронило **всю колоду**: `cards_matching` её читает, а она `LANGUAGE sql STABLE` **без** `SECURITY DEFINER`, то есть исполняется от игрока | `current_squads.sql`, `fixtures_and_odds.sql` |
| Симптом «не грузится игра» ищут в бандле и в деплое, а лежит он в гранте на маленькую справочную таблицу за три слоя от экрана | §3, `deck_rpc.sql` |
| Диплинк `?startapp=` без чтения `start_param` — ссылка открывает приложение, но код никуда не попадает | §2, `features/lobby/invite.ts` |
| Второй рейтинг рядом с XP — у одного игрока два разных места | `friends_and_rating.sql` |
| `cards.pageviews` принят за «внимание» — а это только ру-вики | §7, `docs/PLAYER_ATTENTION_ANALYSIS.md` |
| Сортировка по `pageviews_i18n->>lang` через PostgREST — она **текстовая**, «9» > «10000» | §7, `collection_page_by_lang.sql` |
| Запасной путь языка написан через `GREATEST`, а не `COALESCE` — русский счёт всегда больше, и порядок не меняется | `collection_page_by_lang.sql` |
| `P106 = футболист` + сортировка по числу вики — и первым идёт Нобелевский физиолог Шеррингтон, за ним два актёра. Нужны `P54` в клуб с `P641 = футбол` и `P413` (амплуа) | `cards_missing_by_country_preview.py` |
| `rdfs:label` принят за имя: Викиданные зовут 浅野拓磨 «Takuma ano», а Маркеса — «Rafael Márquez El piojo». Титул статьи правят редакторы, метку — нет | `cards_missing_by_country_preview.py` |
| `P27` считается одним гражданством — Джонатан Дэвид отвечает на запрос по США и канадец. Страну новой карточке пишет не импорт, а резолв | `cards_missing_by_country_preview.py` |
| Дубль ищется точным равенством: «Кейсуке Хонда» и «Кэйсукэ Хонда» похожи на 0.47, а «Wataru Endō» и «Wataru Endo» не равны вовсе. Нужны триграммы **и** свёртка диакритики | `cards_insert_missing_players.sql` |
| Неигровая карточка резолвится по голому названию: «Зенит» — это зенит-надир, «Факел» — факел | §7, `cards_pageviews_i18n.py` |
| Ошибка `maxlag` от Wikidata принята за успех — она приходит **HTTP 200** с телом-ошибкой | §7, `cards_pageviews_i18n.py` |
| `player_seasons` принята за готовую историю — 8577 строк-сирот, `players_meta` пуста | `docs/PLAYER_ATTENTION_ANALYSIS.md` §7 |
