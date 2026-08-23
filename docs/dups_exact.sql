-- Duplicate cards found by EXACT evidence (docs/dups_exact_preview.py).
-- Complements docs/dups_cleanup.sql, which scores fuzzy name similarity;
-- these are pairs resolved to ONE Wikidata entity — same name_en plus the
-- same photo and/or the same pageviews — so they are not a judgement call.
--
-- Deactivation, not DELETE: round_cards.card_id references cards(id).
-- Keep-rule: more pageviews, then higher fame, then the older card.
--
-- ⚠️ FULLY RESOLVED 2026-08-23 — CERTAIN (76 groups) confirmed against prod
-- by direct query (77/77 target ids already active=false) before this
-- comment was corrected — it used to say "NOT EXECUTED" and had gone stale
-- silently. REVIEW (11 groups) is now resolved too, every group either
-- applied or explicitly closed as not-a-duplicate — see its own header
-- below for how each was decided. This file is a one-time operational
-- script, not a migration, so nothing forces its header to track what was
-- actually run — read `active` on the table, not this comment, if you need
-- current state. Re-running CERTAIN is harmless (`SET active = false` on an
-- already-false row is a no-op); re-running REVIEW is a no-op for the same
-- reason on the groups already applied, and does nothing on the closed ones
-- because they were never uncommented.
--
-- !! AFTER APPLYING, RECOMPUTE FAME !!
--    python docs/cards_fame_refresh.py
-- fame is a percentile, and a duplicate SPLITS one player's attention
-- across two cards: «Жоау Моутиньо» sits at 70 and «Жоау Моутинью» at 35
-- for the same man. Both are understated until the scale is rebuilt, which
-- is also why the two halves of a pair can wear different rarity frames.

