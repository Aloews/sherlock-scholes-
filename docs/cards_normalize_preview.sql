-- PREVIEW ONLY — do not run until approved.
-- 402 UPDATE (rename), 133 DELETE (dup of OLD), 0 DELETE (dup of NEW)

BEGIN;

-- 1) RENAME scraped cards to manual format (forbidden_words rebuilt from the normalized name)
UPDATE cards SET name = 'Тайво Авоньи', forbidden_words = ARRAY['Тайво Авоньи','Тайво','Авоньи']::text[] WHERE id = 'af60e771-f7d5-4cd1-8f69-fdb191532621';  -- was Авоньи, Тайво
UPDATE cards SET name = 'Найеф Агерд', forbidden_words = ARRAY['Найеф Агерд','Найеф','Агерд']::text[] WHERE id = 'c9eb11a9-1228-4faf-aa03-d5dd48961771';  -- was Агерд, Найеф
UPDATE cards SET name = 'Тайлер Адамс', forbidden_words = ARRAY['Тайлер Адамс','Тайлер','Адамс']::text[] WHERE id = '01c3ffc9-7ec6-4286-8dc2-b692ede0123a';  -- was Адамс, Тайлер
UPDATE cards SET name = 'Тосин Адарабиойо', forbidden_words = ARRAY['Тосин Адарабиойо','Тосин','Адарабиойо']::text[] WHERE id = '97132967-5389-48fb-b1f3-d0c59295c4f1';  -- was Адарабиойо, Тосин
UPDATE cards SET name = 'Симон Адингра', forbidden_words = ARRAY['Симон Адингра','Симон','Адингра']::text[] WHERE id = '40daf0a1-8435-489d-984e-a8b107ee570f';  -- was Адингра, Симон
UPDATE cards SET name = 'Адриан', forbidden_words = ARRAY['Адриан']::text[] WHERE id = '56a48573-120a-4cf2-8178-6fa5afaf7b2c';  -- was Адриан (футболист)
UPDATE cards SET name = 'Мануэль Аканджи', forbidden_words = ARRAY['Мануэль Аканджи','Мануэль','Аканджи']::text[] WHERE id = '8785caad-9519-4b23-8a01-22b9ebd2e8af';  -- was Аканджи, Мануэль
UPDATE cards SET name = 'Юнус Акгюн', forbidden_words = ARRAY['Юнус Акгюн','Юнус','Акгюн']::text[] WHERE id = 'ca4001dd-56c2-46c4-8733-d2274463c0ed';  -- was Акгюн, Юнус
UPDATE cards SET name = 'Натан Аке', forbidden_words = ARRAY['Натан Аке','Натан','Аке']::text[] WHERE id = '99afa2e2-4d56-4a09-96d4-4c14285c6bf1';  -- was Аке, Натан
UPDATE cards SET name = 'Эдсон Альварес', forbidden_words = ARRAY['Эдсон Альварес','Эдсон','Альварес']::text[] WHERE id = 'adb6d6d2-4777-4eda-ac5a-a747528fbd00';  -- was Альварес, Эдсон
UPDATE cards SET name = 'Тьяго Алькантара', forbidden_words = ARRAY['Тьяго Алькантара','Тьяго','Алькантара']::text[] WHERE id = '712d14df-ebbb-440d-b48e-821f5c4ed0cc';  -- was Алькантара, Тьяго
UPDATE cards SET name = 'Дэниел Амарти', forbidden_words = ARRAY['Дэниел Амарти','Дэниел','Амарти']::text[] WHERE id = '70e100da-5164-4c13-83c6-ce15ac8f61ec';  -- was Амарти, Дэниел
UPDATE cards SET name = 'Зеки Амдуни', forbidden_words = ARRAY['Зеки Амдуни','Зеки','Амдуни']::text[] WHERE id = '7513fa0e-d793-4cc5-9e78-60d04e340a95';  -- was Амдуни, Зеки
UPDATE cards SET name = 'Итан Ампаду', forbidden_words = ARRAY['Итан Ампаду','Итан','Ампаду']::text[] WHERE id = 'b294953b-ac22-4af2-b57a-4e964078e79d';  -- was Ампаду, Итан
UPDATE cards SET name = 'Йоаким Андерсен', forbidden_words = ARRAY['Йоаким Андерсен','Йоаким','Андерсен']::text[] WHERE id = '51e24ee0-8d54-4445-95bf-453a2b5e9a92';  -- was Андерсен, Йоаким
UPDATE cards SET name = 'Тино Анджорин', forbidden_words = ARRAY['Тино Анджорин','Тино','Анджорин']::text[] WHERE id = 'dc0815d9-9f44-43d1-9196-00200bc622ac';  -- was Анджорин, Тино
UPDATE cards SET name = 'Андре', forbidden_words = ARRAY['Андре']::text[] WHERE id = '0c03f18c-4af1-491d-b32b-66c548165efd';  -- was Андре (футболист, 2001)
UPDATE cards SET name = 'Антони', forbidden_words = ARRAY['Антони']::text[] WHERE id = '74ede627-ac86-45fc-9a66-02615ddc92a3';  -- was Антони (футболист)
UPDATE cards SET name = 'Майкл Антонио', forbidden_words = ARRAY['Майкл Антонио','Майкл','Антонио']::text[] WHERE id = '4f3cfb20-b233-4460-b307-bd9e02d3c59f';  -- was Антонио, Майкл
UPDATE cards SET name = 'Хулиан Араухо', forbidden_words = ARRAY['Хулиан Араухо','Хулиан','Араухо']::text[] WHERE id = '0515d6ad-9b01-470e-bf29-8b6e19246fdf';  -- was Араухо, Хулиан
UPDATE cards SET name = 'Альфонс Ареола', forbidden_words = ARRAY['Альфонс Ареола','Альфонс','Ареола']::text[] WHERE id = '07339231-502b-438d-8824-d3e7129f6ea3';  -- was Ареола, Альфонс
UPDATE cards SET name = 'Адам Армстронг', forbidden_words = ARRAY['Адам Армстронг','Адам','Армстронг']::text[] WHERE id = 'b75c19f8-deea-4c9b-a978-41f54039151b';  -- was Армстронг, Адам (футболист)
UPDATE cards SET name = 'Анел Ахмедходжич', forbidden_words = ARRAY['Анел Ахмедходжич','Анел','Ахмедходжич']::text[] WHERE id = '06236fac-a60e-4e02-b6a3-2cd9eeff1f20';  -- was Ахмедходжич, Анел
UPDATE cards SET name = 'Абдул Рахман Баба', forbidden_words = ARRAY['Абдул Рахман Баба','Абдул','Рахман','Баба']::text[] WHERE id = 'cb213c22-7a6a-43dc-8c62-7f0ef9fa8316';  -- was Баба, Абдул Рахман
UPDATE cards SET name = 'Бенуа Бадьяшиль', forbidden_words = ARRAY['Бенуа Бадьяшиль','Бенуа','Бадьяшиль']::text[] WHERE id = 'dcf36b5b-95d0-4718-be94-c7d738e9e78c';  -- was Бадьяшиль, Бенуа
UPDATE cards SET name = 'Эрик Байи', forbidden_words = ARRAY['Эрик Байи','Эрик','Байи']::text[] WHERE id = '1bc683b3-c4a9-42d8-a302-e98aaeec94ca';  -- was Байи, Эрик
UPDATE cards SET name = 'Стефан Байчетич', forbidden_words = ARRAY['Стефан Байчетич','Стефан','Байчетич']::text[] WHERE id = '6ea63873-8186-477a-b356-616200ecbe72';  -- was Байчетич, Стефан
UPDATE cards SET name = 'Алтай Байындыр', forbidden_words = ARRAY['Алтай Байындыр','Алтай','Байындыр']::text[] WHERE id = '18ee0a7d-68ce-4fee-8130-dad853670c35';  -- was Байындыр, Алтай
UPDATE cards SET name = 'Фоде Балло-Туре', forbidden_words = ARRAY['Фоде Балло-Туре','Фоде','Балло-Туре']::text[] WHERE id = 'cc126bb6-c58e-4a52-90c0-4e8f303a13c0';  -- was Балло-Туре, Фоде
UPDATE cards SET name = 'Фоларин Балоган', forbidden_words = ARRAY['Фоларин Балоган','Фоларин','Балоган']::text[] WHERE id = 'c8615f26-57e3-4e48-8f1c-2b71133f9e09';  -- was Балоган, Фоларин
UPDATE cards SET name = 'Рикарду Домингуш Барбоза Перейра', forbidden_words = ARRAY['Рикарду Домингуш Барбоза Перейра','Рикарду','Домингуш','Барбоза','Перейра']::text[] WHERE id = '86accbc7-23bf-4bae-b62e-84e00032312f';  -- was Барбоза Перейра, Рикарду Домингуш
UPDATE cards SET name = 'Росс Баркли', forbidden_words = ARRAY['Росс Баркли','Росс','Баркли']::text[] WHERE id = '3ff77a47-7373-4104-a0c2-1a1bd11628c5';  -- was Баркли, Росс
UPDATE cards SET name = 'Валентин Барко', forbidden_words = ARRAY['Валентин Барко','Валентин','Барко']::text[] WHERE id = '40aa42ac-f9d8-4f98-89a1-583cd8cc9db6';  -- was Барко, Валентин
UPDATE cards SET name = 'Харви Барнс', forbidden_words = ARRAY['Харви Барнс','Харви','Барнс']::text[] WHERE id = '4b05e96f-33d2-4890-a4e3-9ce2c057ab69';  -- was Барнс, Харви
UPDATE cards SET name = 'Джек Батленд', forbidden_words = ARRAY['Джек Батленд','Джек','Батленд']::text[] WHERE id = 'a996ba74-a009-43eb-97af-0b0f27d64664';  -- was Батленд, Джек
UPDATE cards SET name = 'Асмир Бегович', forbidden_words = ARRAY['Асмир Бегович','Асмир','Бегович']::text[] WHERE id = 'f61683ce-81d5-492c-b56d-f1c3f3a585ef';  -- was Бегович, Асмир
UPDATE cards SET name = 'Леон Бейли', forbidden_words = ARRAY['Леон Бейли','Леон','Бейли']::text[] WHERE id = '9fa6524e-da89-4c19-bf24-a811cb42c79a';  -- was Бейли, Леон
UPDATE cards SET name = 'Алисон Бекер', forbidden_words = ARRAY['Алисон Бекер','Алисон','Бекер']::text[] WHERE id = '0219aeea-fa06-470f-b5b2-ac1c3aa07360';  -- was Бекер, Алисон
UPDATE cards SET name = 'Армель Белла-Кочап', forbidden_words = ARRAY['Армель Белла-Кочап','Армель','Белла-Кочап']::text[] WHERE id = 'cc3b5e29-09b6-4f0e-a14f-9d97ac6f4d64';  -- was Белла-Кочап, Армель
UPDATE cards SET name = 'Эктор Бельерин', forbidden_words = ARRAY['Эктор Бельерин','Эктор','Бельерин']::text[] WHERE id = '91543995-9d97-4552-bca3-f7c213d0ad54';  -- was Бельерин, Эктор
UPDATE cards SET name = 'Вальтер Даниэль Бенитес', forbidden_words = ARRAY['Вальтер Даниэль Бенитес','Вальтер','Даниэль','Бенитес']::text[] WHERE id = 'ae34cb47-9aca-4595-8abd-654152959cfb';  -- was Бенитес, Вальтер Даниэль
UPDATE cards SET name = 'Саид Бенрахма', forbidden_words = ARRAY['Саид Бенрахма','Саид','Бенрахма']::text[] WHERE id = 'e2ec9ca9-778a-4569-8500-8eea16530b53';  -- was Бенрахма, Саид
UPDATE cards SET name = 'Кристиан Бентеке', forbidden_words = ARRAY['Кристиан Бентеке','Кристиан','Бентеке']::text[] WHERE id = '6cd517b1-3480-47e5-b45d-7b9585972ed0';  -- was Бентеке, Кристиан
UPDATE cards SET name = 'Лукас Бергвалль', forbidden_words = ARRAY['Лукас Бергвалль','Лукас','Бергвалль']::text[] WHERE id = '7f6a2c85-6b29-43a2-8c79-3d5b09270aa7';  -- was Бергвалль, Лукас
UPDATE cards SET name = 'Стивен Бергвейн', forbidden_words = ARRAY['Стивен Бергвейн','Стивен','Бергвейн']::text[] WHERE id = 'f48c803b-4223-43f6-80c1-8d23480de58d';  -- was Бергвейн, Стивен
UPDATE cards SET name = 'Сандер Берге', forbidden_words = ARRAY['Сандер Берге','Сандер','Берге']::text[] WHERE id = '2cdb3835-1db7-42b1-8412-69ebd6f36e3e';  -- was Берге, Сандер
UPDATE cards SET name = 'Дэн Берн', forbidden_words = ARRAY['Дэн Берн','Дэн','Берн']::text[] WHERE id = '581bcc94-4177-4aa7-bcf1-8f1fc0497ace';  -- was Берн, Дэн
UPDATE cards SET name = 'Райан Бертранд', forbidden_words = ARRAY['Райан Бертранд','Райан','Бертранд']::text[] WHERE id = '433a262e-ba6c-46c1-825d-2595a52a0b5e';  -- was Бертранд, Райан
UPDATE cards SET name = 'Маркус Беттинелли', forbidden_words = ARRAY['Маркус Беттинелли','Маркус','Беттинелли']::text[] WHERE id = 'ad13b326-298f-4dec-a257-1d23e76595f5';  -- was Беттинелли, Маркус
UPDATE cards SET name = 'Ив Биссума', forbidden_words = ARRAY['Ив Биссума','Ив','Биссума']::text[] WHERE id = 'a54fb62d-beff-4d8d-bec3-7f0e4b1cfed0';  -- was Биссума, Ив
UPDATE cards SET name = 'Оскар Бобб', forbidden_words = ARRAY['Оскар Бобб','Оскар','Бобб']::text[] WHERE id = 'd607ab9b-a24a-4e06-9f21-eee0246c89f6';  -- was Бобб, Оскар
UPDATE cards SET name = 'Вилли Боли', forbidden_words = ARRAY['Вилли Боли','Вилли','Боли']::text[] WHERE id = 'e876ea94-8985-4af6-a00d-95cab3963cf9';  -- was Боли, Вилли
UPDATE cards SET name = 'Джарред Брантуэйт', forbidden_words = ARRAY['Джарред Брантуэйт','Джарред','Брантуэйт']::text[] WHERE id = '800515c8-51e8-45e4-8142-55b459ae8421';  -- was Брантуэйт, Джарред
UPDATE cards SET name = 'Бен Бреретон', forbidden_words = ARRAY['Бен Бреретон','Бен','Бреретон']::text[] WHERE id = '089dd67a-1cd8-4a9f-835a-bc695ccc92fa';  -- was Бреретон, Бен
UPDATE cards SET name = 'Армандо Броя', forbidden_words = ARRAY['Армандо Броя','Армандо','Броя']::text[] WHERE id = '3f58ac52-db1e-4ebd-acc7-29fd69c8cd1c';  -- was Броя, Армандо
UPDATE cards SET name = 'Риан Брустер', forbidden_words = ARRAY['Риан Брустер','Риан','Брустер']::text[] WHERE id = '6195ecab-1965-4a08-8c84-a30fab342e1f';  -- was Брустер, Риан
UPDATE cards SET name = 'Конор Брэдли', forbidden_words = ARRAY['Конор Брэдли','Конор','Брэдли']::text[] WHERE id = 'b2ccfc72-c2a1-4ad4-b215-aea8a8e7decc';  -- was Брэдли, Конор
UPDATE cards SET name = 'Факундо Буонанотте', forbidden_words = ARRAY['Факундо Буонанотте','Факундо','Буонанотте']::text[] WHERE id = '27049d18-23d9-46d2-ab31-22fb1ed864fe';  -- was Буонанотте, Факундо
UPDATE cards SET name = 'Эмилиано Буэндия', forbidden_words = ARRAY['Эмилиано Буэндия','Эмилиано','Буэндия']::text[] WHERE id = 'b5e28483-b7da-4eb7-8550-7c93106c9efe';  -- was Буэндия, Эмилиано
UPDATE cards SET name = 'Патрик Бэмфорд', forbidden_words = ARRAY['Патрик Бэмфорд','Патрик','Бэмфорд']::text[] WHERE id = '5d8af28b-0430-4d7d-99a8-91eaab97edc4';  -- was Бэмфорд, Патрик
UPDATE cards SET name = 'Калвин Бэсси', forbidden_words = ARRAY['Калвин Бэсси','Калвин','Бэсси']::text[] WHERE id = '441679d5-1b08-4dab-9690-92895202769c';  -- was Бэсси, Калвин
UPDATE cards SET name = 'Донни Ван де Бек', forbidden_words = ARRAY['Донни Ван де Бек','Донни','Ван','де','Бек']::text[] WHERE id = '52f964eb-0c8f-4960-8468-d04ab92f44f4';  -- was Ван де Бек, Донни
UPDATE cards SET name = 'Микки Ван де Вен', forbidden_words = ARRAY['Микки Ван де Вен','Микки','Ван','де','Вен']::text[] WHERE id = '7237c8d7-9367-46c1-b5a7-221624777b8a';  -- was Ван де Вен, Микки
UPDATE cards SET name = 'Сепп Ван ден Берг', forbidden_words = ARRAY['Сепп Ван ден Берг','Сепп','Ван','ден','Берг']::text[] WHERE id = '4a1ed8c8-8615-4d9f-b38d-d7dffaf97d79';  -- was Ван ден Берг, Сепп
UPDATE cards SET name = 'Максимилиан Вёбер', forbidden_words = ARRAY['Максимилиан Вёбер','Максимилиан','Вёбер']::text[] WHERE id = '008c05fa-ff7e-46d6-bc42-b31f35f0278f';  -- was Вёбер, Максимилиан
UPDATE cards SET name = 'Алехо Велис', forbidden_words = ARRAY['Алехо Велис','Алехо','Велис']::text[] WHERE id = '39bbcaf3-ed30-49b9-b490-f267db3b27fa';  -- was Велис, Алехо (футболист)
UPDATE cards SET name = 'Джоэл Велтман', forbidden_words = ARRAY['Джоэл Велтман','Джоэл','Велтман']::text[] WHERE id = '0fc139f8-4dc3-4b9d-abef-b83233b21f90';  -- was Велтман, Джоэл
UPDATE cards SET name = 'Янник Вестергор', forbidden_words = ARRAY['Янник Вестергор','Янник','Вестергор']::text[] WHERE id = 'cbe60dd1-6bd9-4e0d-b48c-d0cdaa6f6ed0';  -- was Вестергор, Янник
UPDATE cards SET name = 'Фабиу Виейра', forbidden_words = ARRAY['Фабиу Виейра','Фабиу','Виейра']::text[] WHERE id = '9a508cea-b936-4e98-9170-1c2138342065';  -- was Виейра, Фабиу
UPDATE cards SET name = 'Гульельмо Викарио', forbidden_words = ARRAY['Гульельмо Викарио','Гульельмо','Викарио']::text[] WHERE id = '251b3ae9-724e-4574-9638-c8f446fa8a35';  -- was Викарио, Гульельмо
UPDATE cards SET name = 'Матиас Винья', forbidden_words = ARRAY['Матиас Винья','Матиас','Винья']::text[] WHERE id = 'bac2810b-e062-4acc-adc3-f272297a3a5b';  -- was Винья, Матиас
UPDATE cards SET name = 'Матс Виффер', forbidden_words = ARRAY['Матс Виффер','Матс','Виффер']::text[] WHERE id = '071929c5-ac51-4531-84df-e353f39e93f4';  -- was Виффер, Матс
UPDATE cards SET name = 'Одиссеас Влаходимос', forbidden_words = ARRAY['Одиссеас Влаходимос','Одиссеас','Влаходимос']::text[] WHERE id = 'ccbdd903-6206-4914-a7c4-47a00e75eb08';  -- was Влаходимос, Одиссеас
UPDATE cards SET name = 'Конор Галлахер', forbidden_words = ARRAY['Конор Галлахер','Конор','Галлахер']::text[] WHERE id = '57e3948f-9c4d-4c7d-8e18-2e75ec5fb7f6';  -- was Галлахер, Конор
UPDATE cards SET name = 'Джеймс Гарнер', forbidden_words = ARRAY['Джеймс Гарнер','Джеймс','Гарнер']::text[] WHERE id = 'a81f5acd-42fa-4cd9-b672-2da0db0c401a';  -- was Гарнер, Джеймс (футболист)
UPDATE cards SET name = 'Пауло Гассанига', forbidden_words = ARRAY['Пауло Гассанига','Пауло','Гассанига']::text[] WHERE id = '7f47ae7c-3fb4-4dc7-91cb-c991e3a6475e';  -- was Гассанига, Пауло
UPDATE cards SET name = 'Жан-Филипп Гбамен', forbidden_words = ARRAY['Жан-Филипп Гбамен','Жан-Филипп','Гбамен']::text[] WHERE id = 'a5c6ccb7-5983-4afe-bbd6-65413ec38a84';  -- was Гбамен, Жан-Филипп
UPDATE cards SET name = 'Гонсалу Гедеш', forbidden_words = ARRAY['Гонсалу Гедеш','Гонсалу','Гедеш']::text[] WHERE id = 'a8595852-e745-47a0-a6d5-d59bdb04f144';  -- was Гедеш, Гонсалу
UPDATE cards SET name = 'Марк Гехи', forbidden_words = ARRAY['Марк Гехи','Марк','Гехи']::text[] WHERE id = 'b00c3a42-6399-442a-9549-94644388d569';  -- was Гехи, Марк
UPDATE cards SET name = 'Алфи Гилкрист', forbidden_words = ARRAY['Алфи Гилкрист','Алфи','Гилкрист']::text[] WHERE id = '2e66a491-f99b-424e-aac2-88e69b545fc6';  -- was Гилкрист, Алфи
UPDATE cards SET name = 'Билли Гилмор', forbidden_words = ARRAY['Билли Гилмор','Билли','Гилмор']::text[] WHERE id = '80c91c53-035b-4b6e-a576-cd573d5a1b68';  -- was Гилмор, Билли
UPDATE cards SET name = 'Бруно Гимарайнс', forbidden_words = ARRAY['Бруно Гимарайнс','Бруно','Гимарайнс']::text[] WHERE id = '38c42d56-b78a-40c7-9417-e9815469f40f';  -- was Гимарайнс, Бруно
UPDATE cards SET name = 'Марк Гиу', forbidden_words = ARRAY['Марк Гиу','Марк','Гиу']::text[] WHERE id = '130d0811-c2ae-4810-a2bf-f8741150d8ad';  -- was Гиу, Марк
UPDATE cards SET name = 'Пьерлуиджи Голлини', forbidden_words = ARRAY['Пьерлуиджи Голлини','Пьерлуиджи','Голлини']::text[] WHERE id = '11263ba2-86a6-4b3c-ac93-d6a1b7023ac7';  -- was Голлини, Пьерлуиджи
UPDATE cards SET name = 'Жуан Гомес да Силва', forbidden_words = ARRAY['Жуан Гомес да Силва','Жуан','Гомес','да','Силва']::text[] WHERE id = '6087cd41-7938-4a78-a89d-1ee449ab9e38';  -- was Гомес да Силва, Жуан
UPDATE cards SET name = 'Серхио Гомес Мартин', forbidden_words = ARRAY['Серхио Гомес Мартин','Серхио','Гомес','Мартин']::text[] WHERE id = '7bcea338-8eb3-4500-b7db-590dec9eeae1';  -- was Гомес Мартин, Серхио
UPDATE cards SET name = 'Джозеф Гомес', forbidden_words = ARRAY['Джозеф Гомес','Джозеф','Гомес']::text[] WHERE id = 'f3b9923b-e3c6-4367-9d37-0750f67d64dd';  -- was Гомес, Джозеф
UPDATE cards SET name = 'Диего Гомес', forbidden_words = ARRAY['Диего Гомес','Диего','Гомес']::text[] WHERE id = '99217eb0-66f6-4ffd-aa67-36378f62c616';  -- was Гомес, Диего (парагвайский футболист)
UPDATE cards SET name = 'Норберту Берсике Гомеш Бетункал', forbidden_words = ARRAY['Норберту Берсике Гомеш Бетункал','Норберту','Берсике','Гомеш','Бетункал']::text[] WHERE id = '1837311c-9597-45f2-88ef-4a5d9f6edf1c';  -- was Гомеш Бетункал, Норберту Берсике
UPDATE cards SET name = 'Андре Гомеш', forbidden_words = ARRAY['Андре Гомеш','Андре','Гомеш']::text[] WHERE id = '5959b196-9323-4025-a116-f9bd13fc9bb5';  -- was Гомеш, Андре
UPDATE cards SET name = 'Иво Грбич', forbidden_words = ARRAY['Иво Грбич','Иво','Грбич']::text[] WHERE id = 'e30ddbb6-7446-4d70-bf29-27b0b1843795';  -- was Грбич, Иво
UPDATE cards SET name = 'Демарай Грей', forbidden_words = ARRAY['Демарай Грей','Демарай','Грей']::text[] WHERE id = '46744d4c-98ff-436b-ba19-8307bd820ed3';  -- was Грей, Демарай
UPDATE cards SET name = 'Джек Грилиш', forbidden_words = ARRAY['Джек Грилиш','Джек','Грилиш']::text[] WHERE id = '77be2b84-ee07-4b7e-a591-42747f71104d';  -- was Грилиш, Джек
UPDATE cards SET name = 'Мейсон Гринвуд', forbidden_words = ARRAY['Мейсон Гринвуд','Мейсон','Гринвуд']::text[] WHERE id = 'cee65ce2-4faf-4c1e-bb34-6b5295e63a54';  -- was Гринвуд, Мейсон
UPDATE cards SET name = 'Паскаль Грос', forbidden_words = ARRAY['Паскаль Грос','Паскаль','Грос']::text[] WHERE id = '42f2a492-4464-4aeb-a46a-a6735c3a2438';  -- was Грос, Паскаль
UPDATE cards SET name = 'Илкай Гюндоган', forbidden_words = ARRAY['Илкай Гюндоган','Илкай','Гюндоган']::text[] WHERE id = 'f67b5d3a-cc66-46b1-9e77-d8747413f855';  -- was Гюндоган, Илкай
UPDATE cards SET name = 'Мало Гюсто', forbidden_words = ARRAY['Мало Гюсто','Мало','Гюсто']::text[] WHERE id = 'd19e7174-cef2-4a07-b9d3-7d197e970c38';  -- was Гюсто, Мало
UPDATE cards SET name = 'Патсон Дака', forbidden_words = ARRAY['Патсон Дака','Патсон','Дака']::text[] WHERE id = 'c807beac-a927-40e7-a9c6-a0ac805a8d3e';  -- was Дака, Патсон
UPDATE cards SET name = 'Диогу Дало', forbidden_words = ARRAY['Диогу Дало','Диогу','Дало']::text[] WHERE id = 'ab2d5866-4ea4-449b-9de9-282771ada82d';  -- was Дало, Диогу
UPDATE cards SET name = 'Миккель Дамсгор', forbidden_words = ARRAY['Миккель Дамсгор','Миккель','Дамсгор']::text[] WHERE id = 'd29c5649-6cdc-40e8-a409-25b6cd7ce062';  -- was Дамсгор, Миккель
UPDATE cards SET name = 'Льюис Данк', forbidden_words = ARRAY['Льюис Данк','Льюис','Данк']::text[] WHERE id = '6c2a4cfa-bb2b-4069-bf27-7c9072a50f4f';  -- was Данк, Льюис
UPDATE cards SET name = 'Кевин Дансо', forbidden_words = ARRAY['Кевин Дансо','Кевин','Дансо']::text[] WHERE id = '22a729df-3b2b-4cd5-b006-33833f1b692c';  -- was Дансо, Кевин
UPDATE cards SET name = 'Махмуд Дауд', forbidden_words = ARRAY['Махмуд Дауд','Махмуд','Дауд']::text[] WHERE id = '319ae702-fdb4-4997-a38a-5375b7902b48';  -- was Дауд, Махмуд
UPDATE cards SET name = 'Кевин Де Брёйне', forbidden_words = ARRAY['Кевин Де Брёйне','Кевин','Де','Брёйне']::text[] WHERE id = '64a17dc4-8d8b-403b-9304-08c04cc2f35b';  -- was Де Брёйне, Кевин
UPDATE cards SET name = 'Маттейс Де Лигт', forbidden_words = ARRAY['Маттейс Де Лигт','Маттейс','Де','Лигт']::text[] WHERE id = 'f3679310-1856-45b0-9c1c-aa46a43c1414';  -- was Де Лигт, Маттейс
UPDATE cards SET name = 'Фабиан Делф', forbidden_words = ARRAY['Фабиан Делф','Фабиан','Делф']::text[] WHERE id = 'ab19e9a3-487e-4052-b9ec-3c73fef7bdaf';  -- was Делф, Фабиан
UPDATE cards SET name = 'Леандер Дендонкер', forbidden_words = ARRAY['Леандер Дендонкер','Леандер','Дендонкер']::text[] WHERE id = '3e6ead2c-fc5d-4ca9-9f0d-00477ca70ba5';  -- was Дендонкер, Леандер
UPDATE cards SET name = 'Дэниел Джеймс', forbidden_words = ARRAY['Дэниел Джеймс','Дэниел','Джеймс']::text[] WHERE id = '82e2b362-5f9d-49d9-9058-787262b1a284';  -- was Джеймс, Дэниел
UPDATE cards SET name = 'Николас Джексон', forbidden_words = ARRAY['Николас Джексон','Николас','Джексон']::text[] WHERE id = 'feaba073-b3d8-4f11-be17-067f2f4d9bc2';  -- was Джексон, Николас
UPDATE cards SET name = 'Кертис Джонс', forbidden_words = ARRAY['Кертис Джонс','Кертис','Джонс']::text[] WHERE id = 'b1149c23-781d-48e3-9a21-9e457b03f754';  -- was Джонс, Кертис (футболист)
UPDATE cards SET name = 'Сэм Джонстон', forbidden_words = ARRAY['Сэм Джонстон','Сэм','Джонстон']::text[] WHERE id = '66ca3651-2c25-4986-abec-d259670415f8';  -- was Джонстон, Сэм
UPDATE cards SET name = 'Мусса Диаби', forbidden_words = ARRAY['Мусса Диаби','Мусса','Диаби']::text[] WHERE id = '2fa1d71a-93c1-4f01-ae0e-907d21e75341';  -- was Диаби, Мусса
UPDATE cards SET name = 'Амад Диалло', forbidden_words = ARRAY['Амад Диалло','Амад','Диалло']::text[] WHERE id = '9479ee2b-a68a-40f9-b3fd-b06d26570825';  -- was Диалло, Амад
UPDATE cards SET name = 'Луис Фернандо Диас', forbidden_words = ARRAY['Луис Фернандо Диас','Луис','Фернандо','Диас']::text[] WHERE id = 'b8f679af-22ff-43af-a097-2a7515e30312';  -- was Диас, Луис Фернандо
UPDATE cards SET name = 'Рубен Диаш', forbidden_words = ARRAY['Рубен Диаш','Рубен','Диаш']::text[] WHERE id = '58229404-b223-4842-8a28-230c0b63f2cf';  -- was Диаш, Рубен
UPDATE cards SET name = 'Диего Карлос', forbidden_words = ARRAY['Диего Карлос','Диего','Карлос']::text[] WHERE id = 'c5344eef-9e34-45d1-9c0c-955a8eb82dc1';  -- was Диего Карлос (футболист, 1993)
UPDATE cards SET name = 'Люка Динь', forbidden_words = ARRAY['Люка Динь','Люка','Динь']::text[] WHERE id = '1d01e06e-f301-48d0-b846-23a28710cb2b';  -- was Динь, Люка
UPDATE cards SET name = 'Аксель Дисаси', forbidden_words = ARRAY['Аксель Дисаси','Аксель','Дисаси']::text[] WHERE id = '3bc031b2-703c-40fc-8191-68de15fee8af';  -- was Дисаси, Аксель
UPDATE cards SET name = 'Томми Дойл', forbidden_words = ARRAY['Томми Дойл','Томми','Дойл']::text[] WHERE id = '58b13e0c-4fc4-4e62-958c-9889e7adc1a0';  -- was Дойл, Томми
UPDATE cards SET name = 'Жереми Доку', forbidden_words = ARRAY['Жереми Доку','Жереми','Доку']::text[] WHERE id = '951f60d6-3f64-4b86-af3b-325fb0473ecb';  -- was Доку, Жереми
UPDATE cards SET name = 'Мэтт Доэрти', forbidden_words = ARRAY['Мэтт Доэрти','Мэтт','Доэрти']::text[] WHERE id = 'dbc15bb4-6bbf-432d-9bcd-4dff2f66fe9d';  -- was Доэрти, Мэтт
UPDATE cards SET name = 'Дэнни Дринкуотер', forbidden_words = ARRAY['Дэнни Дринкуотер','Дэнни','Дринкуотер']::text[] WHERE id = '75261dda-5c5c-4cf0-8ba5-f82175c4c1da';  -- was Дринкуотер, Дэнни
UPDATE cards SET name = 'Раду Дрэгушин', forbidden_words = ARRAY['Раду Дрэгушин','Раду','Дрэгушин']::text[] WHERE id = '4d9d344b-c53c-4c5f-ae41-ad85dccc249e';  -- was Дрэгушин, Раду
UPDATE cards SET name = 'Абдулай Дукуре', forbidden_words = ARRAY['Абдулай Дукуре','Абдулай','Дукуре']::text[] WHERE id = 'e99ff287-ec29-491a-a0b1-012f00bdf62a';  -- was Дукуре, Абдулай
UPDATE cards SET name = 'Шейк Дукуре', forbidden_words = ARRAY['Шейк Дукуре','Шейк','Дукуре']::text[] WHERE id = '1da38e29-a0ef-4933-85d7-f5c28746f4eb';  -- was Дукуре, Шейк (футболист, 2000)
UPDATE cards SET name = 'Джон Дуран', forbidden_words = ARRAY['Джон Дуран','Джон','Дуран']::text[] WHERE id = 'aedbef9b-eae0-4a89-bbeb-f80baf92091f';  -- was Дуран, Джон
UPDATE cards SET name = 'Кирнан Дьюзбери-Холл', forbidden_words = ARRAY['Кирнан Дьюзбери-Холл','Кирнан','Дьюзбери-Холл']::text[] WHERE id = 'f3de54e4-976c-4c25-a7dd-f1a3d0f16859';  -- was Дьюзбери-Холл, Кирнан
UPDATE cards SET name = 'Габриэл Жезус', forbidden_words = ARRAY['Габриэл Жезус','Габриэл','Жезус']::text[] WHERE id = '77efecc9-129d-46e1-969d-95683f52e828';  -- was Жезус, Габриэл
UPDATE cards SET name = 'Жуан Педро', forbidden_words = ARRAY['Жуан Педро','Жуан','Педро']::text[] WHERE id = '264352b7-0f55-4cef-ad68-f735ed3df810';  -- was Жуан Педро (футболист, 2001)
UPDATE cards SET name = 'Вильфрид Заа', forbidden_words = ARRAY['Вильфрид Заа','Вильфрид','Заа']::text[] WHERE id = 'c5ab83b3-3347-4d4f-b3fb-a1a5f68fa7ba';  -- was Заа, Вильфрид
UPDATE cards SET name = 'Илья Борисович Забарный', forbidden_words = ARRAY['Илья Борисович Забарный','Илья','Борисович','Забарный']::text[] WHERE id = '1791d9ba-655d-426b-83ad-c660f1a578f0';  -- was Забарный, Илья Борисович
UPDATE cards SET name = 'Хаким Зиеш', forbidden_words = ARRAY['Хаким Зиеш','Хаким','Зиеш']::text[] WHERE id = 'b76cd159-d31e-4213-a33e-644dd5c3f57b';  -- was Зиеш, Хаким
UPDATE cards SET name = 'Александр Владимирович Зинченко', forbidden_words = ARRAY['Александр Владимирович Зинченко','Александр','Владимирович','Зинченко']::text[] WHERE id = '3f31f017-5105-4833-9cca-e5f26a718b48';  -- was Зинченко, Александр Владимирович
UPDATE cards SET name = 'Джошуа Зиркзе', forbidden_words = ARRAY['Джошуа Зиркзе','Джошуа','Зиркзе']::text[] WHERE id = 'aa939222-2a01-44ed-b73e-6088387dc6b5';  -- was Зиркзе, Джошуа
UPDATE cards SET name = 'Сэмьюэл Илинг-Джуниор', forbidden_words = ARRAY['Сэмьюэл Илинг-Джуниор','Сэмьюэл','Илинг-Джуниор']::text[] WHERE id = 'f5a1d1c4-ead5-4aeb-ae5a-486acf6b6d3c';  -- was Илинг-Джуниор, Сэмьюэл
UPDATE cards SET name = 'Дэнни Ингз', forbidden_words = ARRAY['Дэнни Ингз','Дэнни','Ингз']::text[] WHERE id = 'c662a1ca-323c-47cd-bd65-7dd67c72dd6c';  -- was Ингз, Дэнни
UPDATE cards SET name = 'Ко Итакура', forbidden_words = ARRAY['Ко Итакура','Ко','Итакура']::text[] WHERE id = 'ec2d64da-93b7-4c96-9fc6-c788fd4d67f6';  -- was Итакура, Ко
UPDATE cards SET name = 'Келечи Ихеаначо', forbidden_words = ARRAY['Келечи Ихеаначо','Келечи','Ихеаначо']::text[] WHERE id = '4aa7957b-6d94-44cc-868e-bfc34b1efc87';  -- was Ихеаначо, Келечи
UPDATE cards SET name = 'Матиас Йенсен', forbidden_words = ARRAY['Матиас Йенсен','Матиас','Йенсен']::text[] WHERE id = '8968b6b5-719a-4172-9f31-fa17fd22a824';  -- was Йенсен, Матиас
UPDATE cards SET name = 'Лени Йоро', forbidden_words = ARRAY['Лени Йоро','Лени','Йоро']::text[] WHERE id = 'fa0cca3a-0564-4c19-a961-2ec1526ea6ac';  -- was Йоро, Лени
UPDATE cards SET name = 'Вильфредо Кабальеро', forbidden_words = ARRAY['Вильфредо Кабальеро','Вильфредо','Кабальеро']::text[] WHERE id = 'b26f82e2-1eea-4eb1-81d1-0297dc2ac9b8';  -- was Кабальеро, Вильфредо
UPDATE cards SET name = 'Исса Каборе', forbidden_words = ARRAY['Исса Каборе','Исса','Каборе']::text[] WHERE id = '1d89d10c-33d6-4700-9be3-ca0ed423b1c5';  -- was Каборе, Исса
UPDATE cards SET name = 'Ферди Кадиоглу', forbidden_words = ARRAY['Ферди Кадиоглу','Ферди','Кадиоглу']::text[] WHERE id = 'f1af142d-aa32-40af-b1a2-6e243bf7e017';  -- was Кадиоглу, Ферди
UPDATE cards SET name = 'Мойсес Кайседо', forbidden_words = ARRAY['Мойсес Кайседо','Мойсес','Кайседо']::text[] WHERE id = '59565ad3-27e4-4cdb-9be7-e0f5fa12f2d4';  -- was Кайседо, Мойсес
UPDATE cards SET name = 'Саша Калайджич', forbidden_words = ARRAY['Саша Калайджич','Саша','Калайджич']::text[] WHERE id = '06c00f3d-cc73-4069-8dd1-65bb9d1d5c5e';  -- was Калайджич, Саша
UPDATE cards SET name = 'Риккардо Калафьори', forbidden_words = ARRAY['Риккардо Калафьори','Риккардо','Калафьори']::text[] WHERE id = '35b0fc98-af08-4b7a-a0c2-e4bf5cc96c26';  -- was Калафьори, Риккардо
UPDATE cards SET name = 'Доминик Калверт-Льюин', forbidden_words = ARRAY['Доминик Калверт-Льюин','Доминик','Калверт-Льюин']::text[] WHERE id = '2b3410f3-f6bc-4d99-8f2a-20ddd0bb10ee';  -- was Калверт-Льюин, Доминик
UPDATE cards SET name = 'Даити Камада', forbidden_words = ARRAY['Даити Камада','Даити','Камада']::text[] WHERE id = '8704cb2b-9244-4033-9444-c69d1c1b36ce';  -- was Камада, Даити
UPDATE cards SET name = 'Бубакар Камара', forbidden_words = ARRAY['Бубакар Камара','Бубакар','Камара']::text[] WHERE id = '004f7f5a-1682-429e-a4db-ac96f055dbb1';  -- was Камара, Бубакар
UPDATE cards SET name = 'Томас Камински', forbidden_words = ARRAY['Томас Камински','Томас','Камински']::text[] WHERE id = '2889cea6-16fe-487a-ac95-a0b19936b65f';  -- was Камински, Томас
UPDATE cards SET name = 'Жуан Канселу', forbidden_words = ARRAY['Жуан Канселу','Жуан','Канселу']::text[] WHERE id = 'a03cc9fb-48e8-4db7-ad37-ab12fdcd8f2d';  -- was Канселу, Жуан
UPDATE cards SET name = 'Фабиу Карвалью', forbidden_words = ARRAY['Фабиу Карвалью','Фабиу','Карвалью']::text[] WHERE id = 'c9e9abf6-0371-463f-986a-49950f957342';  -- was Карвалью, Фабиу
UPDATE cards SET name = 'Лорис Кариус', forbidden_words = ARRAY['Лорис Кариус','Лорис','Кариус']::text[] WHERE id = 'd3187851-282d-4981-b204-18b95796da90';  -- was Кариус, Лорис
UPDATE cards SET name = 'Скотт Карсон', forbidden_words = ARRAY['Скотт Карсон','Скотт','Карсон']::text[] WHERE id = 'dff7dfb8-7588-4a87-ac35-da39bdc053d1';  -- was Карсон, Скотт
UPDATE cards SET name = 'Тимоти Кастань', forbidden_words = ARRAY['Тимоти Кастань','Тимоти','Кастань']::text[] WHERE id = '131be5ff-b25c-4745-a16b-9b1cb7c081e0';  -- was Кастань, Тимоти
UPDATE cards SET name = 'Йенс Каюсте', forbidden_words = ARRAY['Йенс Каюсте','Йенс','Каюсте']::text[] WHERE id = 'b0d25a54-0c66-46ab-8d9b-960677305e57';  -- was Каюсте, Йенс
UPDATE cards SET name = 'Гарри Кейн', forbidden_words = ARRAY['Гарри Кейн','Гарри','Кейн']::text[] WHERE id = 'd9dbb003-e10b-4cbe-8945-86fc2355e6fd';  -- was Кейн, Гарри
UPDATE cards SET name = 'Куивин Келлехер', forbidden_words = ARRAY['Куивин Келлехер','Куивин','Келлехер']::text[] WHERE id = 'e3c972c6-3ab8-4e38-b9e8-c13b951d11d3';  -- was Келлехер, Куивин
UPDATE cards SET name = 'Ллойд Келли', forbidden_words = ARRAY['Ллойд Келли','Ллойд','Келли']::text[] WHERE id = 'd083afe2-d31c-4c7b-a4c8-1139f065f743';  -- was Келли, Ллойд
UPDATE cards SET name = 'Тило Керер', forbidden_words = ARRAY['Тило Керер','Тило','Керер']::text[] WHERE id = '0aff058b-cd6d-4fa5-9f35-7fda88761478';  -- was Керер, Тило
UPDATE cards SET name = 'Якуб Кивёр', forbidden_words = ARRAY['Якуб Кивёр','Якуб','Кивёр']::text[] WHERE id = 'e5d6421b-0797-492f-bcf9-8adb49db9a0c';  -- was Кивёр, Якуб
UPDATE cards SET name = 'Макс Килман', forbidden_words = ARRAY['Макс Килман','Макс','Килман']::text[] WHERE id = '1c3216b5-ad91-45f3-aecb-c1c1f202ce2e';  -- was Килман, Макс
UPDATE cards SET name = 'Джошуа Кинг', forbidden_words = ARRAY['Джошуа Кинг','Джошуа','Кинг']::text[] WHERE id = 'ab275a90-65a0-418a-8a09-c9493567ebae';  -- was Кинг, Джошуа
UPDATE cards SET name = 'Натаниэл Клайн', forbidden_words = ARRAY['Натаниэл Клайн','Натаниэл','Клайн']::text[] WHERE id = '4d0ed2cd-be36-4600-93db-90f4489a8cd3';  -- was Клайн, Натаниэл
UPDATE cards SET name = 'Кацпер Козловский', forbidden_words = ARRAY['Кацпер Козловский','Кацпер','Козловский']::text[] WHERE id = 'b246802a-ab1c-40c7-8633-08e8dbebe79b';  -- was Козловский, Кацпер (футболист)
UPDATE cards SET name = 'Леви Колуилл', forbidden_words = ARRAY['Леви Колуилл','Леви','Колуилл']::text[] WHERE id = '528cbf34-c0ab-4c07-b284-576d44f86c3a';  -- was Колуилл, Леви
UPDATE cards SET name = 'Джек Корк', forbidden_words = ARRAY['Джек Корк','Джек','Корк']::text[] WHERE id = 'da90de6f-54a9-4895-9902-bc881f765eca';  -- was Корк, Джек
UPDATE cards SET name = 'Диего Коста', forbidden_words = ARRAY['Диего Коста','Диего','Коста']::text[] WHERE id = 'd6dc66e9-afa0-4039-9c4e-e36ca38f8efa';  -- was Коста, Диего
UPDATE cards SET name = 'Конор Коуди', forbidden_words = ARRAY['Конор Коуди','Конор','Коуди']::text[] WHERE id = '8b03121f-0a4a-473a-a224-6d42754016bf';  -- was Коуди, Конор
UPDATE cards SET name = 'Шеймус Коулман', forbidden_words = ARRAY['Шеймус Коулман','Шеймус','Коулман']::text[] WHERE id = '9424bb62-6a21-427b-8bdf-6ad99033cfa2';  -- was Коулман, Шеймус
UPDATE cards SET name = 'Филипе Коутиньо', forbidden_words = ARRAY['Филипе Коутиньо','Филипе','Коутиньо']::text[] WHERE id = '4cf577d1-50f7-40ea-ad2f-7e1373151a7c';  -- was Коутиньо, Филипе
UPDATE cards SET name = 'Иан Коуту', forbidden_words = ARRAY['Иан Коуту','Иан','Коуту']::text[] WHERE id = '60a22778-8707-4598-abbd-f374278eb610';  -- was Коуту, Иан
UPDATE cards SET name = 'Робин Кох', forbidden_words = ARRAY['Робин Кох','Робин','Кох']::text[] WHERE id = 'bcdb72ca-eebb-48b1-bde1-3a70c192f389';  -- was Кох, Робин
UPDATE cards SET name = 'Элдер Кошта', forbidden_words = ARRAY['Элдер Кошта','Элдер','Кошта']::text[] WHERE id = '7663de1f-01e7-43e4-8185-1f372383caab';  -- was Кошта, Элдер
UPDATE cards SET name = 'Расмус Кристенсен', forbidden_words = ARRAY['Расмус Кристенсен','Расмус','Кристенсен']::text[] WHERE id = '6138cf90-8fef-4f61-a925-ec0ccf0b5fcc';  -- was Кристенсен, Расмус
UPDATE cards SET name = 'Джарелл Куанса', forbidden_words = ARRAY['Джарелл Куанса','Джарелл','Куанса']::text[] WHERE id = 'c383bfc2-8b51-4c12-aa35-5fc8c5abe5c0';  -- was Куанса, Джарелл
UPDATE cards SET name = 'Деян Кулушевски', forbidden_words = ARRAY['Деян Кулушевски','Деян','Кулушевски']::text[] WHERE id = '958c766f-d242-43a3-bb7d-c10ed2ffb56c';  -- was Кулушевски, Деян
UPDATE cards SET name = 'Матеус Кунья', forbidden_words = ARRAY['Матеус Кунья','Матеус','Кунья']::text[] WHERE id = 'f815f907-6125-4028-a292-bf4f1b4f4d47';  -- was Кунья, Матеус
UPDATE cards SET name = 'Лиам Купер', forbidden_words = ARRAY['Лиам Купер','Лиам','Купер']::text[] WHERE id = 'c9e42ebe-f544-44b0-b7f2-a7a686f576c8';  -- was Купер, Лиам
UPDATE cards SET name = 'Патрик Кутроне', forbidden_words = ARRAY['Патрик Кутроне','Патрик','Кутроне']::text[] WHERE id = 'c51a628c-98ba-4c02-8186-074a08cf425f';  -- was Кутроне, Патрик
UPDATE cards SET name = 'Шейху Куяте', forbidden_words = ARRAY['Шейху Куяте','Шейху','Куяте']::text[] WHERE id = 'f921ccdc-0d67-4f48-9157-06781a36fd68';  -- was Куяте, Шейху
UPDATE cards SET name = 'Том Кэрни', forbidden_words = ARRAY['Том Кэрни','Том','Кэрни']::text[] WHERE id = '0569fb81-83af-4e3e-b20c-9488fb3550ba';  -- was Кэрни, Том
UPDATE cards SET name = 'Гари Кэхилл', forbidden_words = ARRAY['Гари Кэхилл','Гари','Кэхилл']::text[] WHERE id = '6120aea8-5556-4358-88fd-7a36587b7b07';  -- was Кэхилл, Гари
UPDATE cards SET name = 'Мэтти Кэш', forbidden_words = ARRAY['Мэтти Кэш','Мэтти','Кэш']::text[] WHERE id = '999ba795-6615-4129-b44f-9beee405ebed';  -- was Кэш, Мэтти
UPDATE cards SET name = 'Левен Кюрзава', forbidden_words = ARRAY['Левен Кюрзава','Левен','Кюрзава']::text[] WHERE id = '26e7f985-3b1a-472b-9019-758f92485fd4';  -- was Кюрзава, Левен
UPDATE cards SET name = 'Ромео Лавия', forbidden_words = ARRAY['Ромео Лавия','Ромео','Лавия']::text[] WHERE id = 'f8010447-f0fc-4553-97df-91c8bf420c9a';  -- was Лавия, Ромео
UPDATE cards SET name = 'Максанс Лакруа', forbidden_words = ARRAY['Максанс Лакруа','Максанс','Лакруа']::text[] WHERE id = '0d0b2e51-dad3-4f5d-bea6-e8535010a1a1';  -- was Лакруа, Максанс
UPDATE cards SET name = 'Клеман Лангле', forbidden_words = ARRAY['Клеман Лангле','Клеман','Лангле']::text[] WHERE id = 'b2e7110b-426c-4008-87cb-559011b5925e';  -- was Лангле, Клеман
UPDATE cards SET name = 'Мануэль Лансини', forbidden_words = ARRAY['Мануэль Лансини','Мануэль','Лансини']::text[] WHERE id = '2ef28f16-d01a-4d59-9df1-947621c45822';  -- was Лансини, Мануэль
UPDATE cards SET name = 'Джамал Ласселлс', forbidden_words = ARRAY['Джамал Ласселлс','Джамал','Ласселлс']::text[] WHERE id = '06a53dc8-a47b-4659-9307-b95ec02a6a30';  -- was Ласселлс, Джамал
UPDATE cards SET name = 'Марио Лемина', forbidden_words = ARRAY['Марио Лемина','Марио','Лемина']::text[] WHERE id = '43e1405a-3256-486f-9790-f7c201ea7b7f';  -- was Лемина, Марио
UPDATE cards SET name = 'Йеспер Линдстрём', forbidden_words = ARRAY['Йеспер Линдстрём','Йеспер','Линдстрём']::text[] WHERE id = '6af8e304-6714-4f07-bb57-2b6c2a32fdd3';  -- was Линдстрём, Йеспер
UPDATE cards SET name = 'Джовани Ло Чельсо', forbidden_words = ARRAY['Джовани Ло Чельсо','Джовани','Ло','Чельсо']::text[] WHERE id = 'bc766625-0709-46b2-86e7-6dfaa10f231f';  -- was Ло Чельсо, Джовани
UPDATE cards SET name = 'Ренан Лоди', forbidden_words = ARRAY['Ренан Лоди','Ренан','Лоди']::text[] WHERE id = '4a87a7a3-3134-4157-bff6-e3ae6b008c23';  -- was Лоди, Ренан
UPDATE cards SET name = 'Том Локьер', forbidden_words = ARRAY['Том Локьер','Том','Локьер']::text[] WHERE id = '5b008635-0659-409c-ad5d-03ba87f7d144';  -- was Локьер, Том
UPDATE cards SET name = 'Рубен Лофтус-Чик', forbidden_words = ARRAY['Рубен Лофтус-Чик','Рубен','Лофтус-Чик']::text[] WHERE id = '9bbbcf7f-c823-4fa1-8c16-4194cdf9a9f5';  -- was Лофтус-Чик, Рубен
UPDATE cards SET name = 'Саша Лукич', forbidden_words = ARRAY['Саша Лукич','Саша','Лукич']::text[] WHERE id = '5b7a598d-67b1-42ba-9087-b55b0387b33b';  -- was Лукич, Саша
UPDATE cards SET name = 'Адемола Лукман', forbidden_words = ARRAY['Адемола Лукман','Адемола','Лукман']::text[] WHERE id = 'bc3522e6-f148-4a87-aae1-92288b200d86';  -- was Лукман, Адемола
UPDATE cards SET name = 'Диего Льоренте', forbidden_words = ARRAY['Диего Льоренте','Диего','Льоренте']::text[] WHERE id = '67957dd2-7b30-4bd9-9c48-d8642c0d5c67';  -- was Льоренте, Диего
UPDATE cards SET name = 'Тарик Лэмпти', forbidden_words = ARRAY['Тарик Лэмпти','Тарик','Лэмпти']::text[] WHERE id = '57a1951a-4eac-489f-92e0-8dc2357861d7';  -- was Лэмпти, Тарик
UPDATE cards SET name = 'Эмерик Ляпорт', forbidden_words = ARRAY['Эмерик Ляпорт','Эмерик','Ляпорт']::text[] WHERE id = '8417d8ec-ff30-4666-9eaa-c69a014b263d';  -- was Ляпорт, Эмерик
UPDATE cards SET name = 'Стефи Мавидиди', forbidden_words = ARRAY['Стефи Мавидиди','Стефи','Мавидиди']::text[] WHERE id = 'd33ba808-73f0-421a-a671-dc2eb6e53bf2';  -- was Мавидиди, Стефи
UPDATE cards SET name = 'Габриэл Магальяйнс', forbidden_words = ARRAY['Габриэл Магальяйнс','Габриэл','Магальяйнс']::text[] WHERE id = 'b21f0890-c139-40a3-b8fc-d26a338c264c';  -- was Магальяйнс, Габриэл
UPDATE cards SET name = 'Гарри Магуайр', forbidden_words = ARRAY['Гарри Магуайр','Гарри','Магуайр']::text[] WHERE id = '0e9f3197-2b39-49b6-8e54-401d30135a6e';  -- was Магуайр, Гарри
UPDATE cards SET name = 'Алексис Макаллистер', forbidden_words = ARRAY['Алексис Макаллистер','Алексис','Макаллистер']::text[] WHERE id = '27582d41-48a3-4bb1-8019-e451ba2bd869';  -- was Макаллистер, Алексис
UPDATE cards SET name = 'Джеймс Макати', forbidden_words = ARRAY['Джеймс Макати','Джеймс','Макати']::text[] WHERE id = '622fab41-da59-468e-ba57-f61c7226dec9';  -- was Макати, Джеймс
UPDATE cards SET name = 'Уэстон Маккенни', forbidden_words = ARRAY['Уэстон Маккенни','Уэстон','Маккенни']::text[] WHERE id = '6645ff8c-8cc9-4cad-b1ac-561c927d1d5d';  -- was Маккенни, Уэстон
UPDATE cards SET name = 'Тайрелл Маласия', forbidden_words = ARRAY['Тайрелл Маласия','Тайрелл','Маласия']::text[] WHERE id = 'cf09e0dc-3209-4abe-9607-218f59a1fb14';  -- was Маласия, Тайрелл
UPDATE cards SET name = 'Дониелл Мален', forbidden_words = ARRAY['Дониелл Мален','Дониелл','Мален']::text[] WHERE id = '131de931-736f-4dd8-bc71-c7cdbfd99dc3';  -- was Мален, Дониелл
UPDATE cards SET name = 'Георгий Мамардашвили', forbidden_words = ARRAY['Георгий Мамардашвили','Георгий','Мамардашвили']::text[] WHERE id = '80edb1f8-2adf-4beb-9598-28d977951c67';  -- was Мамардашвили, Георгий
UPDATE cards SET name = 'Орель Мангаля', forbidden_words = ARRAY['Орель Мангаля','Орель','Мангаля']::text[] WHERE id = '4b46a226-5927-40be-a686-d8552bb66e68';  -- was Мангаля, Орель
UPDATE cards SET name = 'Садио Мане', forbidden_words = ARRAY['Садио Мане','Садио','Мане']::text[] WHERE id = 'e4a4e4b8-5118-4e63-b6aa-6dea9f62b065';  -- was Мане, Садио
UPDATE cards SET name = 'Хавьер Манкильо', forbidden_words = ARRAY['Хавьер Манкильо','Хавьер','Манкильо']::text[] WHERE id = '41f660ac-eec5-472c-a5bc-08ef73ca9213';  -- was Манкильо, Хавьер
UPDATE cards SET name = 'Аллан Маркес Лоурейро', forbidden_words = ARRAY['Аллан Маркес Лоурейро','Аллан','Маркес','Лоурейро']::text[] WHERE id = '1bffd942-ec4b-4911-b015-e32eee5b4033';  -- was Маркес Лоурейро, Аллан
UPDATE cards SET name = 'Габриэл Мартинелли', forbidden_words = ARRAY['Габриэл Мартинелли','Габриэл','Мартинелли']::text[] WHERE id = '6c2c216b-b57f-460a-b7bc-c4874c6b7d8e';  -- was Мартинелли, Габриэл
UPDATE cards SET name = 'Лисандро Мартинес', forbidden_words = ARRAY['Лисандро Мартинес','Лисандро','Мартинес']::text[] WHERE id = '37870b60-1a76-4bb9-90be-4b070e63c1cd';  -- was Мартинес, Лисандро
UPDATE cards SET name = 'Солли Марч', forbidden_words = ARRAY['Солли Марч','Солли','Марч']::text[] WHERE id = '1cc36e53-10d8-42c5-889b-fc5c94ce02ce';  -- was Марч, Солли
UPDATE cards SET name = 'Иан Матсен', forbidden_words = ARRAY['Иан Матсен','Иан','Матсен']::text[] WHERE id = '6a70abb0-62b8-4fd5-a0b0-0839df6e09fb';  -- was Матсен, Иан
UPDATE cards SET name = 'Мейсон Маунт', forbidden_words = ARRAY['Мейсон Маунт','Мейсон','Маунт']::text[] WHERE id = 'f68b0347-31ee-4e64-87d2-765aec6bea2f';  -- was Маунт, Мейсон
UPDATE cards SET name = 'Рияд Махрез', forbidden_words = ARRAY['Рияд Махрез','Рияд','Махрез']::text[] WHERE id = '8dcdf64a-1612-40d4-943c-5c00df61b4c2';  -- was Махрез, Рияд
UPDATE cards SET name = 'Инок Мвепу', forbidden_words = ARRAY['Инок Мвепу','Инок','Мвепу']::text[] WHERE id = '7c16e296-a9fd-4388-9178-811c2eedf5e2';  -- was Мвепу, Инок
UPDATE cards SET name = 'Ханнибал Межбри', forbidden_words = ARRAY['Ханнибал Межбри','Ханнибал','Межбри']::text[] WHERE id = 'ebe1c4cd-16fb-4b8d-b49c-b6390f96c031';  -- was Межбри, Ханнибал
UPDATE cards SET name = 'Кобби Мейну', forbidden_words = ARRAY['Кобби Мейну','Кобби','Мейну']::text[] WHERE id = '6fe18b1b-bd15-466a-9e9a-3e24a0ae278a';  -- was Мейну, Кобби
UPDATE cards SET name = 'Энзли Мейтленд-Найлз', forbidden_words = ARRAY['Энзли Мейтленд-Найлз','Энзли','Мейтленд-Найлз']::text[] WHERE id = '05d6b896-c7dd-4d21-88b2-7b18304820d3';  -- was Мейтленд-Найлз, Энзли
UPDATE cards SET name = 'Артур Мело', forbidden_words = ARRAY['Артур Мело','Артур','Мело']::text[] WHERE id = '0ea7e703-e5e7-49d0-bfa6-9074c9af328b';  -- was Мело, Артур
UPDATE cards SET name = 'Бенжамен Менди', forbidden_words = ARRAY['Бенжамен Менди','Бенжамен','Менди']::text[] WHERE id = 'f599e00c-66c1-4f9d-aaf2-20812e93e14c';  -- was Менди, Бенжамен
UPDATE cards SET name = 'Микель Мерино', forbidden_words = ARRAY['Микель Мерино','Микель','Мерино']::text[] WHERE id = '0865dc53-f1a0-433e-808f-b86edca61b6d';  -- was Мерино, Микель
UPDATE cards SET name = 'Бен Ми', forbidden_words = ARRAY['Бен Ми','Бен','Ми']::text[] WHERE id = '51edfa5c-db5e-40d6-9822-ec3b0c38f033';  -- was Ми, Бен
UPDATE cards SET name = 'Виталий Сергеевич Миколенко', forbidden_words = ARRAY['Виталий Сергеевич Миколенко','Виталий','Сергеевич','Миколенко']::text[] WHERE id = 'abb66aff-bff1-4379-8f23-df55b184305d';  -- was Миколенко, Виталий Сергеевич
UPDATE cards SET name = 'Ерри Мина', forbidden_words = ARRAY['Ерри Мина','Ерри','Мина']::text[] WHERE id = 'bef34019-4f48-4cb0-876f-2fe7f1b2aade';  -- was Мина, Ерри
UPDATE cards SET name = 'Тайрон Мингз', forbidden_words = ARRAY['Тайрон Мингз','Тайрон','Мингз']::text[] WHERE id = '9bd3cc7b-c6f0-4a8d-a070-3297ba4b7e0d';  -- was Мингз, Тайрон
UPDATE cards SET name = 'Александар Митрович', forbidden_words = ARRAY['Александар Митрович','Александар','Митрович']::text[] WHERE id = '06859d69-cfed-444f-8b61-997282698919';  -- was Митрович, Александар (футболист)
UPDATE cards SET name = 'Гонсало Монтиэль', forbidden_words = ARRAY['Гонсало Монтиэль','Гонсало','Монтиэль']::text[] WHERE id = 'b20ffbd1-3a15-4baf-afc1-a0d93e663e60';  -- was Монтиэль, Гонсало
UPDATE cards SET name = 'Нил Мопе', forbidden_words = ARRAY['Нил Мопе','Нил','Мопе']::text[] WHERE id = 'c1b465f5-3fd5-4e59-a15e-19e74caf8339';  -- was Мопе, Нил
UPDATE cards SET name = 'Родриго Морено Машадо', forbidden_words = ARRAY['Родриго Морено Машадо','Родриго','Морено','Машадо']::text[] WHERE id = '2413e089-bfef-4826-ac75-a2cb7ae7c2ca';  -- was Морено Машадо, Родриго
UPDATE cards SET name = 'Алехандре Морено', forbidden_words = ARRAY['Алехандре Морено','Алехандре','Морено']::text[] WHERE id = 'e0552d6b-33ff-4746-ae75-b86ea0dc0ba3';  -- was Морено, Алехандре
UPDATE cards SET name = 'Сэм Морси', forbidden_words = ARRAY['Сэм Морси','Сэм','Морси']::text[] WHERE id = 'd854833f-77ae-4648-89a5-f15bb108e50f';  -- was Морси, Сэм
UPDATE cards SET name = 'Жоау Моутинью', forbidden_words = ARRAY['Жоау Моутинью','Жоау','Моутинью']::text[] WHERE id = 'a3fc5ead-c5a9-446b-9412-ff809d947ba4';  -- was Моутинью, Жоау
UPDATE cards SET name = 'Михаил Петрович Мудрик', forbidden_words = ARRAY['Михаил Петрович Мудрик','Михаил','Петрович','Мудрик']::text[] WHERE id = '743430cc-7e42-4802-8775-ad03edccce35';  -- was Мудрик, Михаил Петрович
UPDATE cards SET name = 'Киффер Мур', forbidden_words = ARRAY['Киффер Мур','Киффер','Мур']::text[] WHERE id = 'abec0bd7-0ae6-4f33-a428-cd5be252db72';  -- was Мур, Киффер
UPDATE cards SET name = 'Ариянет Мурич', forbidden_words = ARRAY['Ариянет Мурич','Ариянет','Мурич']::text[] WHERE id = '3c08813f-9ca1-45ed-9359-9fc01d986d3a';  -- was Мурич, Ариянет
UPDATE cards SET name = 'Джеймс Мэддисон', forbidden_words = ARRAY['Джеймс Мэддисон','Джеймс','Мэддисон']::text[] WHERE id = '64704b39-036e-4ba8-9256-946c70b220e0';  -- was Мэддисон, Джеймс
UPDATE cards SET name = 'Итан Нванери', forbidden_words = ARRAY['Итан Нванери','Итан','Нванери']::text[] WHERE id = '72975fff-0629-4cd4-b1d0-7e7723e91955';  -- was Нванери, Итан
UPDATE cards SET name = 'Илиман Ндиай', forbidden_words = ARRAY['Илиман Ндиай','Илиман','Ндиай']::text[] WHERE id = 'f1bc898d-41cb-4af9-871a-b116d216cfeb';  -- was Ндиай, Илиман
UPDATE cards SET name = 'Уилфред Ндиди', forbidden_words = ARRAY['Уилфред Ндиди','Уилфред','Ндиди']::text[] WHERE id = '5b5866ca-44de-4f68-80e8-d0c93d284038';  -- was Ндиди, Уилфред
UPDATE cards SET name = 'Танги Ндомбеле', forbidden_words = ARRAY['Танги Ндомбеле','Танги','Ндомбеле']::text[] WHERE id = 'a6d35aad-7a1e-4fa7-916b-18275d1533d2';  -- was Ндомбеле, Танги
UPDATE cards SET name = 'Рис Нельсон', forbidden_words = ARRAY['Рис Нельсон','Рис','Нельсон']::text[] WHERE id = '3c87779b-952a-47e9-bce0-920810b9aaf8';  -- was Нельсон, Рис
UPDATE cards SET name = 'Норберто Мурара Нето', forbidden_words = ARRAY['Норберто Мурара Нето','Норберто','Мурара','Нето']::text[] WHERE id = 'b12b4a00-49af-4093-9a33-9ba044f14337';  -- was Нето, Норберто Мурара
UPDATE cards SET name = 'Кристофер Нкунку', forbidden_words = ARRAY['Кристофер Нкунку','Кристофер','Нкунку']::text[] WHERE id = 'eb2e646c-569f-4908-9c89-2a7c0444af9e';  -- was Нкунку, Кристофер
UPDATE cards SET name = 'Нильс Нкунку', forbidden_words = ARRAY['Нильс Нкунку','Нильс','Нкунку']::text[] WHERE id = '4fdd6f61-98f5-43c3-8535-3db9c5589114';  -- was Нкунку, Нильс
UPDATE cards SET name = 'Марк Нобл', forbidden_words = ARRAY['Марк Нобл','Марк','Нобл']::text[] WHERE id = 'e7e7439f-1522-4dc8-a572-1adb0d12659d';  -- was Нобл, Марк
UPDATE cards SET name = 'Вилли Ньонто', forbidden_words = ARRAY['Вилли Ньонто','Вилли','Ньонто']::text[] WHERE id = '78c10bbe-281e-4fd0-94b6-8364d1b6ac8d';  -- was Ньонто, Вилли
UPDATE cards SET name = 'Дара О’Ши', forbidden_words = ARRAY['Дара О’Ши','Дара','О’Ши']::text[] WHERE id = '86f6ff53-9668-4df9-bdcd-d89fdac0084e';  -- was О’Ши, Дара
UPDATE cards SET name = 'Чидози Огбене', forbidden_words = ARRAY['Чидози Огбене','Чидози','Огбене']::text[] WHERE id = '4e2b3210-155c-4408-ae52-d7923b69a1b1';  -- was Огбене, Чидози
UPDATE cards SET name = 'Анджело Огбонна', forbidden_words = ARRAY['Анджело Огбонна','Анджело','Огбонна']::text[] WHERE id = '6f038286-7069-486b-8ba5-710d288e1fcb';  -- was Огбонна, Анджело
UPDATE cards SET name = 'Алекс Окслейд-Чемберлен', forbidden_words = ARRAY['Алекс Окслейд-Чемберлен','Алекс','Окслейд-Чемберлен']::text[] WHERE id = 'aa7c0ce6-02a3-46c4-8e2b-6a0f4aeb4da2';  -- was Окслейд-Чемберлен, Алекс
UPDATE cards SET name = 'Марк Олбрайтон', forbidden_words = ARRAY['Марк Олбрайтон','Марк','Олбрайтон']::text[] WHERE id = 'ea484117-cfc3-4b98-93fa-01f3c58df4a7';  -- was Олбрайтон, Марк
UPDATE cards SET name = 'Амаду Онана', forbidden_words = ARRAY['Амаду Онана','Амаду','Онана']::text[] WHERE id = '7c34e0ba-cdd1-4159-92bf-841f05656b31';  -- was Онана, Амаду
UPDATE cards SET name = 'Пол Онуачу', forbidden_words = ARRAY['Пол Онуачу','Пол','Онуачу']::text[] WHERE id = 'b7cfc2ed-c786-4519-a887-141d2502c249';  -- was Онуачу, Пол
UPDATE cards SET name = 'Штефан Ортега', forbidden_words = ARRAY['Штефан Ортега','Штефан','Ортега']::text[] WHERE id = 'eccff7e0-1cac-48c5-b7b4-7f6a80555e50';  -- was Ортега, Штефан
UPDATE cards SET name = 'Мислав Оршич', forbidden_words = ARRAY['Мислав Оршич','Мислав','Оршич']::text[] WHERE id = '6701c634-26b1-4785-a560-3e8ad2813903';  -- was Оршич, Мислав
UPDATE cards SET name = 'Серж Орье', forbidden_words = ARRAY['Серж Орье','Серж','Орье']::text[] WHERE id = 'd4d3c6d1-fb5c-42f5-bc4e-22d7285b0877';  -- was Орье, Серж
UPDATE cards SET name = 'Жуан Пальинья', forbidden_words = ARRAY['Жуан Пальинья','Жуан','Пальинья']::text[] WHERE id = '6bff4056-7110-40cc-badf-5b68901e477a';  -- was Пальинья, Жуан
UPDATE cards SET name = 'Факундо Пельистри', forbidden_words = ARRAY['Факундо Пельистри','Факундо','Пельистри']::text[] WHERE id = 'a80f23be-5d2d-470f-8cf2-28fe83d14eb0';  -- was Пельистри, Факундо
UPDATE cards SET name = 'Николя Пепе', forbidden_words = ARRAY['Николя Пепе','Николя','Пепе']::text[] WHERE id = '6b988638-bef6-4ee9-afb5-17ca3c64db5a';  -- was Пепе, Николя
UPDATE cards SET name = 'Андреас Перейра', forbidden_words = ARRAY['Андреас Перейра','Андреас','Перейра']::text[] WHERE id = '572b681f-2b9c-4391-8281-fc349988af3f';  -- was Перейра, Андреас
UPDATE cards SET name = 'Айосе Перес', forbidden_words = ARRAY['Айосе Перес','Айосе','Перес']::text[] WHERE id = '2b7b7def-9ac7-4cb1-8820-b8f5d9685dca';  -- was Перес, Айосе
UPDATE cards SET name = 'Максимо Перроне', forbidden_words = ARRAY['Максимо Перроне','Максимо','Перроне']::text[] WHERE id = 'd3ea25fe-e47d-46bc-acd7-01ec9787239d';  -- was Перроне, Максимо
UPDATE cards SET name = 'Даниэл Поденсе', forbidden_words = ARRAY['Даниэл Поденсе','Даниэл','Поденсе']::text[] WHERE id = 'e680e551-a4b3-4073-afb6-f1a4c08cf951';  -- was Поденсе, Даниэл
UPDATE cards SET name = 'Ник Поуп', forbidden_words = ARRAY['Ник Поуп','Ник','Поуп']::text[] WHERE id = '277aa7a7-4c9a-45b9-a4a1-f6711bf3084e';  -- was Поуп, Ник
UPDATE cards SET name = 'Йонуц Раду', forbidden_words = ARRAY['Йонуц Раду','Йонуц','Раду']::text[] WHERE id = 'ca1ecc31-4b14-43b3-8275-0d2ffffadd61';  -- was Раду, Йонуц
UPDATE cards SET name = 'Давид Райя', forbidden_words = ARRAY['Давид Райя','Давид','Райя']::text[] WHERE id = '9cfb642a-187c-491e-8c78-424c51d7163e';  -- was Райя, Давид
UPDATE cards SET name = 'Эрон Рамздейл', forbidden_words = ARRAY['Эрон Рамздейл','Эрон','Рамздейл']::text[] WHERE id = '88491f70-eb11-4d72-b32d-3fc1ad29376a';  -- was Рамздейл, Эрон
UPDATE cards SET name = 'Маркус Рашфорд', forbidden_words = ARRAY['Маркус Рашфорд','Маркус','Рашфорд']::text[] WHERE id = 'eb536f7f-e740-4ed3-b55b-be361fca830d';  -- was Рашфорд, Маркус
UPDATE cards SET name = 'Серхио Регилон', forbidden_words = ARRAY['Серхио Регилон','Серхио','Регилон']::text[] WHERE id = 'cc725800-4870-4284-94cf-3328ffbdf14b';  -- was Регилон, Серхио
UPDATE cards SET name = 'Джованни Рейна', forbidden_words = ARRAY['Джованни Рейна','Джованни','Рейна']::text[] WHERE id = 'ee10972f-b7a8-4263-bb40-159cd9352bdd';  -- was Рейна, Джованни
UPDATE cards SET name = 'Тим Рим', forbidden_words = ARRAY['Тим Рим','Тим','Рим']::text[] WHERE id = '69c7cd12-62e0-4346-b877-e1df38aa6e29';  -- was Рим, Тим
UPDATE cards SET name = 'Ришарлисон', forbidden_words = ARRAY['Ришарлисон']::text[] WHERE id = '0e078cbf-a617-4b81-89ba-c5703c74277a';  -- was Ришарлисон (футболист, 1997)
UPDATE cards SET name = 'Джек Робинсон', forbidden_words = ARRAY['Джек Робинсон','Джек','Робинсон']::text[] WHERE id = 'dfdbbd3b-e882-44a6-a87c-0ad472948667';  -- was Робинсон, Джек (футболист, 1870)
UPDATE cards SET name = 'Гидо Родригес', forbidden_words = ARRAY['Гидо Родригес','Гидо','Родригес']::text[] WHERE id = 'da048b1e-98cc-4ed2-9a44-991e37aab7dd';  -- was Родригес, Гидо
UPDATE cards SET name = 'Марк Рока', forbidden_words = ARRAY['Марк Рока','Марк','Рока']::text[] WHERE id = '10a81b28-285e-4afb-99bd-8fe82b0e11df';  -- was Рока, Марк
UPDATE cards SET name = 'Кристиан Ромеро', forbidden_words = ARRAY['Кристиан Ромеро','Кристиан','Ромеро']::text[] WHERE id = 'df05ece9-24ad-4323-b8a1-c50f44442ead';  -- was Ромеро, Кристиан
UPDATE cards SET name = 'Ориоль Ромеу', forbidden_words = ARRAY['Ориоль Ромеу','Ориоль','Ромеу']::text[] WHERE id = 'd35a11d0-0b10-4e06-87b7-37dac0f68d9a';  -- was Ромеу, Ориоль
UPDATE cards SET name = 'Хосе Саломон Рондон', forbidden_words = ARRAY['Хосе Саломон Рондон','Хосе','Саломон','Рондон']::text[] WHERE id = 'cca4595a-cb4c-4a60-bc3e-bcaca6a9cd79';  -- was Рондон, Хосе Саломон
UPDATE cards SET name = 'Пелли Руддок Мпанзу', forbidden_words = ARRAY['Пелли Руддок Мпанзу','Пелли','Руддок','Мпанзу']::text[] WHERE id = '1e57f528-2989-48e8-a2cf-4e895617fee8';  -- was Руддок Мпанзу, Пелли
UPDATE cards SET name = 'Аарон Рэмзи', forbidden_words = ARRAY['Аарон Рэмзи','Аарон','Рэмзи']::text[] WHERE id = 'aa658fb4-ea5d-4cca-9c09-942083e33584';  -- was Рэмзи, Аарон
UPDATE cards SET name = 'Джейкоб Рэмзи', forbidden_words = ARRAY['Джейкоб Рэмзи','Джейкоб','Рэмзи']::text[] WHERE id = '566125a4-3669-4dc8-8b36-0358efd950e7';  -- was Рэмзи, Джейкоб
UPDATE cards SET name = 'Жозе Са', forbidden_words = ARRAY['Жозе Са','Жозе','Са']::text[] WHERE id = 'b04f34b9-4390-4235-b865-bb628a161c80';  -- was Са, Жозе
UPDATE cards SET name = 'Ромен Саисс', forbidden_words = ARRAY['Ромен Саисс','Ромен','Саисс']::text[] WHERE id = '04112c9a-94d9-4a8c-a062-421baef329bd';  -- was Саисс, Ромен
UPDATE cards SET name = 'Букайо Сака', forbidden_words = ARRAY['Букайо Сака','Букайо','Сака']::text[] WHERE id = '0920fbdb-4a92-4a3a-9703-b70ce89c1e37';  -- was Сака, Букайо
UPDATE cards SET name = 'Мохаммед Салису', forbidden_words = ARRAY['Мохаммед Салису','Мохаммед','Салису']::text[] WHERE id = '35f69818-ea16-45cd-941e-1a9941029e4d';  -- was Салису, Мохаммед
UPDATE cards SET name = 'Альбер Самби Локонга', forbidden_words = ARRAY['Альбер Самби Локонга','Альбер','Самби','Локонга']::text[] WHERE id = '5343c030-8227-47e7-ba8f-b57d632bb5a5';  -- was Самби Локонга, Альбер
UPDATE cards SET name = 'Ибраим Сангаре', forbidden_words = ARRAY['Ибраим Сангаре','Ибраим','Сангаре']::text[] WHERE id = '7afd3fe9-39f4-48e2-bc42-52c60ff41927';  -- was Сангаре, Ибраим
UPDATE cards SET name = 'Эдерсон Сантана ди Мораес', forbidden_words = ARRAY['Эдерсон Сантана ди Мораес','Эдерсон','Сантана','ди','Мораес']::text[] WHERE id = 'eff00c92-e81b-4dc2-85c1-20af0ef5abb7';  -- was Сантана ди Мораес, Эдерсон
UPDATE cards SET name = 'Андрей Сантос', forbidden_words = ARRAY['Андрей Сантос','Андрей','Сантос']::text[] WHERE id = 'd8f80737-4bca-4de1-b500-5e8384aeed32';  -- was Сантос, Андрей
UPDATE cards SET name = 'Роберт Санчес', forbidden_words = ARRAY['Роберт Санчес','Роберт','Санчес']::text[] WHERE id = 'b61349bd-68d6-4ad2-a9c1-712e6551d35a';  -- was Санчес, Роберт
UPDATE cards SET name = 'Джейдон Санчо', forbidden_words = ARRAY['Джейдон Санчо','Джейдон','Санчо']::text[] WHERE id = '177e360d-0b10-4a54-8056-aa82d661231a';  -- was Санчо, Джейдон
UPDATE cards SET name = 'Пабло Сарабия', forbidden_words = ARRAY['Пабло Сарабия','Пабло','Сарабия']::text[] WHERE id = '64706e99-eb37-45d1-8674-3ce243aaab74';  -- was Сарабия, Пабло
UPDATE cards SET name = 'Маланг Сарр', forbidden_words = ARRAY['Маланг Сарр','Маланг','Сарр']::text[] WHERE id = '364ca3b0-1bf7-41b0-a587-702f359e18ba';  -- was Сарр, Маланг
UPDATE cards SET name = 'Нелсон Семеду', forbidden_words = ARRAY['Нелсон Семеду','Нелсон','Семеду']::text[] WHERE id = '5bd8b39c-3c33-4b21-92e8-7f5ad8c75d42';  -- was Семеду, Нелсон
UPDATE cards SET name = 'Аллан Сен-Максимен', forbidden_words = ARRAY['Аллан Сен-Максимен','Аллан','Сен-Максимен']::text[] WHERE id = '09a25157-4280-471a-88ed-80df709eea37';  -- was Сен-Максимен, Аллан
UPDATE cards SET name = 'Райан Сессеньон', forbidden_words = ARRAY['Райан Сессеньон','Райан','Сессеньон']::text[] WHERE id = 'e48b7653-bf3f-4e37-b951-ca812a3ae60f';  -- was Сессеньон, Райан
UPDATE cards SET name = 'Чалар Сёюнджю', forbidden_words = ARRAY['Чалар Сёюнджю','Чалар','Сёюнджю']::text[] WHERE id = '1bfcebac-e128-4355-87f7-68af797aacdc';  -- was Сёюнджю, Чалар
UPDATE cards SET name = 'Тиагу Силва', forbidden_words = ARRAY['Тиагу Силва','Тиагу','Силва']::text[] WHERE id = '26120fdd-645d-41e8-8a1d-3a75f14b0b4d';  -- was Силва, Тиагу (бразильский футболист)
UPDATE cards SET name = 'Джанлука Скамакка', forbidden_words = ARRAY['Джанлука Скамакка','Джанлука','Скамакка']::text[] WHERE id = 'afdf77e5-c261-4fba-b6cc-f6cf46e1abdc';  -- was Скамакка, Джанлука
UPDATE cards SET name = 'Оливер Скипп', forbidden_words = ARRAY['Оливер Скипп','Оливер','Скипп']::text[] WHERE id = '361317a0-5438-45ed-8a50-22320f87c147';  -- was Скипп, Оливер
UPDATE cards SET name = 'Гейбриел Слонина', forbidden_words = ARRAY['Гейбриел Слонина','Гейбриел','Слонина']::text[] WHERE id = '25438776-9043-4e07-a772-18d18b7dedc6';  -- was Слонина, Гейбриел
UPDATE cards SET name = 'Имил Смит-Роу', forbidden_words = ARRAY['Имил Смит-Роу','Имил','Смит-Роу']::text[] WHERE id = '685f5710-adf5-4fdc-b49a-8ab530fba7ed';  -- was Смит-Роу, Имил
UPDATE cards SET name = 'Сэмми Смодикс', forbidden_words = ARRAY['Сэмми Смодикс','Сэмми','Смодикс']::text[] WHERE id = 'cafc2cb3-ec71-464b-b602-1bf5b880d92e';  -- was Смодикс, Сэмми
UPDATE cards SET name = 'Доминик Соланке', forbidden_words = ARRAY['Доминик Соланке','Доминик','Соланке']::text[] WHERE id = 'e8ca067e-96b6-4720-bf5d-480f0ddba4ac';  -- was Соланке, Доминик
UPDATE cards SET name = 'Карлос Солер', forbidden_words = ARRAY['Карлос Солер','Карлос','Солер']::text[] WHERE id = '78ff1b75-6204-414d-9ae6-e3729644c663';  -- was Солер, Карлос
UPDATE cards SET name = 'Манор Соломон', forbidden_words = ARRAY['Манор Соломон','Манор','Соломон']::text[] WHERE id = '908e09c4-7067-4a6e-afbd-37ce86827ff7';  -- was Соломон, Манор
UPDATE cards SET name = 'Борна Соса', forbidden_words = ARRAY['Борна Соса','Борна','Соса']::text[] WHERE id = '61faf2ca-d616-4166-8b3f-ecc035561a68';  -- was Соса, Борна
UPDATE cards SET name = 'Зак Стеффен', forbidden_words = ARRAY['Зак Стеффен','Зак','Стеффен']::text[] WHERE id = '684a257e-2728-4f61-94ec-2249409f8d55';  -- was Стеффен, Зак
UPDATE cards SET name = 'Джон Стоунз', forbidden_words = ARRAY['Джон Стоунз','Джон','Стоунз']::text[] WHERE id = '6bd5ee33-282a-4ecd-9d05-8970f991bab5';  -- was Стоунз, Джон
UPDATE cards SET name = 'Седрик Суареш', forbidden_words = ARRAY['Седрик Суареш','Седрик','Суареш']::text[] WHERE id = '4ad7a1be-dc8c-40e1-84ed-62faa9dd1d2a';  -- was Суареш, Седрик
UPDATE cards SET name = 'Нуну Тавариш', forbidden_words = ARRAY['Нуну Тавариш','Нуну','Тавариш']::text[] WHERE id = '8cd09f38-4157-4605-8ee8-17ae578cdf7a';  -- was Тавариш, Нуну
UPDATE cards SET name = 'Джеймс Тарковски', forbidden_words = ARRAY['Джеймс Тарковски','Джеймс','Тарковски']::text[] WHERE id = '4a820e08-5601-4c47-8daa-1a51da1903eb';  -- was Тарковски, Джеймс
UPDATE cards SET name = 'Андрос Таунсенд', forbidden_words = ARRAY['Андрос Таунсенд','Андрос','Таунсенд']::text[] WHERE id = 'eb3dc951-cb08-46c0-9ff9-8a221bb52f99';  -- was Таунсенд, Андрос
UPDATE cards SET name = 'Нейтан Телла', forbidden_words = ARRAY['Нейтан Телла','Нейтан','Телла']::text[] WHERE id = 'ae86cfbf-d1b4-46a5-adb5-6d6e433fa7c1';  -- was Телла, Нейтан
UPDATE cards SET name = 'Алекс Теллес', forbidden_words = ARRAY['Алекс Теллес','Алекс','Теллес']::text[] WHERE id = '67c53b4a-1e6b-400d-b917-85f9f9e5a7a5';  -- was Теллес, Алекс
UPDATE cards SET name = 'Матис Тель', forbidden_words = ARRAY['Матис Тель','Матис','Тель']::text[] WHERE id = 'ecd282e8-1d8c-462d-8a01-9980da4c1ecc';  -- was Тель, Матис
UPDATE cards SET name = 'Мэтт Тернер', forbidden_words = ARRAY['Мэтт Тернер','Мэтт','Тернер']::text[] WHERE id = 'cc144c49-7441-45a4-afe7-007f8f7d2c14';  -- was Тернер, Мэтт
UPDATE cards SET name = 'Тете', forbidden_words = ARRAY['Тете']::text[] WHERE id = 'c6ee8f04-0391-4399-8a9a-a6c5c26fcef0';  -- was Тете (футболист, 2000)
UPDATE cards SET name = 'Кенни Тете', forbidden_words = ARRAY['Кенни Тете','Кенни','Тете']::text[] WHERE id = '89a78814-f34b-49cb-9eb8-8cfc3f0d0cf7';  -- was Тете, Кенни
UPDATE cards SET name = 'Юрриен Тимбер', forbidden_words = ARRAY['Юрриен Тимбер','Юрриен','Тимбер']::text[] WHERE id = 'c22a5a13-aa2d-4a89-ad25-6a19101cb27a';  -- was Тимбер, Юрриен
UPDATE cards SET name = 'Жан-Клер Тодибо', forbidden_words = ARRAY['Жан-Клер Тодибо','Жан-Клер','Тодибо']::text[] WHERE id = 'cd581748-236e-4cf8-a09d-3039db3b480f';  -- was Тодибо, Жан-Клер
UPDATE cards SET name = 'Такэхиро Томиясу', forbidden_words = ARRAY['Такэхиро Томиясу','Такэхиро','Томиясу']::text[] WHERE id = '09c02a1c-7bda-4702-a30f-be35724537a9';  -- was Томиясу, Такэхиро
UPDATE cards SET name = 'Дженк Тосун', forbidden_words = ARRAY['Дженк Тосун','Дженк','Тосун']::text[] WHERE id = '33c092af-7f8f-4d73-af50-ec2cd1d9f3a6';  -- was Тосун, Дженк
UPDATE cards SET name = 'Айван Тоуни', forbidden_words = ARRAY['Айван Тоуни','Айван','Тоуни']::text[] WHERE id = '8b07d7b6-462e-4ced-abd3-031be0c21851';  -- was Тоуни, Айван
UPDATE cards SET name = 'Адама Траоре', forbidden_words = ARRAY['Адама Траоре','Адама','Траоре']::text[] WHERE id = 'bfc56a61-6c6a-4946-a6c8-97cc11c5f930';  -- was Траоре, Адама (испанский футболист)
UPDATE cards SET name = 'Бертран Траоре', forbidden_words = ARRAY['Бертран Траоре','Бертран','Траоре']::text[] WHERE id = '8e064b15-2164-44b5-836e-eae9c128de1c';  -- was Траоре, Бертран
UPDATE cards SET name = 'Хамед Траоре', forbidden_words = ARRAY['Хамед Траоре','Хамед','Траоре']::text[] WHERE id = '61ad1b64-7bd6-4597-a322-ac90d610140f';  -- was Траоре, Хамед
UPDATE cards SET name = 'Джеймс Траффорд', forbidden_words = ARRAY['Джеймс Траффорд','Джеймс','Траффорд']::text[] WHERE id = '1b55359e-62a4-45ed-9fe9-3854cd6e07ed';  -- was Траффорд, Джеймс
UPDATE cards SET name = 'Франсишку Тринкан', forbidden_words = ARRAY['Франсишку Тринкан','Франсишку','Тринкан']::text[] WHERE id = '883455fe-146b-4847-9c4c-36e4aea68c68';  -- was Тринкан, Франсишку
UPDATE cards SET name = 'Киран Триппьер', forbidden_words = ARRAY['Киран Триппьер','Киран','Триппьер']::text[] WHERE id = '2f6a1881-24a9-4a3f-b66e-471e68d408e7';  -- was Триппьер, Киран
UPDATE cards SET name = 'Леандро Троссард', forbidden_words = ARRAY['Леандро Троссард','Леандро','Троссард']::text[] WHERE id = '9eef0c3f-d5ad-456f-bfea-f91d1084cf6a';  -- was Троссард, Леандро
UPDATE cards SET name = 'Аксель Туанзебе', forbidden_words = ARRAY['Аксель Туанзебе','Аксель','Туанзебе']::text[] WHERE id = '1429226d-5db6-4d46-9a39-0372f4806268';  -- was Туанзебе, Аксель
UPDATE cards SET name = 'Бен Уайт', forbidden_words = ARRAY['Бен Уайт','Бен','Уайт']::text[] WHERE id = 'ce7897a7-b06d-4e6b-987d-c3f48a7a9538';  -- was Уайт, Бен
UPDATE cards SET name = 'Эрон Уан-Биссака', forbidden_words = ARRAY['Эрон Уан-Биссака','Эрон','Уан-Биссака']::text[] WHERE id = '39b89fcf-1f7f-45a9-8815-77652abd8d98';  -- was Уан-Биссака, Эрон
UPDATE cards SET name = 'Лесли Угочукву', forbidden_words = ARRAY['Лесли Угочукву','Лесли','Угочукву']::text[] WHERE id = '5e4f8188-962e-4c14-b1ac-391e51a54d4f';  -- was Угочукву, Лесли
UPDATE cards SET name = 'Дестини Удоджи', forbidden_words = ARRAY['Дестини Удоджи','Дестини','Удоджи']::text[] WHERE id = 'b6e51867-2122-4cfc-8f1b-2076f9324b5f';  -- was Удоджи, Дестини
UPDATE cards SET name = 'Каллум Уилсон', forbidden_words = ARRAY['Каллум Уилсон','Каллум','Уилсон']::text[] WHERE id = '6e03bb2b-fcf3-4b97-a0a2-6d25e277c38b';  -- was Уилсон, Каллум
UPDATE cards SET name = 'Харри Уилсон', forbidden_words = ARRAY['Харри Уилсон','Харри','Уилсон']::text[] WHERE id = '98690d7d-65f0-483a-9f8c-da7e561977a9';  -- was Уилсон, Харри
UPDATE cards SET name = 'Брандон Уильямс', forbidden_words = ARRAY['Брандон Уильямс','Брандон','Уильямс']::text[] WHERE id = '731acb47-ff15-4a7f-9dd5-3fae35ba5a78';  -- was Уильямс, Брандон
UPDATE cards SET name = 'Гарри Уинкс', forbidden_words = ARRAY['Гарри Уинкс','Гарри','Уинкс']::text[] WHERE id = '6c4c04f7-249a-4f4c-92ce-77b0dcc61d50';  -- was Уинкс, Гарри
UPDATE cards SET name = 'Робин Ульсен', forbidden_words = ARRAY['Робин Ульсен','Робин','Ульсен']::text[] WHERE id = 'd418daaf-d67d-4f0a-bb66-ef85eb3fd881';  -- was Ульсен, Робин
UPDATE cards SET name = 'Энес Унал', forbidden_words = ARRAY['Энес Унал','Энес','Унал']::text[] WHERE id = '9e205764-46d2-427c-a50a-b39e548877a3';  -- was Унал, Энес
UPDATE cards SET name = 'Дениз Ундав', forbidden_words = ARRAY['Дениз Ундав','Дениз','Ундав']::text[] WHERE id = 'c450427b-ec1e-4a3b-9854-9e9f95ca7259';  -- was Ундав, Дениз
UPDATE cards SET name = 'Джеймс Уорд-Проуз', forbidden_words = ARRAY['Джеймс Уорд-Проуз','Джеймс','Уорд-Проуз']::text[] WHERE id = '669f2a12-52a0-4687-a0be-54a11e508bd4';  -- was Уорд-Проуз, Джеймс
UPDATE cards SET name = 'Дэнни Уорд', forbidden_words = ARRAY['Дэнни Уорд','Дэнни','Уорд']::text[] WHERE id = '9afd8034-976a-4464-8d30-0411dc2022ca';  -- was Уорд, Дэнни
UPDATE cards SET name = 'Джо Уорралл', forbidden_words = ARRAY['Джо Уорралл','Джо','Уорралл']::text[] WHERE id = '44efbc72-8a86-439b-827a-c3c5a0629a2f';  -- was Уорралл, Джо
UPDATE cards SET name = 'Адам Уортон', forbidden_words = ARRAY['Адам Уортон','Адам','Уортон']::text[] WHERE id = 'db9f3c9e-8be7-493c-a3ce-57b1ef9fb4a0';  -- was Уортон, Адам
UPDATE cards SET name = 'Дэнни Уэлбек', forbidden_words = ARRAY['Дэнни Уэлбек','Дэнни','Уэлбек']::text[] WHERE id = 'c3a3477d-d2e8-4167-9c33-e1302864cc04';  -- was Уэлбек, Дэнни
UPDATE cards SET name = 'Лукаш Фабьяньский', forbidden_words = ARRAY['Лукаш Фабьяньский','Лукаш','Фабьяньский']::text[] WHERE id = '0f318d87-dfc1-49d3-81fb-656379605302';  -- was Фабьяньский, Лукаш
UPDATE cards SET name = 'Ваут Фас', forbidden_words = ARRAY['Ваут Фас','Ваут','Фас']::text[] WHERE id = 'b324998a-b2aa-44f0-9000-21a5d08b167c';  -- was Фас, Ваут
UPDATE cards SET name = 'Абдул Фатаву', forbidden_words = ARRAY['Абдул Фатаву','Абдул','Фатаву']::text[] WHERE id = '69e0d428-4ea6-4dac-b634-787945641217';  -- was Фатаву, Абдул
UPDATE cards SET name = 'Ансу Фати', forbidden_words = ARRAY['Ансу Фати','Ансу','Фати']::text[] WHERE id = 'da15a686-6206-43e3-8e0b-06c1e9b6b0fc';  -- was Фати, Ансу
UPDATE cards SET name = 'Эван Фергюсон', forbidden_words = ARRAY['Эван Фергюсон','Эван','Фергюсон']::text[] WHERE id = '62a58424-62ac-412d-8b70-58b803201f47';  -- was Фергюсон, Эван
UPDATE cards SET name = 'Бруну Фернандеш', forbidden_words = ARRAY['Бруну Фернандеш','Бруну','Фернандеш']::text[] WHERE id = '445378a8-8beb-4e84-8c05-ba0de7559d29';  -- was Фернандеш, Бруну
UPDATE cards SET name = 'Калвин Филлипс', forbidden_words = ARRAY['Калвин Филлипс','Калвин','Филлипс']::text[] WHERE id = 'e6524cf5-a49e-4135-ad1f-3a94bf4ea1b5';  -- was Филлипс, Калвин
UPDATE cards SET name = 'Натаниэль Филлипс', forbidden_words = ARRAY['Натаниэль Филлипс','Натаниэль','Филлипс']::text[] WHERE id = '8866c1df-9fac-45f4-bbf4-ffb04da231d1';  -- was Филлипс, Натаниэль
UPDATE cards SET name = 'Хуниор Фирпо', forbidden_words = ARRAY['Хуниор Фирпо','Хуниор','Фирпо']::text[] WHERE id = 'f2321e66-4d46-4189-9832-ba8490c9c704';  -- was Фирпо, Хуниор
UPDATE cards SET name = 'Фил Фоден', forbidden_words = ARRAY['Фил Фоден','Фил','Фоден']::text[] WHERE id = '7b0e4963-27cc-44d0-9556-49622f5e9458';  -- was Фоден, Фил
UPDATE cards SET name = 'Пабло Форнальс', forbidden_words = ARRAY['Пабло Форнальс','Пабло','Форнальс']::text[] WHERE id = '6b8933ca-e5e5-4162-9dbb-e7c51fdd9927';  -- was Форнальс, Пабло
UPDATE cards SET name = 'Фрейзер Форстер', forbidden_words = ARRAY['Фрейзер Форстер','Фрейзер','Форстер']::text[] WHERE id = 'ec1dd60b-445a-4bcf-9064-9d084aab62d4';  -- was Форстер, Фрейзер
UPDATE cards SET name = 'Весле Фофана', forbidden_words = ARRAY['Весле Фофана','Весле','Фофана']::text[] WHERE id = '968fa6d0-2fd4-43a6-93c0-813ea29da3db';  -- was Фофана, Весле
UPDATE cards SET name = 'Давид Датро Фофана', forbidden_words = ARRAY['Давид Датро Фофана','Давид','Датро','Фофана']::text[] WHERE id = '9a638f1d-28e8-4e86-9e46-6db2aed52da4';  -- was Фофана, Давид Датро
UPDATE cards SET name = 'Джереми Фримпонг', forbidden_words = ARRAY['Джереми Фримпонг','Джереми','Фримпонг']::text[] WHERE id = 'e0dc9a69-bc13-4694-86e7-d4c3257619a9';  -- was Фримпонг, Джереми
UPDATE cards SET name = 'Никлас Фюллькруг', forbidden_words = ARRAY['Никлас Фюллькруг','Никлас','Фюллькруг']::text[] WHERE id = '39120c56-9810-467b-85a8-e8d31063a3e7';  -- was Фюллькруг, Никлас
UPDATE cards SET name = 'Каллум Хадсон-Одои', forbidden_words = ARRAY['Каллум Хадсон-Одои','Каллум','Хадсон-Одои']::text[] WHERE id = '2f614420-611f-4bdc-89aa-c186052dcdf5';  -- was Хадсон-Одои, Каллум
UPDATE cards SET name = 'Джек Харрисон', forbidden_words = ARRAY['Джек Харрисон','Джек','Харрисон']::text[] WHERE id = 'e5c86ee6-4787-4869-91ba-456f041b8b6a';  -- was Харрисон, Джек
UPDATE cards SET name = 'Пьер-Эмиль Хёйбьерг', forbidden_words = ARRAY['Пьер-Эмиль Хёйбьерг','Пьер-Эмиль','Хёйбьерг']::text[] WHERE id = '1ec121c1-c46b-41d0-94f7-818d85d2de29';  -- was Хёйбьерг, Пьер-Эмиль
UPDATE cards SET name = 'Расмус Хёйлунн', forbidden_words = ARRAY['Расмус Хёйлунн','Расмус','Хёйлунн']::text[] WHERE id = 'fa887094-dfa5-4c23-acfa-394ae68dc944';  -- was Хёйлунн, Расмус
UPDATE cards SET name = 'Карл Якоб Хейн', forbidden_words = ARRAY['Карл Якоб Хейн','Карл','Якоб','Хейн']::text[] WHERE id = '8a9608e2-a682-458f-acb0-198461a255a6';  -- was Хейн, Карл Якоб
UPDATE cards SET name = 'Уэйн Хеннесси', forbidden_words = ARRAY['Уэйн Хеннесси','Уэйн','Хеннесси']::text[] WHERE id = '50d4d582-b888-4c7a-a10c-de9c4ca68b8f';  -- was Хеннесси, Уэйн
UPDATE cards SET name = 'Том Хитон', forbidden_words = ARRAY['Том Хитон','Том','Хитон']::text[] WHERE id = '2550d2db-4339-4075-87b5-3a11634644f4';  -- was Хитон, Том
UPDATE cards SET name = 'Эрлинг Холанн', forbidden_words = ARRAY['Эрлинг Холанн','Эрлинг','Холанн']::text[] WHERE id = '844d5a9c-4e20-4537-8dc0-ec601943ec77';  -- was Холанн, Эрлинг
UPDATE cards SET name = 'Итан Хорват', forbidden_words = ARRAY['Итан Хорват','Итан','Хорват']::text[] WHERE id = 'd0fc1cab-5f47-4ef0-a435-0646242d1e8a';  -- was Хорват, Итан
UPDATE cards SET name = 'Константинос Цимикас', forbidden_words = ARRAY['Константинос Цимикас','Константинос','Цимикас']::text[] WHERE id = 'bcf2c0ff-0c1e-4a2a-9eaa-1c4c54108c3f';  -- was Цимикас, Константинос
UPDATE cards SET name = 'Владимир Цоуфал', forbidden_words = ARRAY['Владимир Цоуфал','Владимир','Цоуфал']::text[] WHERE id = '9b1d51b0-b266-43b3-9a6a-7beb0091732d';  -- was Цоуфал, Владимир
UPDATE cards SET name = 'Дуе Чалета-Цар', forbidden_words = ARRAY['Дуе Чалета-Цар','Дуе','Чалета-Цар']::text[] WHERE id = 'c71a6438-d255-4aa0-854d-92224d798ca2';  -- was Чалета-Цар, Дуе
UPDATE cards SET name = 'Натаниэл Чалоба', forbidden_words = ARRAY['Натаниэл Чалоба','Натаниэл','Чалоба']::text[] WHERE id = '7b76d1e9-289a-43b2-849a-fe08db58a91e';  -- was Чалоба, Натаниэл
UPDATE cards SET name = 'Трево Чалоба', forbidden_words = ARRAY['Трево Чалоба','Трево','Чалоба']::text[] WHERE id = '29d4054b-dd42-429f-a2fc-3aaf664c99d3';  -- was Чалоба, Трево
UPDATE cards SET name = 'Хамза Чаудри', forbidden_words = ARRAY['Хамза Чаудри','Хамза','Чаудри']::text[] WHERE id = '9813be75-d8b1-4310-9271-4207aca63017';  -- was Чаудри, Хамза
UPDATE cards SET name = 'Калум Чеймберс', forbidden_words = ARRAY['Калум Чеймберс','Калум','Чеймберс']::text[] WHERE id = '4fe2eb6b-4dbc-438b-9310-2c63002702f9';  -- was Чеймберс, Калум
UPDATE cards SET name = 'Бен Чилуэлл', forbidden_words = ARRAY['Бен Чилуэлл','Бен','Чилуэлл']::text[] WHERE id = '73056504-184b-4238-825b-3ff996baeb81';  -- was Чилуэлл, Бен
UPDATE cards SET name = 'Карни Чуквуэмека', forbidden_words = ARRAY['Карни Чуквуэмека','Карни','Чуквуэмека']::text[] WHERE id = 'a9efebb6-1d74-4a52-9286-aad69c58ee56';  -- was Чуквуэмека, Карни
UPDATE cards SET name = 'Эванилсон', forbidden_words = ARRAY['Эванилсон']::text[] WHERE id = 'a6b474dd-e399-45d4-a127-2ff28519aba3';  -- was Эванилсон (футболист, 1999)
UPDATE cards SET name = 'Мартин Эдегор', forbidden_words = ARRAY['Мартин Эдегор','Мартин','Эдегор']::text[] WHERE id = 'd363888e-92a8-49a3-b6ab-abcaa5503710';  -- was Эдегор, Мартин
UPDATE cards SET name = 'Одсонн Эдуар', forbidden_words = ARRAY['Одсонн Эдуар','Одсонн','Эдуар']::text[] WHERE id = '1edf493e-134e-4ddf-9f1a-1bfebfb1c888';  -- was Эдуар, Одсонн
UPDATE cards SET name = 'Анвар Эль-Гази', forbidden_words = ARRAY['Анвар Эль-Гази','Анвар','Эль-Гази']::text[] WHERE id = 'b7be7f4f-740f-472c-8412-167583f7f8fd';  -- was Эль-Гази, Анвар
UPDATE cards SET name = 'Мохамед Эльюнусси', forbidden_words = ARRAY['Мохамед Эльюнусси','Мохамед','Эльюнусси']::text[] WHERE id = 'b8028a98-7687-4786-891d-c133dfda69df';  -- was Эльюнусси, Мохамед
UPDATE cards SET name = 'Ватару Эндо', forbidden_words = ARRAY['Ватару Эндо','Ватару','Эндо']::text[] WHERE id = 'e2bed9b4-1229-4a4a-a558-21a521ce06ee';  -- was Эндо, Ватару
UPDATE cards SET name = 'Хулио Сесар Энсисо', forbidden_words = ARRAY['Хулио Сесар Энсисо','Хулио','Сесар','Энсисо']::text[] WHERE id = 'a474cb3f-98d1-453f-b36a-14e38c263671';  -- was Энсисо, Хулио Сесар (футболист, 2004)
UPDATE cards SET name = 'Родриго Эрнандес', forbidden_words = ARRAY['Родриго Эрнандес','Родриго','Эрнандес']::text[] WHERE id = '3cd0a996-483d-442a-88db-6a3efed61dac';  -- was Эрнандес, Родриго
UPDATE cards SET name = 'Бренден Эронсон', forbidden_words = ARRAY['Бренден Эронсон','Бренден','Эронсон']::text[] WHERE id = 'cf4fa7e8-12b5-4608-9531-9fdf0de976a9';  -- was Эронсон, Бренден
UPDATE cards SET name = 'Янхель Эррера', forbidden_words = ARRAY['Янхель Эррера','Янхель','Эррера']::text[] WHERE id = '1967a8b5-31c8-4cef-940e-bc5f4a075827';  -- was Эррера, Янхель
UPDATE cards SET name = 'Клаудио Эчеверри', forbidden_words = ARRAY['Клаудио Эчеверри','Клаудио','Эчеверри']::text[] WHERE id = '6830e1f3-84c3-4138-a77a-b7a0c9298430';  -- was Эчеверри, Клаудио
UPDATE cards SET name = 'Элдин Якупович', forbidden_words = ARRAY['Элдин Якупович','Элдин','Якупович']::text[] WHERE id = '0b459623-2262-4059-a501-05f929c6ca55';  -- was Якупович, Элдин
UPDATE cards SET name = 'Витали Янельт', forbidden_words = ARRAY['Витали Янельт','Витали','Янельт']::text[] WHERE id = '899f3911-1dc3-45d0-9e4b-da3a931b7935';  -- was Янельт, Витали
UPDATE cards SET name = 'Егор Романович Ярмолюк', forbidden_words = ARRAY['Егор Романович Ярмолюк','Егор','Романович','Ярмолюк']::text[] WHERE id = '7128ae38-e1de-4bf2-9ff5-5e9bea69220d';  -- was Ярмолюк, Егор Романович