-- ============ CERTAIN: 76 groups — APPLIED ============
-- Aaron Ramsey: keep «Аарон Рэмзи» [player | pv=39252 | fame=91] — same photo
UPDATE cards SET active = false WHERE id = '97f04f25-14e4-46b1-87df-626d35a1d8a1';  -- «Аарон Рэмси» (fame=91)
-- Aleksandr Golovin: keep «Александр Сергеевич Головин» [player | pv=273016 | fame=76] — same photo
UPDATE cards SET active = false WHERE id = '08b4b567-cbde-4954-8312-d73fd1a46f78';  -- «Александр Головин» (fame=6)
-- Alisson Becker: keep «Алисон Бекер» [player | pv=57832 | fame=71] — same photo
UPDATE cards SET active = false WHERE id = '4023498e-2f31-4a1a-86d4-a24aa22285d9';  -- «Алиссон Беккер» (fame=46)
UPDATE cards SET active = false WHERE id = '1177f8f0-65ef-44cf-bcd3-036e8a2f087c';  -- «Алиссон» (fame=94)
-- Andriy Lunin: keep «Андрей Алексеевич Лунин» [player | pv=502438 | fame=87] — same photo, same pageviews
UPDATE cards SET active = false WHERE id = '289ded08-f2b8-4476-a2f9-ab2154d087d3';  -- «Андрей Лунин» (fame=87)
-- Aurélien Tchouaméni: keep «Орельен Чуамени» [player | pv=54653 | fame=87] — same photo, same pageviews
UPDATE cards SET active = false WHERE id = 'a967349c-b374-494e-86d4-cef7804321b8';  -- «Орельен Тчуамени» (fame=46)
-- Axel Witsel: keep «Аксель Витсель» [player | pv=171 | fame=75] — same photo
UPDATE cards SET active = false WHERE id = 'c93d59e6-a563-40c3-952c-e18a613ecb6b';  -- «Аксель Витцель» (fame=75)
-- Benjamin Lecomte: keep «Бенжамен Лекомт» [player | pv=1616 | fame=7] — same photo
UPDATE cards SET active = false WHERE id = '010a8580-ad8a-4c65-b665-a8caf6ab75b5';  -- «Бенжамен Леконт» (fame=41)
-- Bruno Fernandes: keep «Бруну Фернандеш» [player | pv=72662 | fame=98] — same photo, same pageviews
UPDATE cards SET active = false WHERE id = '5d867f24-33d6-4646-b65d-58d375bd16f8';  -- «Бруно Фернандеш» (fame=50)
-- Corentin Tolisso: keep «Корантен Толиссо» [player | pv=11810 | fame=70] — same photo
UPDATE cards SET active = false WHERE id = '0804f7eb-9adb-4d59-bdee-bbc42da7d523';  -- «Корентен Толиссо» (fame=70)
-- Dani Carvajal: keep «Дани Карвахаль» [player | pv=130764 | fame=89] — same photo
UPDATE cards SET active = false WHERE id = 'cf58ba39-3231-4935-b416-c534d1cbd0bb';  -- «Даниэль Карвахаль» (fame=89)
-- Danny Welbeck: keep «Дэнни Уэлбек» [player | pv=25868 | fame=43] — same photo, same pageviews
UPDATE cards SET active = false WHERE id = '975a1c54-2e4b-4a04-95c7-7e9f22dfe6c0';  -- «Данни Уэлбек» (fame=35)
-- Davide Calabria: keep «Давиде Калабрия» [player | pv=19752 | fame=55] — same photo, same pageviews
UPDATE cards SET active = false WHERE id = '47289ea5-a410-48d8-8992-da75693c012c';  -- «Давиде Калабриа» (fame=33)
-- Dejan Kulusevski: keep «Деян Кулушевски» [player | pv=21909 | fame=72] — same photo, same pageviews
UPDATE cards SET active = false WHERE id = 'efede1b1-de9f-4d0d-b771-b1f2485439d5';  -- «Деян Кулусевски» (fame=34)
-- Dimitri Payet: keep «Димитри Пайет» [player | pv=37681 | fame=75] — same photo
UPDATE cards SET active = false WHERE id = 'dedc959a-91fa-44e8-a681-f033a042cd22';  -- «Димитри Пайе» (fame=75)
-- Diogo Dalot: keep «Диогу Дало» [player | pv=17211 | fame=35] — same photo
UPDATE cards SET active = false WHERE id = 'e50e00df-3208-4995-a156-6e86642c7c7b';  -- «Диогу Далот» (fame=80)
-- Edmond Tapsoba: keep «Эдмон Тапсоба» [player | pv=8048 | fame=22] — same photo
UPDATE cards SET active = false WHERE id = '5eee8dc2-a3df-4f42-a107-2aee98b2a63c';  -- «Эдмонд Тапсоба» (fame=51)
-- Endrick: keep «Эндрик Фелипе» [player | pv=107006 | fame=87] — same photo
UPDATE cards SET active = false WHERE id = '911320a2-80fd-423d-98be-37e1ee4fb00f';  -- «Эндрик» (fame=1)
-- Erling Haaland: keep «Эрлинг Холанн» [player | pv=529693 | fame=100] — same photo
UPDATE cards SET active = false WHERE id = 'ce4e0d29-2190-4212-b0b7-a8f1f1e1fa89';  -- «Эрлинг Холанд» (fame=97)
-- Francisco Trincão: keep «Франсишку Тринкан» [player | pv=8138 | fame=71] — same photo, same pageviews
UPDATE cards SET active = false WHERE id = '654813cb-d6c0-409b-b378-034a18d70f96';  -- «Франсишку Тринкау» (fame=23)
-- Fredy Guarín: keep «Фредди Гуарин» [player | pv=51 | fame=42] — same photo
UPDATE cards SET active = false WHERE id = 'b127818d-5d43-41be-8503-3c4ba6de3047';  -- «Фреди Гуарин» (fame=1)
-- Gabriel Martinelli: keep «Габриэл Мартинелли» [player | pv=27732 | fame=92] — same photo, same pageviews
UPDATE cards SET active = false WHERE id = 'ba247a83-fca2-43bc-b523-1d51f4a848cc';  -- «Габриэль Мартинелли» (fame=36)
-- Giorgi Mamardashvili: keep «Георгий Мамардашвили» [player | pv=76187 | fame=85] — same photo, same pageviews
UPDATE cards SET active = false WHERE id = 'bd246ebe-73f2-4c7f-8227-586e0be28e35';  -- «Гиорги Мамардашвили» (fame=51)
-- Harry Kane: keep «Гарри Кейн» [player | pv=378781 | fame=88] — same photo
UPDATE cards SET active = false WHERE id = '0385b967-2cac-4e62-adb6-f00408b6a57c';  -- «Харри Кейн» (fame=100)
-- Harry Maguire: keep «Гарри Магуайр» [player | pv=100294 | fame=95] — same photo
UPDATE cards SET active = false WHERE id = '168713eb-7435-4d78-a950-d62706432613';  -- «Харри Магуайр» (fame=95)
-- Henrikh Mkhitaryan: keep «Генрих Гамлетович Мхитарян» [player | pv=164118 | fame=80] — same photo
UPDATE cards SET active = false WHERE id = '256cb8f8-2caf-4580-aabd-c5bdd171636c';  -- «Генрих Мхитарян» (fame=80)
-- Hugo Ekitike: keep «Уго Экитике» [player | pv=21775 | fame=99] — same photo
UPDATE cards SET active = false WHERE id = '8e668972-0fa9-4c28-8bdc-6a4e65511efd';  -- «Юго Экитике» (fame=99)
-- Héctor Bellerín: keep «Эктор Бельерин» [player | pv=20291 | fame=80] — same photo
UPDATE cards SET active = false WHERE id = 'd995e840-595a-4ba4-81a7-0649c15b8c3e';  -- «Эктор Беллерин» (fame=80)
-- Illia Zabarnyi: keep «Илья Забарный» [player | pv=66370 | fame=76] — same photo
UPDATE cards SET active = false WHERE id = '1791d9ba-655d-426b-83ad-c660f1a578f0';  -- «Илья Борисович Забарный» (fame=76)
-- Joe Gomez: keep «Джозеф Гомес» [player | pv=17794 | fame=36] — same photo
UPDATE cards SET active = false WHERE id = '1f234c27-c0e6-4fd8-857e-0ffbd473183e';  -- «Джо Гомес» (fame=81)
-- Joshua Zirkzee: keep «Джошуа Зиркзе» [player | pv=21196 | fame=84] — same photo, same pageviews
UPDATE cards SET active = false WHERE id = 'db3d2b13-46c3-4489-beae-2c7a1d485f94';  -- «Джошуа Зиркзее» (fame=33)
-- José María Giménez: keep «Хосе Мария Хименес де Варгас» [player | pv=12572 | fame=67] — same photo
UPDATE cards SET active = false WHERE id = 'cd5a157b-4af8-4546-87ab-f1f883300fbc';  -- «Хосе Хименес» (fame=67)
-- João Moutinho: keep «Жоау Моутинью» [player | pv=25980 | fame=70] — same photo, same pageviews
UPDATE cards SET active = false WHERE id = '918153e9-ce37-4553-b71a-2cf899915929';  -- «Жоау Моутиньо» (fame=35)
-- Jude Bellingham: keep «Беллингем» [player | pv=1519 | fame=7] — same photo
UPDATE cards SET active = false WHERE id = 'e2f4c572-69bf-4d89-b19f-6b886174fff0';  -- «Джуд Беллингем» (fame=99)
-- Kaio Pantaleão: keep «Кайо Панталеан» [player | pv=11936 | fame=28] — same photo
UPDATE cards SET active = false WHERE id = '9307736f-2070-4051-8031-428f4dafdfc0';  -- «Кайо Панталеао» (fame=23)
-- Kevin De Bruyne: keep «Кевин Де Брёйне» [player | pv=180915 | fame=98] — same photo
UPDATE cards SET active = false WHERE id = '1cce0c66-5d50-47f6-9bb4-e93679a56cbf';  -- «Кевин Де Брюйне» (fame=98)
-- Kristijan Bistrović: keep «Кристиян Бистрович» [player | pv=21559 | fame=33] — same photo
UPDATE cards SET active = false WHERE id = '82ffe678-7c63-4160-aa68-3d15d84f63cb';  -- «Кристиан Бистрович» (fame=13)
-- Leandro Trossard: keep «Леандро Троссард» [player | pv=35836 | fame=91] — same photo, same pageviews
UPDATE cards SET active = false WHERE id = '33b5bb91-0ecf-4042-ba7c-affd210a0b1c';  -- «Леандро Троссар» (fame=40)
-- Levi Colwill: keep «Леви Колуилл» [player | pv=14799 | fame=29] — same photo
UPDATE cards SET active = false WHERE id = 'afb75544-0ded-4f44-8286-b7777a111215';  -- «Леви Колвилл» (fame=73)
-- Lucas Hernandez: keep «Лукас Эрнандес» [player | pv=61831 | fame=85] — same photo, same pageviews
UPDATE cards SET active = false WHERE id = '5833a367-c114-4272-8a32-ddc338ca8b4c';  -- «Люка Эрнандес» (fame=48)
-- Lukas Hradecky: keep «Лукаш Градецкий» [player | pv=43512 | fame=58] — same photo, same pageviews
UPDATE cards SET active = false WHERE id = '4c88d966-3228-40e7-b90c-19e4f1fae80b';  -- «Лукаш Градецки» (fame=42)
-- Marc-André ter Stegen: keep «Марк-Андре Тер Стеген» [player | pv=83781 | fame=91] — same photo
UPDATE cards SET active = false WHERE id = 'ef85ba36-9582-4dec-b356-95590e4e5282';  -- «Марк-Андре Тер Штеген» (fame=91)
-- Marcelo Brozović: keep «Марцело Брозович» [player | pv=43175 | fame=66] — same photo, same pageviews
UPDATE cards SET active = false WHERE id = '09d2eee4-7f9f-4903-a41a-3b920cdf39b7';  -- «Марсело Брозович» (fame=42)
-- Marcus Rashford: keep «Маркус Рашфорд» [player | pv=72026 | fame=99] — same photo
UPDATE cards SET active = false WHERE id = '35c0c189-17a5-4b28-a2a8-3b340a55b668';  -- «Маркус Рэшфорд» (fame=99)
-- Marcus Thuram: keep «Маркюс Тюрам» [player | pv=76171 | fame=51] — same photo
UPDATE cards SET active = false WHERE id = '2d5c5393-5247-4200-880c-5c7c5ecd3a3d';  -- «Маркус Тюрам» (fame=86)
-- Mason Mount: keep «Мейсон Маунт» [player | pv=50685 | fame=90] — same photo
UPDATE cards SET active = false WHERE id = '5be01ec4-b611-4121-88c2-4486fe46c6a6';  -- «Мэйсон Маунт» (fame=90)
-- Mattia De Sciglio: keep «Маттия Де Шильо» [player | pv=7729 | fame=23] — same photo, same pageviews
UPDATE cards SET active = false WHERE id = 'a3272f92-e7b8-4f77-8982-062a7ce7f1c8';  -- «Маттиа Де Шильо» (fame=22)
-- Mikel Merino: keep «Микель Мерино» [player | pv=11896 | fame=91] — same photo, same pageviews
UPDATE cards SET active = false WHERE id = 'fa687d29-7c23-4ddd-a94f-3012a5b34665';  -- «Микел Мерино» (fame=27)
-- Mohamed Salah: keep «Мохаммед Салах» [player | pv=218564 | fame=100] — same photo
UPDATE cards SET active = false WHERE id = '118ac6e7-070f-497f-9dbf-e0fc7c9e8691';  -- «Мохамед Салах» (fame=100)
-- Moise Kean: keep «Мойзе Кен» [player | pv=24075 | fame=83] — same photo
UPDATE cards SET active = false WHERE id = 'e9384bfe-848f-4164-b086-245249a0f4ce';  -- «Мойзе Кин» (fame=83)
-- Mykhailo Mudryk: keep «Михаил Мудрик» [player | pv=420380 | fame=94] — same photo
UPDATE cards SET active = false WHERE id = '743430cc-7e42-4802-8775-ad03edccce35';  -- «Михаил Петрович Мудрик» (fame=94)
-- Mário Fernandes: keep «Марио Фигейра Фернандес» [player | pv=88088 | fame=54] — same photo
UPDATE cards SET active = false WHERE id = '08a26ad0-139d-4d8f-9032-e3024c5d154b';  -- «Марио Фернандес» (fame=36)
-- Nicola Zalewski: keep «Никола Залевский» [player | pv=9339 | fame=54] — same photo, same pageviews
UPDATE cards SET active = false WHERE id = 'ec762158-1051-4b45-bfb7-cb4a6570da00';  -- «Никола Залевски» (fame=24)
-- Nuraly Alip: keep «Нуралы Пактулы Алип» [player | pv=30395 | fame=38] — same photo
UPDATE cards SET active = false WHERE id = '6a574fcc-f29f-4af3-8b10-80f3742d6d61';  -- «Нуралы Алип» (fame=32)
-- Nélson Semedo: keep «Нелсон Семеду» [player | pv=13442 | fame=74] — same photo, same pageviews
UPDATE cards SET active = false WHERE id = 'b8d6b610-d1f4-4b1c-b7ca-f4baf71318d8';  -- «Нельсон Семеду» (fame=28)
-- Oleksandr Zinchenko: keep «Александр Зинченко» [player | pv=242299 | fame=74] — same photo
UPDATE cards SET active = false WHERE id = '3f31f017-5105-4833-9cca-e5f26a718b48';  -- «Александр Владимирович Зинченко» (fame=85)
-- Oliver Baumann: keep «Оливер Бауман» [player | pv=8821 | fame=64] — same photo
UPDATE cards SET active = false WHERE id = 'd26d9838-1285-42bc-a1c8-d7bb1e7834e4';  -- «Оливер Бауманн» (fame=64)
-- Philippe Coutinho: keep «Филипе Коутиньо» [player | pv=107368 | fame=93] — same photo
UPDATE cards SET active = false WHERE id = 'dd209fe0-5fcb-40dd-9c72-01dd3b7cf9b5';  -- «Филиппе Коутиньо» (fame=93)
-- Rafael Leão: keep «Рафаэл Леан» [player | pv=62604 | fame=87] — same photo
UPDATE cards SET active = false WHERE id = 'ed49b07b-075b-4521-b0a8-a56d3242afc5';  -- «Рафаэл Леау» (fame=87)
-- Riyad Mahrez: keep «Рияд Махрез» [player | pv=63345 | fame=93] — same photo
UPDATE cards SET active = false WHERE id = '16be5543-2340-4ad0-b70a-20f88b2b3f3d';  -- «Рияд Марез» (fame=93)
-- Robert Lewandowski: keep «Роберт Левандовский» [player | pv=367583 | fame=99] — same photo
UPDATE cards SET active = false WHERE id = 'de9739b3-463b-491c-b659-9c1c080e1288';  -- «Роберт Левандовски» (fame=99)
-- Roman Yaremchuk: keep «Роман Олегович Яремчук» [player | pv=62623 | fame=50] — same photo, same pageviews
UPDATE cards SET active = false WHERE id = '2506d513-516e-4b98-b2a6-c0347ad50101';  -- «Роман Яремчук» (fame=48)
-- Ruslan Malinovskyi: keep «Руслан Владимирович Малиновский» [player | pv=94699 | fame=56] — same photo, same pageviews
UPDATE cards SET active = false WHERE id = '4a313190-1e20-4bae-aa55-7856675bdd3d';  -- «Руслан Малиновский» (fame=56)
-- Sadio Mané: keep «Садио Мане» [player | pv=223547 | fame=98] — same photo, same pageviews
UPDATE cards SET active = false WHERE id = 'f95d6ded-1947-4975-94e3-1f6d4927dd28';  -- «Садьо Мане» (fame=72)
-- Salomón Rondón: keep «Хосе Саломон Рондон» [player | pv=24751 | fame=69] — same photo
UPDATE cards SET active = false WHERE id = 'ae012c74-c06c-4bb9-8b8f-271c1e61e522';  -- «Саломон Рондон» (fame=69)
-- Sami Hyypiä: keep «Сами Хююпия» [player | pv=190 | fame=61] — same photo
UPDATE cards SET active = false WHERE id = 'c5da3913-1205-4915-a96f-f65f65b76bbd';  -- «Сами Хююпя» (fame=61)
-- Samuel Eto'o: keep «Самюэль Это'о» [player | pv=1098 | fame=94] — same photo
UPDATE cards SET active = false WHERE id = 'afcd279f-97d0-4aec-ba23-524d00a97065';  -- «Самюэль Это’о» (fame=94)
-- Samuel Gigot: keep «Самюэль Жиго» [player | pv=21043 | fame=34] — same photo
UPDATE cards SET active = false WHERE id = '632c2a0b-e53a-41de-8623-e6387cf8964a';  -- «Самуэль Жиго» (fame=34)
-- Sporting CP: keep «Спортинг» [club | pv=96056 | fame=94] — same photo
UPDATE cards SET active = false WHERE id = 'b61769fb-e2f2-4f34-8737-5c6289c90e03';  -- «Спортинг Лиссабон» (fame=22)
-- Strahinja Eraković: keep «Страхинья Эракович» [player | pv=21909 | fame=34] — same photo
UPDATE cards SET active = false WHERE id = 'a87c79db-83bd-417c-b1bd-1f79751dd9e6';  -- «Страхиня Эракович» (fame=33)
-- Viktor Kovalenko: keep «Виктор Викторович Коваленко» [player | pv=27944 | fame=36] — same photo, same pageviews
UPDATE cards SET active = false WHERE id = '113a9ad4-5013-4186-ae2b-6c450e0fc434';  -- «Виктор Коваленко» (fame=36)
-- Vitaliy Mykolenko: keep «Виталий Сергеевич Миколенко» [player | pv=37785 | fame=52] — same photo, same pageviews
UPDATE cards SET active = false WHERE id = 'c6771c5b-4747-43a2-85b2-e722c3d22893';  -- «Виталий Миколенко» (fame=52)
-- Weston McKennie: keep «Уэстон Маккенни» [player | pv=17883 | fame=88] — same photo, same pageviews
UPDATE cards SET active = false WHERE id = '37aa9b89-413e-4a8d-9e47-95abc19d0ef9';  -- «Уэстон Маккени» (fame=31)
-- Wissam Ben Yedder: keep «Виссам Бен Йеддер» [player | pv=34888 | fame=65] — same photo, same pageviews
UPDATE cards SET active = false WHERE id = '86600031-ab22-484f-8438-b073501e5e4a';  -- «Висса Бен Йеддер» (fame=40)
-- Wojciech Szczęsny: keep «Войцех Щенсный» [player | pv=52945 | fame=87] — same photo, same pageviews
UPDATE cards SET active = false WHERE id = '59854e79-f784-4593-9bb9-e40084b7f248';  -- «Войцех Щенсны» (fame=45)
-- Yann Sommer: keep «Янн Зоммер» [player | pv=76398 | fame=75] — same photo, same pageviews
UPDATE cards SET active = false WHERE id = '418cf25a-ecf6-4355-a54a-0429ab7e0857';  -- «Ян Зоммер» (fame=51)
-- Yehor Yarmolyuk: keep «Егор Романович Ярмолюк» [player | pv=22258 | fame=47] — same photo, same pageviews
UPDATE cards SET active = false WHERE id = '4d2d6597-a0c2-49e9-9683-8bf222fdc122';  -- «Егор Ярмолюк» (fame=47)