-- 2) DELETE scraped cards that become exact duplicates of OLD cards
DELETE FROM cards WHERE id = '4d9f34d0-d8de-4842-85e5-b68b85fba0ee';  -- Адамс, Че -> Че Адамс == OLD Че Адамс
DELETE FROM cards WHERE id = '64bf5a0a-8942-45c2-835d-d1915fd9d91d';  -- Аит-Нури, Райан -> Райан Аит-Нури == OLD Райан Аит-Нури
DELETE FROM cards WHERE id = '597ef741-ae73-4e0b-ba16-2c69f4fcb591';  -- Айна, Ола -> Ола Айна == OLD Ола Айна
DELETE FROM cards WHERE id = '07926d9a-cf9b-45ec-9e6c-997232df7c70';  -- Айю, Андре -> Андре Айю == OLD Андре Айю
DELETE FROM cards WHERE id = '073acb5b-16f7-43ee-b654-4981e1368b04';  -- Айю, Джордан -> Джордан Айю == OLD Джордан Айю
DELETE FROM cards WHERE id = 'c37d6be0-4aae-49c9-bd58-0fa979a013d6';  -- Александер-Арнольд, Трент -> Трент Александер-Арнольд == OLD Трент Александер-Арнольд
DELETE FROM cards WHERE id = '9df7e6e3-bdbe-4279-ad56-a761a2c71eba';  -- Алли, Деле -> Деле Алли == OLD Деле Алли
DELETE FROM cards WHERE id = '78586915-dfe9-4c58-a461-20128510a3bf';  -- Альварес, Хулиан -> Хулиан Альварес == OLD Хулиан Альварес
DELETE FROM cards WHERE id = '9137d06d-1cf2-47b3-90bb-aca9a144d04c';  -- Альмирон, Мигель -> Мигель Альмирон == OLD Мигель Альмирон
DELETE FROM cards WHERE id = 'a40a4cf1-f8f2-45c2-a8ee-743ca0b036de';  -- Амрабат, Софьян -> Софьян Амрабат == OLD Софьян Амрабат
DELETE FROM cards WHERE id = '67244563-2f8b-4496-937e-2ade5fc6db03';  -- Аррисабалага, Кепа -> Кепа Аррисабалага == OLD Кепа Аррисабалага
DELETE FROM cards WHERE id = '64bd1bd7-169c-4237-ac58-4ea5e57482c7';  -- Беднарек, Ян -> Ян Беднарек == OLD Ян Беднарек
DELETE FROM cards WHERE id = '5bbccb38-d877-4a7b-ab3f-fd7a5a2f4f2e';  -- Бентанкур, Родриго -> Родриго Бентанкур == OLD Родриго Бентанкур
DELETE FROM cards WHERE id = 'c04e8f75-4585-4dc8-bb9b-d7fcb7c49b86';  -- Боуэн, Джаррод -> Джаррод Боуэн == OLD Джаррод Боуэн
DELETE FROM cards WHERE id = '3b6990fb-9bce-4f5e-b78d-53ec0f3f7c87';  -- Ван Дейк, Вирджил -> Вирджил Ван Дейк == OLD Вирджил Ван Дейк
DELETE FROM cards WHERE id = '402a3eae-9237-46d9-899e-a593a270ee65';  -- Варан, Рафаэль -> Рафаэль Варан == OLD Рафаэль Варан
DELETE FROM cards WHERE id = 'd7ae61c6-cfb0-40b2-945e-e26536ca5052';  -- Варди, Джейми -> Джейми Варди == OLD Джейми Варди
DELETE FROM cards WHERE id = 'd66f78fb-210c-4fe1-af08-b6b5b6cab708';  -- Вегхорст, Ваут -> Ваут Вегхорст == OLD Ваут Вегхорст
DELETE FROM cards WHERE id = 'a7d1f078-8822-4072-a78d-326aefddccd8';  -- Вербрюгген, Барт -> Барт Вербрюгген == OLD Барт Вербрюгген
DELETE FROM cards WHERE id = '578df6c2-bae7-4c03-ad81-42b46b7c888d';  -- Вернер, Тимо -> Тимо Вернер == OLD Тимо Вернер
DELETE FROM cards WHERE id = 'ebd9181e-641e-4068-adf5-0b03a2ab6e66';  -- Виллиан (футболист) -> Виллиан == OLD Виллиан
DELETE FROM cards WHERE id = 'c0af4f65-c26b-4e9b-bb26-5312c2825410';  -- Вирц, Флориан -> Флориан Вирц == OLD Флориан Вирц
DELETE FROM cards WHERE id = 'a621abff-5ce2-48a7-ad44-1c8eea57f91d';  -- Влашич, Никола -> Никола Влашич == OLD Никола Влашич
DELETE FROM cards WHERE id = 'f206c546-04b6-483b-80ac-8619bc2e0d78';  -- Вуд, Крис (футболист) -> Крис Вуд == OLD Крис Вуд
DELETE FROM cards WHERE id = 'e2802cc6-4c3b-40cd-b0ef-604b2bdff454';  -- Гарначо, Алехандро -> Алехандро Гарначо == OLD Алехандро Гарначо
DELETE FROM cards WHERE id = '59bd44c7-6798-4319-9254-aef937d4f5ab';  -- Гвардиол, Йошко -> Йошко Гвардиол == OLD Йошко Гвардиол
DELETE FROM cards WHERE id = 'd2c43b66-8fe0-4ed8-b23a-9d5d69f62b41';  -- Гейе, Идрисса -> Идрисса Гейе == OLD Идрисса Гейе
DELETE FROM cards WHERE id = '6b159a2d-cd84-43cd-9b02-9108c9a01fbd';  -- Гиббс-Уайт, Морган -> Морган Гиббс-Уайт == OLD Морган Гиббс-Уайт
DELETE FROM cards WHERE id = '68cc1dcf-1cfd-48da-876c-645cabfd778a';  -- Гонсалес, Нико -> Нико Гонсалес == OLD Нико Гонсалес
DELETE FROM cards WHERE id = '4e9d4256-3f1e-4096-a367-31a4b7cc4896';  -- Гордон, Энтони -> Энтони Гордон == OLD Энтони Гордон
DELETE FROM cards WHERE id = '2ee560b9-7482-4ff6-b07c-e4eeb7ee317e';  -- Гравенберх, Райан -> Райан Гравенберх == OLD Райан Гравенберх
DELETE FROM cards WHERE id = '608cdfeb-9dcf-4410-baa1-8641ae3f0ebf';  -- Дайер, Эрик -> Эрик Дайер == OLD Эрик Дайер
DELETE FROM cards WHERE id = '4e25300f-9c87-49f7-962e-653d9d025e00';  -- Де Хеа, Давид -> Давид Де Хеа == OLD Давид Де Хеа
DELETE FROM cards WHERE id = '88fddc61-827d-4d1a-b86d-62fe8c772b4f';  -- Делап, Лиам -> Лиам Делап == OLD Лиам Делап
DELETE FROM cards WHERE id = '6b70538b-6949-4f23-a710-ac0100258b69';  -- Джака, Гранит -> Гранит Джака == OLD Гранит Джака
DELETE FROM cards WHERE id = 'f6f57e8f-98bc-4bf6-ba00-66da30aa6bfb';  -- Джеймс, Рис (футболист, 1999) -> Рис Джеймс == OLD Рис Джеймс
DELETE FROM cards WHERE id = 'b4e85a29-0bb1-46a5-b84a-9b673e6c1845';  -- Джонс, Фил -> Фил Джонс == OLD Фил Джонс
DELETE FROM cards WHERE id = '38cddcb4-32f5-4f85-9e2e-d0e4cb076afc';  -- Джонсон, Бреннан -> Бреннан Джонсон == OLD Бреннан Джонсон
DELETE FROM cards WHERE id = 'e85fad34-8000-47c2-8884-98999929885f';  -- Дзаньоло, Николо -> Николо Дзаньоло == OLD Николо Дзаньоло
DELETE FROM cards WHERE id = 'f5677c54-d51c-438f-89a5-2ba294598474';  -- Дубравка, Мартин -> Мартин Дубравка == OLD Мартин Дубравка
DELETE FROM cards WHERE id = 'de6b1158-1f25-40ed-bd4b-b66ac369bba6';  -- Жоржиньо (итальянский футболист) -> Жоржиньо == OLD Жоржиньо
DELETE FROM cards WHERE id = 'ef6ab49b-d15d-4dba-a75c-30edaa9e046a';  -- Зума, Курт -> Курт Зума == OLD Курт Зума
DELETE FROM cards WHERE id = '2791bab6-1b0a-487b-b2b6-23c94e1f1ef9';  -- Ивоби, Алекс -> Алекс Ивоби == OLD Алекс Ивоби
DELETE FROM cards WHERE id = '93c5fedc-4d45-4c91-93f8-2a5cd0dbeca0';  -- Исак, Александер -> Александер Исак == OLD Александер Исак
DELETE FROM cards WHERE id = '9b9cfafa-318a-4304-b39e-ce2b1cecf29e';  -- Керкез, Милош -> Милош Керкез == OLD Милош Керкез
DELETE FROM cards WHERE id = '41f86948-56bd-4712-8bc9-cf234456175a';  -- Клюйверт, Джастин -> Джастин Клюйверт == OLD Джастин Клюйверт
DELETE FROM cards WHERE id = '0ec1da51-909f-4a55-992c-0d6216f991b8';  -- Ковачич, Матео -> Матео Ковачич == OLD Матео Ковачич
DELETE FROM cards WHERE id = '40afa9bc-9c8e-4b29-99bf-7e214ec3bd57';  -- Конате, Ибраима -> Ибраима Конате == OLD Ибраима Конате
DELETE FROM cards WHERE id = 'e06fa9e4-b8e9-4587-9193-794396e9a40c';  -- Конса, Эзри -> Эзри Конса == OLD Эзри Конса
DELETE FROM cards WHERE id = '572be110-febf-4f67-a137-813f2ca40c22';  -- Корне, Максвел -> Максвел Корне == OLD Максвел Корне
DELETE FROM cards WHERE id = '4c8eae84-60cf-4c27-8ccd-b3d7161f9218';  -- Крул, Тим -> Тим Крул == OLD Тим Крул
DELETE FROM cards WHERE id = '4c22b5b5-b07b-415c-af74-aa4792d1ad8f';  -- Кудус, Мохаммед -> Мохаммед Кудус == OLD Мохаммед Кудус
DELETE FROM cards WHERE id = '72d1c296-9c8f-4f4f-98db-c5ef8b4d41ca';  -- Кукурелья, Марк -> Марк Кукурелья == OLD Марк Кукурелья
DELETE FROM cards WHERE id = '0c0d7e85-0595-49fc-888c-d4d695734a40';  -- Кьеза, Федерико -> Федерико Кьеза == OLD Федерико Кьеза
DELETE FROM cards WHERE id = '92ca1ce1-bf22-43a3-b0be-55a720f151f1';  -- Лаллана, Адам -> Адам Лаллана == OLD Адам Лаллана
DELETE FROM cards WHERE id = '3f1d8097-b540-4681-8a45-feacd57b3cc1';  -- Лено, Бернд -> Бернд Лено == OLD Бернд Лено
DELETE FROM cards WHERE id = '1c764ba1-f873-4408-a0a1-dcf588b42ee9';  -- Лерма, Джефферсон -> Джефферсон Лерма == OLD Джефферсон Лерма
DELETE FROM cards WHERE id = 'bd847885-1637-4415-8cfb-65811f6992a4';  -- Ливраменто, Тино -> Тино Ливраменто == OLD Тино Ливраменто
DELETE FROM cards WHERE id = '47247489-2570-4d2e-8433-4ea6531e8711';  -- Лингард, Джесси -> Джесси Лингард == OLD Джесси Лингард
DELETE FROM cards WHERE id = 'c8f73fe0-96e6-40b8-929b-b1be4313defa';  -- Линделёф, Виктор -> Виктор Линделёф == OLD Виктор Линделёф
DELETE FROM cards WHERE id = '0bc2c162-077b-489d-be29-d0a976ae7081';  -- Лонгстафф, Шон -> Шон Лонгстафф == OLD Шон Лонгстафф
DELETE FROM cards WHERE id = '742bc3eb-c088-4828-aeae-473596bd8799';  -- Лукаку, Ромелу -> Ромелу Лукаку == OLD Ромелу Лукаку
DELETE FROM cards WHERE id = '9db3a896-9dbc-4fe5-84a9-cfa86108738d';  -- Льорис, Уго -> Уго Льорис == OLD Уго Льорис
DELETE FROM cards WHERE id = '54b32751-b6fb-4d3c-999b-c27aebf71160';  -- Мавропанос, Константинос -> Константинос Мавропанос == OLD Константинос Мавропанос
DELETE FROM cards WHERE id = 'a9f55b65-07a9-43ec-8177-86c11b72bedc';  -- Мадуэке, Нони -> Нони Мадуэке == OLD Нони Мадуэке
DELETE FROM cards WHERE id = 'ab7cbf70-58e1-49f0-a28e-f6f3f0af92ae';  -- Мазрауи, Нуссаир -> Нуссаир Мазрауи == OLD Нуссаир Мазрауи
DELETE FROM cards WHERE id = '586fca39-b13d-4129-9192-fdd4571228cf';  -- Макгинн, Джон -> Джон Макгинн == OLD Джон Макгинн
DELETE FROM cards WHERE id = '97ebe66f-79cf-4629-bd4d-ea845e5f6768';  -- Марсьяль, Антони -> Антони Марсьяль == OLD Антони Марсьяль
DELETE FROM cards WHERE id = '0dfa9ea9-a30a-4bc6-a7dd-e5fcf4c0c16b';  -- Мартинес, Эмилиано -> Эмилиано Мартинес == OLD Эмилиано Мартинес
DELETE FROM cards WHERE id = '85f564e0-14f7-4798-9ee1-251061fffe8c';  -- Мата, Хуан -> Хуан Мата == OLD Хуан Мата
DELETE FROM cards WHERE id = '29aa0f7e-2acd-4978-b946-82565429d66b';  -- Матета, Жан-Филипп -> Жан-Филипп Матета == OLD Жан-Филипп Матета
DELETE FROM cards WHERE id = 'ee7751e0-c9f6-463c-9848-b30f12c89bb5';  -- Матип, Жоэль -> Жоэль Матип == OLD Жоэль Матип
DELETE FROM cards WHERE id = 'aa39a6d2-c44f-490f-8e37-04055d494fa1';  -- Миленкович, Никола -> Никола Миленкович == OLD Никола Миленкович
DELETE FROM cards WHERE id = '2536ea7d-022d-4ce8-a106-ae65d0fd76af';  -- Милнер, Джеймс -> Джеймс Милнер == OLD Джеймс Милнер
DELETE FROM cards WHERE id = '2cdb916d-204b-4ea4-b7d0-88f38b19d4b0';  -- Минамино, Такуми -> Такуми Минамино == OLD Такуми Минамино
DELETE FROM cards WHERE id = 'bf5ce886-2e76-41fb-bd85-6ab057645557';  -- Митома, Каору -> Каору Митома == OLD Каору Митома
DELETE FROM cards WHERE id = 'e7a17c38-804f-4028-9bb4-1b9b01db7cdc';  -- Моура, Лукас -> Лукас Моура == OLD Лукас Моура
DELETE FROM cards WHERE id = 'fd4f742c-a5da-4716-a7f5-207e6b2ebdc4';  -- Навас, Кейлор -> Кейлор Навас == OLD Кейлор Навас
DELETE FROM cards WHERE id = 'c072e845-e78f-4da8-95b0-429f159e0f82';  -- Нету, Педру -> Педру Нету == OLD Педру Нету
DELETE FROM cards WHERE id = '11b5e8d5-6771-4c61-bb14-77ae6a780e24';  -- Нкетиа, Эдди -> Эдди Нкетиа == OLD Эдди Нкетиа
DELETE FROM cards WHERE id = '063d85e9-85d9-40b0-854f-72510541d5bf';  -- Нуньес, Дарвин -> Дарвин Нуньес == OLD Дарвин Нуньес
DELETE FROM cards WHERE id = '7e6bc99a-1aa4-41a2-be29-0a4235dc18e1';  -- Олисе, Майкл -> Майкл Олисе == OLD Майкл Олисе
DELETE FROM cards WHERE id = 'c4107718-bd7e-49e8-baf0-445d4896beb8';  -- Онана, Андре -> Андре Онана == OLD Андре Онана
DELETE FROM cards WHERE id = 'ca3f9b6d-2b63-4d32-8e77-5e3fcdc9dd03';  -- Ориги, Дивок -> Дивок Ориги == OLD Дивок Ориги
DELETE FROM cards WHERE id = '860128c7-ac78-41eb-bf7c-594a876d8440';  -- Палмер, Коул -> Коул Палмер == OLD Коул Палмер
DELETE FROM cards WHERE id = '4b7f529a-b325-4b49-9d35-9e6c087d004b';  -- Парти, Томас -> Томас Парти == OLD Томас Парти
DELETE FROM cards WHERE id = '5172878e-86da-4b12-9680-a012467a4b72';  -- Перишич, Иван -> Иван Перишич == OLD Иван Перишич
DELETE FROM cards WHERE id = '1dfd82e9-c9cd-4a88-93aa-63d37435b45b';  -- Пикфорд, Джордан -> Джордан Пикфорд == OLD Джордан Пикфорд
DELETE FROM cards WHERE id = 'b25520e9-d89f-420d-922e-a5f6dbdd5529';  -- Порро, Педро -> Педро Порро == OLD Педро Порро
DELETE FROM cards WHERE id = '34244710-ff0f-43fc-ae80-8e5a96130797';  -- Пулишич, Кристиан -> Кристиан Пулишич == OLD Кристиан Пулишич
DELETE FROM cards WHERE id = '1aae64e7-48d9-4ae3-b55a-8cd2806e57f1';  -- Райс, Деклан -> Деклан Райс == OLD Деклан Райс
DELETE FROM cards WHERE id = '09f1c525-c75c-4d6a-9465-e4d631548293';  -- Робертсон, Эндрю (футболист) -> Эндрю Робертсон == OLD Эндрю Робертсон
DELETE FROM cards WHERE id = '3f590ae0-1513-42da-82d9-a80d39f25e97';  -- Робинсон, Энтони (футболист) -> Энтони Робинсон == OLD Энтони Робинсон
DELETE FROM cards WHERE id = '61bfe255-fb65-4c3c-bef6-7c16d82c414b';  -- Салиба, Вильям -> Вильям Салиба == OLD Вильям Салиба
DELETE FROM cards WHERE id = '3ce03625-5a0a-47ff-a1dd-150f418962d8';  -- Санчес, Давинсон -> Давинсон Санчес == OLD Давинсон Санчес
DELETE FROM cards WHERE id = 'aebb8b61-c9cc-4925-969d-104d77d7a775';  -- Сарр, Исмаила -> Исмаила Сарр == OLD Исмаила Сарр
DELETE FROM cards WHERE id = '067cb601-c40c-4669-b904-6e20d4e786a9';  -- Сарр, Пап Матар -> Пап Матар Сарр == OLD Пап Матар Сарр
DELETE FROM cards WHERE id = '51b7f850-d959-41f1-9791-88013206a66a';  -- Селс, Матц -> Матц Селс == OLD Матц Селс
DELETE FROM cards WHERE id = '43b48938-1b10-4657-bb81-1feaff7ab46f';  -- Силва, Бернарду -> Бернарду Силва == OLD Бернарду Силва
DELETE FROM cards WHERE id = 'd4322397-c9e3-4e29-9313-72bbe15e1043';  -- Собослаи, Доминик -> Доминик Собослаи == OLD Доминик Собослаи
DELETE FROM cards WHERE id = '09e55df1-5b07-4a52-8a6f-7cc8e3127f1c';  -- Соучек, Томаш -> Томаш Соучек == OLD Томаш Соучек
DELETE FROM cards WHERE id = 'd1b65a2a-395b-427b-9805-7374a9977f57';  -- Стерлинг, Рахим -> Рахим Стерлинг == OLD Рахим Стерлинг
DELETE FROM cards WHERE id = 'fd73552d-6486-4f41-949b-19ac48c93c61';  -- Стракоша, Томас -> Томас Стракоша == OLD Томас Стракоша
DELETE FROM cards WHERE id = 'ed041878-9d96-47ad-a1b1-e402b9ada3c7';  -- Тилеманс, Юри -> Юри Тилеманс == OLD Юри Тилеманс
DELETE FROM cards WHERE id = '9ca6a4ec-b5e0-483a-aeb0-191dcebb0b90';  -- Тирни, Киран -> Киран Тирни == OLD Киран Тирни
DELETE FROM cards WHERE id = '70197c38-3421-4548-af47-8018bfa8a68e';  -- Тонали, Сандро -> Сандро Тонали == OLD Сандро Тонали
DELETE FROM cards WHERE id = 'bc478f72-3b7e-4861-9497-d372530c2aaf';  -- Торрес, Пау -> Пау Торрес == OLD Пау Торрес
DELETE FROM cards WHERE id = 'd617c84d-7933-4a0b-b527-62e99a21f04d';  -- Угарте, Мануэль (футболист) -> Мануэль Угарте == OLD Мануэль Угарте
DELETE FROM cards WHERE id = '11c848e8-2bc9-40e1-9f63-8f5e81d87160';  -- Уиллок, Джо -> Джо Уиллок == OLD Джо Уиллок
DELETE FROM cards WHERE id = '04227df5-6b8e-41c7-a353-5231763fc7d4';  -- Уильямс, Неко -> Неко Уильямс == OLD Неко Уильямс
DELETE FROM cards WHERE id = 'c62bfd1b-2f64-4203-b93b-a99bf474428f';  -- Уокер, Кайл -> Кайл Уокер == OLD Кайл Уокер
DELETE FROM cards WHERE id = 'ff3cc7bd-2b17-4b87-8cc6-791cbc1da696';  -- Уолкотт, Тео -> Тео Уолкотт == OLD Тео Уолкотт
DELETE FROM cards WHERE id = 'da2d5bcc-94ab-4cec-80e5-8dd4d8b0edb9';  -- Уоткинс, Олли -> Олли Уоткинс == OLD Олли Уоткинс
DELETE FROM cards WHERE id = '4e92520f-77bf-4ff2-98ee-2b7804ba715e';  -- Фернандес, Энцо -> Энцо Фернандес == OLD Энцо Фернандес
DELETE FROM cards WHERE id = '1eb0b55c-d5d7-49b1-adec-855b88c8f1fa';  -- Флеккен, Марк -> Марк Флеккен == OLD Марк Флеккен
DELETE FROM cards WHERE id = '962a0a53-aea4-4926-8f06-98cd2755d797';  -- Фройлер, Ремо -> Ремо Фройлер == OLD Ремо Фройлер
DELETE FROM cards WHERE id = '2c844f0e-09b4-45c0-ae53-db3f81659fcc';  -- Хаверц, Кай -> Кай Хаверц == OLD Кай Хаверц
DELETE FROM cards WHERE id = 'b632b8c5-79ca-4869-82f5-2e5436e1ecfb';  -- Харвуд-Беллис, Тейлор -> Тейлор Харвуд-Беллис == OLD Тейлор Харвуд-Беллис
DELETE FROM cards WHERE id = '8b26077b-6b39-4276-bc6a-dec5547db009';  -- Хёйсен, Дин -> Дин Хёйсен == OLD Дин Хёйсен
DELETE FROM cards WHERE id = '2783901d-9f9a-42f3-9ce7-86fde5ee2525';  -- Хендерсон, Джордан -> Джордан Хендерсон == OLD Джордан Хендерсон
DELETE FROM cards WHERE id = 'c958b259-67fd-4212-8747-069f1e653cd3';  -- Хендерсон, Дин -> Дин Хендерсон == OLD Дин Хендерсон
DELETE FROM cards WHERE id = 'd4e7a547-9538-48e0-be2d-6057c52afeff';  -- Хименес, Рауль (футболист) -> Рауль Хименес == OLD Рауль Хименес
DELETE FROM cards WHERE id = '20163e36-8d74-4140-a250-20d081114c46';  -- Холдинг, Роб -> Роб Холдинг == OLD Роб Холдинг
DELETE FROM cards WHERE id = 'e37b0a97-4d08-4390-984a-ceddc4038779';  -- Шаде, Кевин -> Кевин Шаде == OLD Кевин Шаде
DELETE FROM cards WHERE id = '541617f4-c014-4133-92d9-8ea3d4df3244';  -- Шелви, Джонджо -> Джонджо Шелви == OLD Джонджо Шелви
DELETE FROM cards WHERE id = 'b780b649-8cfd-48e1-9ad2-952d5aa5c76e';  -- Шер, Фабиан -> Фабиан Шер == OLD Фабиан Шер
DELETE FROM cards WHERE id = '5fd24574-b135-437c-ad31-ece4b0855a2f';  -- Шмейхель, Каспер -> Каспер Шмейхель == OLD Каспер Шмейхель
DELETE FROM cards WHERE id = 'b9fc0b6e-81af-49d7-a365-63696587cf8c';  -- Шоу, Люк -> Люк Шоу == OLD Люк Шоу
DELETE FROM cards WHERE id = '752aac32-936d-4b51-911d-94aeffaf3051';  -- Эванс, Джонни -> Джонни Эванс == OLD Джонни Эванс
DELETE FROM cards WHERE id = '3099ad22-0d53-4fca-9272-d5dbba723360';  -- Эзе, Эберечи -> Эберечи Эзе == OLD Эберечи Эзе
DELETE FROM cards WHERE id = '9e5449cf-cb18-475d-a1cf-a65b6d45058f';  -- Эллиотт, Харви -> Харви Эллиотт == OLD Харви Эллиотт
DELETE FROM cards WHERE id = '34e9598c-b887-4599-a142-57ebd6e9fa91';  -- Эступиньян, Первис -> Первис Эступиньян == OLD Первис Эступиньян
DELETE FROM cards WHERE id = 'eeadc18b-1d01-4895-abc5-13088a99cec4';  -- Янг, Эшли -> Эшли Янг == OLD Эшли Янг

-- 3) DELETE scraped cards that duplicate ANOTHER scraped card after normalize

ROLLBACK;  -- change to COMMIT only after manual review