-- ============ REVIEW: 11 groups — ALL RESOLVED, none by name alone ============
-- Different people can share a name, so the same name_en decides nothing by
-- itself here. Every group below was resolved against `country`/`top_club`/
-- `top_league`/`facts->>'position'` — the fields a REAL duplicate import
-- leaves either matching (same person, two records) or absent (a thin stub
-- next to a full record), and a same-named DIFFERENT person leaves
-- genuinely disagreeing. 6 groups turned out to be duplicates and are
-- applied; 5 turned out to be real distinct people or real distinct
-- concepts and are closed without touching `active` — re-opening any of the
-- 5 needs a reason beyond "same name_en", because that reason was already
-- checked and rejected once.
--
--   Arthur — ✋ NOT A DUPLICATE, closed 2026-08-23. Different clubs
--   (Zenit vs Bayer 04) AND different positions (forward vs defender) —
--   two different Brazilian players who happen to share a common name.
--     «Артур» [player | pv=14826 | photo=y] 76864cb4-7821-482d-bf7f-481f47097296 — Zenit, forward
--     «Артур Де Матос Соарес» [player | pv=9103 | photo=y] bbc5145a-83c8-4cb8-80c6-d79b6ed4f709 — Bayer 04, defender
--
--   Club América — ✅ APPLIED 2026-08-23. Same name_en, same real club;
--   the losing record has no country, no club data, pv=2 — a stub import,
--   not a second real entity.
UPDATE cards SET active = false WHERE id = '64e66edc-8ca4-456a-abd2-1c508738658d';  -- «Америка (Мехико)» [club | pv=2] — stub, no country
--     «Клуб Америка» [club | pv=62220 | photo=n] 4d8da532-22b8-4bba-af5b-70cf8cc77b4a — KEPT, country=MX
--
--   Dante — ✅ APPLIED 2026-08-23. «Данте» carries no country/club/league/
--   position at all despite decent pageviews — a thin duplicate, not a
--   second player. The fuller record's club (Nice) and position (defender)
--   match the real Dante Bonfim Costa Santos exactly.
UPDATE cards SET active = false WHERE id = '48a09b0c-d42f-4104-b521-62523a3db684';  -- «Данте» [player | pv=10118] — no distinguishing fields at all
--     «Данте Бонфин Коста Сантос» [player | pv=17886 | photo=y] ea03a9ed-a54d-49d5-a136-a14bf280336b — KEPT, Ницца, defender
--
--   Defender — ✋ NOT A DUPLICATE, closed 2026-08-23. «Латераль» (fullback)
--   is a SPECIFIC role under the general position, not a synonym for it —
--   same relationship as Winger/Playmaker under Midfielder below.
--     «Защитник» [position | pv=4049 | photo=n] c8cce11d-5fab-4b0d-a56e-0dcd1970098b — general term
--     «Латераль» [position | pv=1327 | photo=n] 8eec7fda-e980-44a4-ac91-ddcbae31b037 — specific role (fullback)
--
--   Forward — ✋ NOT A DUPLICATE, closed 2026-08-23. Same relationship as
--   Defender above: «Ложная девятка» (false nine) is a specific tactical
--   role, not a synonym for the general position.
--     «Ложная девятка» [position | pv=857 | photo=n] 579266e7-25d6-4239-a2d9-a91af32d9bdc — specific role (false nine)
--     «Нападающий» [position | pv=148 | photo=n] 7836121a-e3f6-4d12-80ce-3c3aa9b052bd — general term
--
--   Free kick — ✅ APPLIED 2026-08-23. Not two concepts — «свободный
--   удар» and «штрафной удар» are the formal-vs-colloquial Russian names
--   for the same rule, unlike the position pairs above.
UPDATE cards SET active = false WHERE id = '63540638-bb13-4859-9fe4-2a499884e143';  -- «Штрафной удар» [term | pv=493] — colloquial synonym
--     «Свободный удар» [term | pv=581 | photo=n] 9fec2b90-24e8-4604-8973-36f9682f43dd — KEPT (higher pageviews, per keep-rule)
--
--   Midfielder — SPLIT DECISION, 2026-08-23. Four cards, not a pair.
--   «Хавбек» is a dated loanword synonym for the general position — merged.
--   «Вингер» and «Плеймейкер» are specific tactical roles, same relationship
--   as Defender/Forward above — NOT touched, stay distinct from the general
--   term and from each other.
--     «Вингер» [position | pv=10580 | photo=n] 84a53b7d-f352-455d-ab2f-818859c91c7e — specific role (winger), not a duplicate
--     «Плеймейкер» [position | pv=1249 | photo=n] 62cd44f5-9498-46dc-9456-940e82cf811c — specific role (playmaker), not a duplicate
UPDATE cards SET active = false WHERE id = 'f25885df-e3b8-4b8c-8b53-805fa3d1ad51';  -- «Хавбек» [position | pv=84] — dated synonym for the general term
--     «Полузащитник» [position | pv=1058 | photo=n] 0b85b484-35e2-4c31-a324-9d419ded8306 — KEPT, general term
--
--   Rodri — ✋ NOT A DUPLICATE, closed 2026-08-23. Different clubs
--   (Man City vs Real Betis) and the surnames don't match the same real
--   person (Hernández Cascante vs Sánchez Rodríguez) — two different
--   Spanish players who both go by "Rodri".
--     «Родриго Эрнандес» [player | pv=75742 | photo=y] 3cd0a996-483d-442a-88db-6a3efed61dac — Manchester City
--     «Родриго Санчес Родригес» [player | pv=3193 | photo=n] b31c84f8-7a40-45e1-a3db-3e17eda9c770 — Real Betis
--
--   UEFA Champions League  [CROSS-CATEGORY] — ✅ APPLIED 2026-08-23,
--   confirmed same tournament, not a judgement call despite the
--   cross-category flag
--     «Лига чемпионов УЕФА» [trophy | pv=773949 | fame=100 | photo=y] cf275ec1-5e0b-45d5-93bc-427fb0dbef90 — KEPT
UPDATE cards SET active = false WHERE id = 'd404d700-3835-4ef2-ba30-52b401784dcc';  -- «Лига Чемпионов» [term | pv=115]
--   UEFA Europa League  [CROSS-CATEGORY] — ✅ APPLIED 2026-08-23, same reasoning
--     «Лига Европы УЕФА» [trophy | pv=265599 | fame=98 | photo=n] 942f5bb0-ef8f-4dc2-bb98-c10b26b4aaae — KEPT
UPDATE cards SET active = false WHERE id = 'a0296414-ebd0-4743-b9c0-db7c84f1881c';  -- «Лига Европы» [term | pv=1335]
--
--   Vitinha — ✋ NOT A DUPLICATE, closed 2026-08-23. Different clubs (PSG
--   vs Marseille), different positions (midfielder vs forward), and the
--   fuller name doesn't match PSG's Vitinha (Vítor Machado Ferreira) —
--   two different Portuguese players who both go by "Vitinha".
--     «Витор Феррейра» [player | pv=27767 | photo=y] 69589606-8c6b-46a5-bc83-592f4210abf8 — PSG, midfielder
--     «Витор Мануэл Карвалью Оливейра» [player | pv=3314 | photo=y] dd5a304f-e8ad-48c6-82ac-3e2bf7ec1084 — Марсель, forward
