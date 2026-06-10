-- PREVIEW ONLY — do not run until approved.
-- Backfill cards.name_en from players_meta for player cards where name_en IS NULL.
-- 842 UPDATE; 0 ambiguous skipped; 1186 without a match.

BEGIN;

UPDATE cards SET name_en = 'Boubacar Bernard Kamara' WHERE id = '004f7f5a-1682-429e-a4db-ac96f055dbb1' AND name_en IS NULL;  -- Камара, Бубакар [exact]
UPDATE cards SET name_en = 'Maximilian Wöber' WHERE id = '008c05fa-ff7e-46d6-bc42-b31f35f0278f' AND name_en IS NULL;  -- Вёбер, Максимилиан [exact]
UPDATE cards SET name_en = 'Sergio Ramos García' WHERE id = '00e7ad83-0a25-4498-b344-ce60c78fe1de' AND name_en IS NULL;  -- Серхио Рамос [canonical]
UPDATE cards SET name_en = 'Gregor Kobel' WHERE id = '00f53e1b-48c4-467a-ac15-21358cc9c23e' AND name_en IS NULL;  -- Грегор Кобель [canonical]
UPDATE cards SET name_en = 'Benjamin Pascal Lecomte' WHERE id = '010a8580-ad8a-4c65-b665-a8caf6ab75b5' AND name_en IS NULL;  -- Бенжамен Леконт [canonical]
UPDATE cards SET name_en = 'Tyler Shaan Adams' WHERE id = '01c3ffc9-7ec6-4286-8dc2-b692ede0123a' AND name_en IS NULL;  -- Адамс, Тайлер [exact]
UPDATE cards SET name_en = 'Alisson Ramsés Becker' WHERE id = '0219aeea-fa06-470f-b5b2-ac1c3aa07360' AND name_en IS NULL;  -- Бекер, Алисон [exact]
UPDATE cards SET name_en = 'Gnaly Albert Maxwel Cornet' WHERE id = '0278ec18-2212-4d91-8b6a-23debddbb9bc' AND name_en IS NULL;  -- Максвел Корне [canonical]
UPDATE cards SET name_en = 'Jørgen Strand Larsen' WHERE id = '02df8fc5-dcd9-40f7-801e-f84b69470566' AND name_en IS NULL;  -- Йёрген Странн Ларсен [canonical]
UPDATE cards SET name_en = 'Berat Djimsiti' WHERE id = '03720de5-3e1e-47b7-9033-0029683d8079' AND name_en IS NULL;  -- Берат Джимсити [canonical]
UPDATE cards SET name_en = 'Romain Ghanem Paul Saïss' WHERE id = '04112c9a-94d9-4a8c-a062-421baef329bd' AND name_en IS NULL;  -- Саисс, Ромен [exact]
UPDATE cards SET name_en = 'Neco Shay Williams' WHERE id = '04227df5-6b8e-41c7-a353-5231763fc7d4' AND name_en IS NULL;  -- Уильямс, Неко [exact]
UPDATE cards SET name_en = 'Christian Mate Pulišić' WHERE id = '04a08950-a395-4c76-81f2-60627ce7f77a' AND name_en IS NULL;  -- Кристиан Пулишич [canonical]
UPDATE cards SET name_en = 'Florian Tristán Mariano Thauvin' WHERE id = '04d49c8f-13a1-4296-bfd2-be1641a4ff66' AND name_en IS NULL;  -- Флорьян Товен [canonical]
UPDATE cards SET name_en = 'Julián Vicente Araujo Zúñiga' WHERE id = '0515d6ad-9b01-470e-bf29-8b6e19246fdf' AND name_en IS NULL;  -- Араухо, Хулиан [exact]
UPDATE cards SET name_en = 'Thomas Cairney' WHERE id = '0569fb81-83af-4e3e-b20c-9488fb3550ba' AND name_en IS NULL;  -- Кэрни, Том [exact]
UPDATE cards SET name_en = 'Axel Laurent Angel Lambert Witsel' WHERE id = '0579d0ba-8de5-40f1-b160-fec3c454862a' AND name_en IS NULL;  -- Аксель Витсель [canonical]
UPDATE cards SET name_en = 'Ainsley Cory Maitland-Niles' WHERE id = '05d6b896-c7dd-4d21-88b2-7b18304820d3' AND name_en IS NULL;  -- Мейтленд-Найлз, Энзли [exact]
UPDATE cards SET name_en = 'James Philip Milner' WHERE id = '05ef6637-1ef1-4658-94a0-45f55a298459' AND name_en IS NULL;  -- Джеймс Милнер [canonical]
UPDATE cards SET name_en = 'Anel Ahmedhodžić' WHERE id = '06236fac-a60e-4e02-b6a3-2cd9eeff1f20' AND name_en IS NULL;  -- Ахмедходжич, Анел [exact]
UPDATE cards SET name_en = 'Darwin Gabriel Núñez Ribeiro' WHERE id = '063d85e9-85d9-40b0-854f-72510541d5bf' AND name_en IS NULL;  -- Нуньес, Дарвин [exact]
UPDATE cards SET name_en = 'Ander Herrera Agüera' WHERE id = '06628a09-0d3b-447c-a364-fdf216d6dd02' AND name_en IS NULL;  -- Андер Эррера [canonical]
UPDATE cards SET name_en = 'Pape Matar Sarr' WHERE id = '067cb601-c40c-4669-b904-6e20d4e786a9' AND name_en IS NULL;  -- Сарр, Пап Матар [exact]
UPDATE cards SET name_en = 'Aleksandar Mitrović' WHERE id = '06859d69-cfed-444f-8b61-997282698919' AND name_en IS NULL;  -- Митрович, Александар (футболист) [exact]
UPDATE cards SET name_en = 'Jamaal Lascelles' WHERE id = '06a53dc8-a47b-4659-9307-b95ec02a6a30' AND name_en IS NULL;  -- Ласселлс, Джамал [exact]
UPDATE cards SET name_en = 'Saša Kalajdžić' WHERE id = '06c00f3d-cc73-4069-8dd1-65bb9d1d5c5e' AND name_en IS NULL;  -- Калайджич, Саша [exact]
UPDATE cards SET name_en = 'Salvatore Sirigu' WHERE id = '06e06976-d29f-4a5d-a737-42781dd2e9e4' AND name_en IS NULL;  -- Сальваторе Сиригу [canonical]
UPDATE cards SET name_en = 'Mats Wieffer' WHERE id = '071929c5-ac51-4531-84df-e353f39e93f4' AND name_en IS NULL;  -- Виффер, Матс [exact]
UPDATE cards SET name_en = 'Mile Svilar' WHERE id = '071e529f-f360-4826-861f-f876ea794963' AND name_en IS NULL;  -- Миле Свилар [canonical]
UPDATE cards SET name_en = 'Alphonse Francis Areola' WHERE id = '07339231-502b-438d-8824-d3e7129f6ea3' AND name_en IS NULL;  -- Ареола, Альфонс [exact]
UPDATE cards SET name_en = 'Jordan Pierre Ayew' WHERE id = '073acb5b-16f7-43ee-b654-4981e1368b04' AND name_en IS NULL;  -- Айю, Джордан [exact]
UPDATE cards SET name_en = 'André Morgan Rami Ayew' WHERE id = '07926d9a-cf9b-45ec-9e6c-997232df7c70' AND name_en IS NULL;  -- Айю, Андре [exact]
UPDATE cards SET name_en = 'Mikel Merino Zazón' WHERE id = '0865dc53-f1a0-433e-808f-b86edca61b6d' AND name_en IS NULL;  -- Мерино, Микель [exact]
UPDATE cards SET name_en = 'Benjamin Anthony Brereton Díaz' WHERE id = '089dd67a-1cd8-4a9f-835a-bc695ccc92fa' AND name_en IS NULL;  -- Бреретон, Бен [exact]
UPDATE cards SET name_en = 'Bukayo Ayoyinka Temidayo Saka' WHERE id = '0920fbdb-4a92-4a3a-9703-b70ce89c1e37' AND name_en IS NULL;  -- Сака, Букайо [exact]
UPDATE cards SET name_en = 'Allan Irénée Saint-Maximin' WHERE id = '09a25157-4280-471a-88ed-80df709eea37' AND name_en IS NULL;  -- Сен-Максимен, Аллан [exact]
UPDATE cards SET name_en = 'Takehiro Tomiyasu' WHERE id = '09c02a1c-7bda-4702-a30f-be35724537a9' AND name_en IS NULL;  -- Томиясу, Такэхиро [exact]
UPDATE cards SET name_en = 'Tomáš Souček' WHERE id = '09e55df1-5b07-4a52-8a6f-7cc8e3127f1c' AND name_en IS NULL;  -- Соучек, Томаш [exact]
UPDATE cards SET name_en = 'Andrew Henry Robertson' WHERE id = '09f1c525-c75c-4d6a-9465-e4d631548293' AND name_en IS NULL;  -- Робертсон, Эндрю (футболист) [exact]
UPDATE cards SET name_en = 'Lionel Andrés Messi Cuccittini' WHERE id = '0a6ecfd6-a4eb-4494-8787-c1ff1acac7c3' AND name_en IS NULL;  -- Лионель Месси [canonical]
UPDATE cards SET name_en = 'Alexis Jesse Saelemaekers' WHERE id = '0a777822-8d57-4071-9695-8b84e8774b75' AND name_en IS NULL;  -- Алексис Салемакерс [canonical]
UPDATE cards SET name_en = 'Dominik Szoboszlai' WHERE id = '0acb44e2-616e-405d-801d-cbd3823713a2' AND name_en IS NULL;  -- Доминик Собослаи [canonical]
UPDATE cards SET name_en = 'Jan Thilo Kehrer' WHERE id = '0aff058b-cd6d-4fa5-9f35-7fda88761478' AND name_en IS NULL;  -- Керер, Тило [exact]
UPDATE cards SET name_en = 'Eldin Jakupović' WHERE id = '0b459623-2262-4059-a501-05f929c6ca55' AND name_en IS NULL;  -- Якупович, Элдин [exact]
UPDATE cards SET name_en = 'Julian Ryerson' WHERE id = '0b4c3bae-21dd-4ed8-84bf-fcadac71cc1f' AND name_en IS NULL;  -- Юлиан Рюэрсон [canonical]
UPDATE cards SET name_en = 'Alejandro Garnacho Ferreyra' WHERE id = '0bb56dbd-1b75-43bc-925c-0ffe97d14aac' AND name_en IS NULL;  -- Алехандро Гарначо [canonical]
UPDATE cards SET name_en = 'Sean David Longstaff' WHERE id = '0bc2c162-077b-489d-be29-d0a976ae7081' AND name_en IS NULL;  -- Лонгстафф, Шон [exact]
UPDATE cards SET name_en = 'André Trindade da Costa Neto' WHERE id = '0c03f18c-4af1-491d-b32b-66c548165efd' AND name_en IS NULL;  -- Андре (футболист, 2001) [exact]
UPDATE cards SET name_en = 'Federico Chiesa' WHERE id = '0c0d7e85-0595-49fc-888c-d4d695734a40' AND name_en IS NULL;  -- Кьеза, Федерико [exact]
UPDATE cards SET name_en = 'Rúnar Alex Rúnarsson' WHERE id = '0c97541e-31f5-43eb-8955-7e505052456e' AND name_en IS NULL;  -- Рунар Алекс Рунарссон [exact]
UPDATE cards SET name_en = 'Maxence Guy Lacroix' WHERE id = '0d0b2e51-dad3-4f5d-bea6-e8535010a1a1' AND name_en IS NULL;  -- Лакруа, Максанс [exact]
UPDATE cards SET name_en = 'Leonardo Spinazzola' WHERE id = '0d2160bc-bbcb-4eaa-90e3-fae6bf29b841' AND name_en IS NULL;  -- Леонардо Спинаццола [canonical]
UPDATE cards SET name_en = 'Luke Paul Hoare Shaw' WHERE id = '0da7fbfb-aeb4-4940-96ab-9f1d7226b438' AND name_en IS NULL;  -- Люк Шоу [canonical]
UPDATE cards SET name_en = 'Damián Emiliano Martínez Romero' WHERE id = '0dfa9ea9-a30a-4bc6-a7dd-e5fcf4c0c16b' AND name_en IS NULL;  -- Мартинес, Эмилиано [exact]
UPDATE cards SET name_en = 'Richarlison de Andrade' WHERE id = '0e078cbf-a617-4b81-89ba-c5703c74277a' AND name_en IS NULL;  -- Ришарлисон (футболист, 1997) [exact]
UPDATE cards SET name_en = 'Jacob Harry Maguire' WHERE id = '0e9f3197-2b39-49b6-8e54-401d30135a6e' AND name_en IS NULL;  -- Магуайр, Гарри [exact]
UPDATE cards SET name_en = 'Arthur Henrique Ramos de Oliveira Melo' WHERE id = '0ea7e703-e5e7-49d0-bfa6-9074c9af328b' AND name_en IS NULL;  -- Мело, Артур [exact]
UPDATE cards SET name_en = 'Rémy Joseph Cabella' WHERE id = '0eb0f5ae-5caa-4d48-b0e9-83b3b2e3fa8e' AND name_en IS NULL;  -- Реми Кабелла [canonical]
UPDATE cards SET name_en = 'Mateo Kovačić' WHERE id = '0ec1da51-909f-4a55-992c-0d6216f991b8' AND name_en IS NULL;  -- Ковачич, Матео [exact]
UPDATE cards SET name_en = 'Fabian Lukas Schär' WHERE id = '0effe23e-7990-4187-87c8-b632638769f4' AND name_en IS NULL;  -- Фабиан Шер [canonical]
UPDATE cards SET name_en = 'Teun Koopmeiners' WHERE id = '0f0742fe-de33-49c2-acfb-84ad9d1892a1' AND name_en IS NULL;  -- Тён Копмейнерс [canonical]
UPDATE cards SET name_en = 'Łukasz Marek Fabiański' WHERE id = '0f318d87-dfc1-49d3-81fb-656379605302' AND name_en IS NULL;  -- Фабьяньский, Лукаш [exact]
UPDATE cards SET name_en = 'Joël Ivo Veltman' WHERE id = '0fc139f8-4dc3-4b9d-abef-b83233b21f90' AND name_en IS NULL;  -- Велтман, Джоэл [exact]
UPDATE cards SET name_en = 'Masour Ousmane Dembélé' WHERE id = '0ffc3a03-4e87-4796-9b6c-25e82c4191fa' AND name_en IS NULL;  -- Усман Дембеле [canonical]
UPDATE cards SET name_en = 'Marc Roca Junqué' WHERE id = '10a81b28-285e-4afb-99bd-8fe82b0e11df' AND name_en IS NULL;  -- Рока, Марк [exact]
UPDATE cards SET name_en = 'Morgan Anthony Gibbs-White' WHERE id = '10fc00dc-363d-4159-9925-4a256a9f46d3' AND name_en IS NULL;  -- Морган Гиббс-Уайт [canonical]
UPDATE cards SET name_en = 'Pierluigi Gollini' WHERE id = '11263ba2-86a6-4b3c-ac93-d6a1b7023ac7' AND name_en IS NULL;  -- Голлини, Пьерлуиджи [exact]
UPDATE cards SET name_en = 'Edward Keddar Nketiah' WHERE id = '11b5e8d5-6771-4c61-bb14-77ae6a780e24' AND name_en IS NULL;  -- Нкетиа, Эдди [exact]
UPDATE cards SET name_en = 'Joseph George Willock' WHERE id = '11c848e8-2bc9-40e1-9f63-8f5e81d87160' AND name_en IS NULL;  -- Уиллок, Джо [exact]
UPDATE cards SET name_en = 'Adam David Lallana' WHERE id = '12a6c884-1b8c-4cc3-a373-d8e77ab5f61d' AND name_en IS NULL;  -- Адам Лаллана [canonical]
UPDATE cards SET name_en = 'Marc Guiu Paz' WHERE id = '130d0811-c2ae-4810-a2bf-f8741150d8ad' AND name_en IS NULL;  -- Гиу, Марк [exact]
UPDATE cards SET name_en = 'Timothy Castagne' WHERE id = '131be5ff-b25c-4745-a16b-9b1cb7c081e0' AND name_en IS NULL;  -- Кастань, Тимоти [exact]
UPDATE cards SET name_en = 'Donyell Malen' WHERE id = '131de931-736f-4dd8-bc71-c7cdbfd99dc3' AND name_en IS NULL;  -- Мален, Дониелл [exact]
UPDATE cards SET name_en = 'Fabián Ruiz Peña' WHERE id = '131ea6aa-7870-4bae-b236-aa02dabe2c45' AND name_en IS NULL;  -- Фабиан Руис [canonical]
UPDATE cards SET name_en = 'Ezri Konsa Ngoyo' WHERE id = '136dccb9-52ca-428f-aeda-ee8e93989e93' AND name_en IS NULL;  -- Эзри Конса [canonical]
UPDATE cards SET name_en = 'Virgil van Dijk' WHERE id = '1378b1e8-c685-4893-bd80-e865f6b624cd' AND name_en IS NULL;  -- Вирджил Ван Дейк [canonical]
UPDATE cards SET name_en = 'Omar Khaled Mohamed Abd Elsala Marmoush' WHERE id = '13a15b92-755f-467e-aaa3-679ce4a2c017' AND name_en IS NULL;  -- Омар Мармуш [exact]
UPDATE cards SET name_en = 'Axel Tuanzebe' WHERE id = '1429226d-5db6-4d46-9a39-0372f4806268' AND name_en IS NULL;  -- Туанзебе, Аксель [exact]
UPDATE cards SET name_en = 'Marco Reus' WHERE id = '166b5fdb-d851-4f72-bd65-867f3a5c79d3' AND name_en IS NULL;  -- Марко Ройс [canonical]
UPDATE cards SET name_en = 'Dejan Lovren' WHERE id = '16a49c29-288f-4ef7-81e0-2bc930158484' AND name_en IS NULL;  -- Деян Ловрен [canonical]
UPDATE cards SET name_en = 'Remo Marco Freuler' WHERE id = '17199bb0-e46c-467d-a7f8-9856e17195e5' AND name_en IS NULL;  -- Ремо Фройлер [canonical]
UPDATE cards SET name_en = 'Jadon Malik Sancho' WHERE id = '177e360d-0b10-4a54-8056-aa82d661231a' AND name_en IS NULL;  -- Санчо, Джейдон [exact]
UPDATE cards SET name_en = 'Illia Zabarnyi' WHERE id = '1791d9ba-655d-426b-83ad-c660f1a578f0' AND name_en IS NULL;  -- Забарный, Илья Борисович [exact]
UPDATE cards SET name_en = 'Davide Frattesi' WHERE id = '17df6c7e-19cd-4038-ab86-120b0884cee5' AND name_en IS NULL;  -- Давиде Фраттези [canonical]
UPDATE cards SET name_en = 'Norberto Bercique Gomes Betuncal' WHERE id = '1837311c-9597-45f2-88ef-4a5d9f6edf1c' AND name_en IS NULL;  -- Гомеш Бетункал, Норберту Берсике [exact]
UPDATE cards SET name_en = 'Altay Bayındır' WHERE id = '18ee0a7d-68ce-4fee-8130-dad853670c35' AND name_en IS NULL;  -- Байындыр, Алтай [exact]
UPDATE cards SET name_en = 'Yangel Clemente Herrera Ravelo' WHERE id = '1967a8b5-31c8-4cef-940e-bc5f4a075827' AND name_en IS NULL;  -- Эррера, Янхель [exact]
UPDATE cards SET name_en = 'Declan Rice' WHERE id = '1aae64e7-48d9-4ae3-b55a-8cd2806e57f1' AND name_en IS NULL;  -- Райс, Деклан [exact]
UPDATE cards SET name_en = 'Timo Werner' WHERE id = '1b248bec-e53d-4230-b911-e74a1e28ba2d' AND name_en IS NULL;  -- Тимо Вернер [canonical]
UPDATE cards SET name_en = 'Yoane Wissa' WHERE id = '1b409473-f6c5-4b51-b560-dbabec79ba75' AND name_en IS NULL;  -- Йоан Висса [canonical]
UPDATE cards SET name_en = 'Tomáš Souček' WHERE id = '1b46ff11-3af3-48bd-8da2-1e9c4683edf2' AND name_en IS NULL;  -- Томаш Соучек [canonical]
UPDATE cards SET name_en = 'James Harrington Trafford' WHERE id = '1b55359e-62a4-45ed-9fe9-3854cd6e07ed' AND name_en IS NULL;  -- Траффорд, Джеймс [exact]
UPDATE cards SET name_en = 'Eric Bertrand Bailly' WHERE id = '1bc683b3-c4a9-42d8-a302-e98aaeec94ca' AND name_en IS NULL;  -- Байи, Эрик [exact]
UPDATE cards SET name_en = 'Çağlar Söyüncü' WHERE id = '1bfcebac-e128-4355-87f7-68af797aacdc' AND name_en IS NULL;  -- Сёюнджю, Чалар [exact]
UPDATE cards SET name_en = 'Allan Marques Loureiro' WHERE id = '1bffd942-ec4b-4911-b015-e32eee5b4033' AND name_en IS NULL;  -- Маркес Лоурейро, Аллан [exact]
UPDATE cards SET name_en = 'Maximilian William Kilman' WHERE id = '1c3216b5-ad91-45f3-aecb-c1c1f202ce2e' AND name_en IS NULL;  -- Килман, Макс [exact]
UPDATE cards SET name_en = 'Jefferson Andrés Lerma Solís' WHERE id = '1c764ba1-f873-4408-a0a1-dcf588b42ee9' AND name_en IS NULL;  -- Лерма, Джефферсон [exact]
UPDATE cards SET name_en = 'Solomon Benjamin March' WHERE id = '1cc36e53-10d8-42c5-889b-fc5c94ce02ce' AND name_en IS NULL;  -- Марч, Солли [exact]
UPDATE cards SET name_en = 'Lucas Digne' WHERE id = '1d01e06e-f301-48d0-b846-23a28710cb2b' AND name_en IS NULL;  -- Динь, Люка [exact]
UPDATE cards SET name_en = 'Issa Kaboré' WHERE id = '1d89d10c-33d6-4700-9be3-ca0ed423b1c5' AND name_en IS NULL;  -- Каборе, Исса [exact]
UPDATE cards SET name_en = 'Cheick Oumar Doucouré' WHERE id = '1da38e29-a0ef-4933-85d7-f5c28746f4eb' AND name_en IS NULL;  -- Дукуре, Шейк (футболист, 2000) [exact]
UPDATE cards SET name_en = 'Jordan Lee Pickford' WHERE id = '1dfd82e9-c9cd-4a88-93aa-63d37435b45b' AND name_en IS NULL;  -- Пикфорд, Джордан [exact]
UPDATE cards SET name_en = 'Anthony Lopes' WHERE id = '1e1e3da0-db90-4d92-811a-4026e470d151' AND name_en IS NULL;  -- Антони Лопеш [canonical]
UPDATE cards SET name_en = 'Valentino Francisco Livramento' WHERE id = '1e46b8c5-847e-4845-8174-9eda386953d9' AND name_en IS NULL;  -- Тино Ливраменто [canonical]
UPDATE cards SET name_en = 'Pelly Ruddock Mpanzu' WHERE id = '1e57f528-2989-48e8-a2cf-4e895617fee8' AND name_en IS NULL;  -- Руддок Мпанзу, Пелли [exact]
UPDATE cards SET name_en = 'Carlos Vinícius Alves Morais' WHERE id = '1e8c5d13-d56f-4e6e-bae4-f8e28e7708df' AND name_en IS NULL;  -- Карлос Винисиус [exact]
UPDATE cards SET name_en = 'Mark Flekken' WHERE id = '1eb0b55c-d5d7-49b1-adec-855b88c8f1fa' AND name_en IS NULL;  -- Флеккен, Марк [exact]
UPDATE cards SET name_en = 'Pierre-Emile Kordt Højbjerg' WHERE id = '1ec121c1-c46b-41d0-94f7-818d85d2de29' AND name_en IS NULL;  -- Хёйбьерг, Пьер-Эмиль [exact]
UPDATE cards SET name_en = 'Odsonne Édouard' WHERE id = '1edf493e-134e-4ddf-9f1a-1bfebfb1c888' AND name_en IS NULL;  -- Эдуар, Одсонн [exact]
UPDATE cards SET name_en = 'Anthony Jordan Martial' WHERE id = '1fe04a06-877d-4a99-ab53-ce3af5032af8' AND name_en IS NULL;  -- Антони Марсьяль [canonical]
UPDATE cards SET name_en = 'Mathis Rayan Cherki' WHERE id = '20083cc1-6c0d-4005-9cc0-5a12320afbc2' AND name_en IS NULL;  -- Райан Шерки [canonical]
UPDATE cards SET name_en = 'Robert Samuel Holding' WHERE id = '20163e36-8d74-4140-a250-20d081114c46' AND name_en IS NULL;  -- Холдинг, Роб [exact]
UPDATE cards SET name_en = 'Theo James Walcott' WHERE id = '20e53d36-38fb-4ea4-88c2-88742801248c' AND name_en IS NULL;  -- Тео Уолкотт [canonical]
UPDATE cards SET name_en = 'Bernd Leno' WHERE id = '214d199c-cdd0-41fe-9b28-951e6e800967' AND name_en IS NULL;  -- Бернд Лено [canonical]
UPDATE cards SET name_en = 'Andrea Cambiaso' WHERE id = '21e18f62-512c-43fc-8a34-203864965036' AND name_en IS NULL;  -- Андреа Камбьязо [canonical]
UPDATE cards SET name_en = 'Kevin Danso' WHERE id = '22a729df-3b2b-4cd5-b006-33833f1b692c' AND name_en IS NULL;  -- Дансо, Кевин [exact]
UPDATE cards SET name_en = 'Eberechi Oluchi Eze' WHERE id = '232f542b-d145-4042-874a-c10a02b731bd' AND name_en IS NULL;  -- Эберечи Эзе [canonical]
UPDATE cards SET name_en = 'Rodrigo Moreno Machado' WHERE id = '2413e089-bfef-4826-ac75-a2cb7ae7c2ca' AND name_en IS NULL;  -- Морено Машадо, Родриго [exact]
UPDATE cards SET name_en = 'Lorenzo Pellegrini' WHERE id = '24865e25-1ab8-4523-975d-8340cc538258' AND name_en IS NULL;  -- Лоренцо Пеллегрини [canonical]
UPDATE cards SET name_en = 'Guglielmo Vicario' WHERE id = '251b3ae9-724e-4574-9638-c8f446fa8a35' AND name_en IS NULL;  -- Викарио, Гульельмо [exact]
UPDATE cards SET name_en = 'James Philip Milner' WHERE id = '2536ea7d-022d-4ce8-a106-ae65d0fd76af' AND name_en IS NULL;  -- Милнер, Джеймс [exact]
UPDATE cards SET name_en = 'Gabriel Paweł Słonina' WHERE id = '25438776-9043-4e07-a772-18d18b7dedc6' AND name_en IS NULL;  -- Слонина, Гейбриел [exact]
UPDATE cards SET name_en = 'Jarrod Bowen' WHERE id = '254ff3eb-94cb-4f00-bdf0-6bc5c3c6100a' AND name_en IS NULL;  -- Джаррод Боуэн [canonical]
UPDATE cards SET name_en = 'Thomas David Heaton' WHERE id = '2550d2db-4339-4075-87b5-3a11634644f4' AND name_en IS NULL;  -- Хитон, Том [exact]
UPDATE cards SET name_en = 'Thiago Emiliano da Silva' WHERE id = '26120fdd-645d-41e8-8a1d-3a75f14b0b4d' AND name_en IS NULL;  -- Силва, Тиагу (бразильский футболист) [exact]
UPDATE cards SET name_en = 'João Pedro Junqueira de Jesus' WHERE id = '264352b7-0f55-4cef-ad68-f735ed3df810' AND name_en IS NULL;  -- Жуан Педро (футболист, 2001) [exact]
UPDATE cards SET name_en = 'Mike Peterson Maignan' WHERE id = '26ab884f-15e6-4860-8e64-353019dd30ee' AND name_en IS NULL;  -- Майк Меньян [canonical]
UPDATE cards SET name_en = 'Juan Guillermo Cuadrado Bello' WHERE id = '26add200-ae1c-492f-b58e-46a4e594aae7' AND name_en IS NULL;  -- Хуан Куадрадо [canonical]
UPDATE cards SET name_en = 'Layvin Marc Kurzawa' WHERE id = '26e7f985-3b1a-472b-9019-758f92485fd4' AND name_en IS NULL;  -- Кюрзава, Левен [exact]
UPDATE cards SET name_en = 'Facundo Valentín Buonanotte' WHERE id = '27049d18-23d9-46d2-ab31-22fb1ed864fe' AND name_en IS NULL;  -- Буонанотте, Факундо [exact]
UPDATE cards SET name_en = 'Alexis Mac Allister' WHERE id = '27582d41-48a3-4bb1-8019-e451ba2bd869' AND name_en IS NULL;  -- Макаллистер, Алексис [exact]
UPDATE cards SET name_en = 'Nicholas David Pope' WHERE id = '277aa7a7-4c9a-45b9-a4a1-f6711bf3084e' AND name_en IS NULL;  -- Поуп, Ник [exact]
UPDATE cards SET name_en = 'Jordan Brian Henderson' WHERE id = '2783901d-9f9a-42f3-9ce7-86fde5ee2525' AND name_en IS NULL;  -- Хендерсон, Джордан [exact]
UPDATE cards SET name_en = 'Alexander Chuka Iwobi' WHERE id = '2791bab6-1b0a-487b-b2b6-23c94e1f1ef9' AND name_en IS NULL;  -- Ивоби, Алекс [exact]
UPDATE cards SET name_en = 'Douglas Luiz Soares de Paulo' WHERE id = '27a5d56e-c85a-40be-8173-05946fe09417' AND name_en IS NULL;  -- Дуглас Луис [exact]
UPDATE cards SET name_en = 'Jefferson Andrés Lerma Solís' WHERE id = '27b44736-f9ff-4a91-b7e6-fb3ea57ce6ad' AND name_en IS NULL;  -- Джефферсон Лерма [canonical]
UPDATE cards SET name_en = 'Pedro Lomba Neto' WHERE id = '27d7df0e-e5d5-4414-82f9-e93254eaee9d' AND name_en IS NULL;  -- Педру Нету [canonical]
UPDATE cards SET name_en = 'Temitayo Olufisayo Olaoluwa Aina' WHERE id = '28356993-1df8-49c1-a476-998fb3ecdc60' AND name_en IS NULL;  -- Ола Айна [canonical]
UPDATE cards SET name_en = 'Thomas Kaminski' WHERE id = '2889cea6-16fe-487a-ac95-a0b19936b65f' AND name_en IS NULL;  -- Камински, Томас [exact]
UPDATE cards SET name_en = 'Jean-Philippe Mateta' WHERE id = '29aa0f7e-2acd-4978-b946-82565429d66b' AND name_en IS NULL;  -- Матета, Жан-Филипп [exact]
UPDATE cards SET name_en = 'Trevoh Thomas Chalobah' WHERE id = '29d4054b-dd42-429f-a2fc-3aaf664c99d3' AND name_en IS NULL;  -- Чалоба, Трево [exact]
UPDATE cards SET name_en = 'Théo Bernard François Hernández' WHERE id = '2af9f4c3-3a6c-4239-b459-2cb316560d83' AND name_en IS NULL;  -- Тео Эрнандес [canonical]
UPDATE cards SET name_en = 'Dominic Nathaniel Calvert-Lewin' WHERE id = '2b3410f3-f6bc-4d99-8f2a-20ddd0bb10ee' AND name_en IS NULL;  -- Калверт-Льюин, Доминик [exact]
UPDATE cards SET name_en = 'Kaoru Mitoma' WHERE id = '2b42ffdb-b514-4794-acfd-5380219066e1' AND name_en IS NULL;  -- Каору Митома [canonical]
UPDATE cards SET name_en = 'Ayoze Pérez Gutiérrez' WHERE id = '2b7b7def-9ac7-4cb1-8820-b8f5d9685dca' AND name_en IS NULL;  -- Перес, Айосе [exact]
UPDATE cards SET name_en = 'César Azpilicueta Tanco' WHERE id = '2b9325da-5181-450e-b568-a63784bb947e' AND name_en IS NULL;  -- Сесар Аспиликуэта [canonical]
UPDATE cards SET name_en = 'Kai Lukas Havertz' WHERE id = '2c844f0e-09b4-45c0-ae53-db3f81659fcc' AND name_en IS NULL;  -- Хаверц, Кай [exact]
UPDATE cards SET name_en = 'Sander Gard Bolin Berge' WHERE id = '2cdb3835-1db7-42b1-8412-69ebd6f36e3e' AND name_en IS NULL;  -- Берге, Сандер [exact]
UPDATE cards SET name_en = 'Takumi Minamino' WHERE id = '2cdb916d-204b-4ea4-b7d0-88f38b19d4b0' AND name_en IS NULL;  -- Минамино, Такуми [exact]
UPDATE cards SET name_en = 'Chukwunonso Tristan Madueke' WHERE id = '2d89ab09-449a-4ea8-8fd7-d7133a3ae90d' AND name_en IS NULL;  -- Нони Мадуэке [canonical]
UPDATE cards SET name_en = 'Benjamin Šeško' WHERE id = '2ddfc834-a882-47e5-9747-422d435fec68' AND name_en IS NULL;  -- Беньямин Шешко [canonical]
UPDATE cards SET name_en = 'Abdessamad Ezzalzouli' WHERE id = '2e0e3889-ab92-4e76-953b-a2973b8192da' AND name_en IS NULL;  -- Абде Эззалзули [canonical]
UPDATE cards SET name_en = 'Victor Jörgen Nilsson Lindelöf' WHERE id = '2e62bb8c-26c0-469f-8e9b-bbfe19b6c53c' AND name_en IS NULL;  -- Виктор Линделёф [canonical]
UPDATE cards SET name_en = 'Alfie Gilchrist' WHERE id = '2e66a491-f99b-424e-aac2-88e69b545fc6' AND name_en IS NULL;  -- Гилкрист, Алфи [exact]
UPDATE cards SET name_en = 'Ryan Jiro Gravenberch' WHERE id = '2ee560b9-7482-4ff6-b07c-e4eeb7ee317e' AND name_en IS NULL;  -- Гравенберх, Райан [exact]
UPDATE cards SET name_en = 'Manuel Lanzini' WHERE id = '2ef28f16-d01a-4d59-9df1-947621c45822' AND name_en IS NULL;  -- Лансини, Мануэль [exact]
UPDATE cards SET name_en = 'Callum James Hudson-Odoi' WHERE id = '2f614420-611f-4bdc-89aa-c186052dcdf5' AND name_en IS NULL;  -- Хадсон-Одои, Каллум [exact]
UPDATE cards SET name_en = 'Pedro González López' WHERE id = '2f62e993-79a2-40ce-a03c-5522dce529b8' AND name_en IS NULL;  -- Педри [exact]
UPDATE cards SET name_en = 'Kieran John Trippier' WHERE id = '2f6a1881-24a9-4a3f-b66e-471e68d408e7' AND name_en IS NULL;  -- Триппьер, Киран [exact]
UPDATE cards SET name_en = 'Moussa Diaby' WHERE id = '2fa1d71a-93c1-4f01-ae0e-907d21e75341' AND name_en IS NULL;  -- Диаби, Мусса [exact]
UPDATE cards SET name_en = 'Francis Joseph Coquelin' WHERE id = '2fb334d8-5a13-4d42-a428-ef865d169f29' AND name_en IS NULL;  -- Франсис Коклен [canonical]
UPDATE cards SET name_en = 'Rayan Aït-Nouri' WHERE id = '3069d268-4dde-43d8-bbb6-291ee3c9ad3f' AND name_en IS NULL;  -- Райан Аит-Нури [canonical]
UPDATE cards SET name_en = 'Eberechi Oluchi Eze' WHERE id = '3099ad22-0d53-4fca-9272-d5dbba723360' AND name_en IS NULL;  -- Эзе, Эберечи [exact]
UPDATE cards SET name_en = 'Ché Zach Everton Fred Adams' WHERE id = '30d5fb0a-e0bd-4fa0-b56d-ef285c4ba7c3' AND name_en IS NULL;  -- Че Адамс [canonical]
UPDATE cards SET name_en = 'Mahmoud Dahoud' WHERE id = '319ae702-fdb4-4997-a38a-5375b7902b48' AND name_en IS NULL;  -- Дауд, Махмуд [exact]
UPDATE cards SET name_en = 'Mauro Emanuel Icardi Rivero' WHERE id = '31b06756-2ff1-4883-b968-6d9f2b418cea' AND name_en IS NULL;  -- Мауро Икарди [canonical]
UPDATE cards SET name_en = 'Sardar Azmoun' WHERE id = '31d34d32-1d95-4fcb-812f-a10ec650e1e7' AND name_en IS NULL;  -- Сердар Азмун [canonical]
UPDATE cards SET name_en = 'Emil Peter Forsberg' WHERE id = '3225fdc2-ab0b-40f8-b83e-0f9678357a57' AND name_en IS NULL;  -- Эмиль Форсберг [canonical]
UPDATE cards SET name_en = 'Paulo Exequiel Dybala' WHERE id = '3228c430-31a0-4483-a223-a566911d95c0' AND name_en IS NULL;  -- Пауло Дибала [canonical]
UPDATE cards SET name_en = 'Taylor Jay Harwood-Bellis' WHERE id = '3308e366-716f-46b9-8adc-44d1173f44b9' AND name_en IS NULL;  -- Тейлор Харвуд-Беллис [canonical]
UPDATE cards SET name_en = 'Cenk Tosun' WHERE id = '33c092af-7f8f-4d73-af50-ec2cd1d9f3a6' AND name_en IS NULL;  -- Тосун, Дженк [exact]
UPDATE cards SET name_en = 'Keylor Antonio Navas Gamboa' WHERE id = '3404d976-4ce9-473f-9656-14de4d5c8ac7' AND name_en IS NULL;  -- Кейлор Навас [canonical]
UPDATE cards SET name_en = 'Christian Mate Pulišić' WHERE id = '34244710-ff0f-43fc-ae80-8e5a96130797' AND name_en IS NULL;  -- Пулишич, Кристиан [exact]
UPDATE cards SET name_en = 'Jamie Richard Vardy' WHERE id = '3439c4b5-b2b0-49e8-b38d-96ee81c8f8ee' AND name_en IS NULL;  -- Джейми Варди [canonical]
UPDATE cards SET name_en = 'Pervis Josué Estupiñán Tenorio' WHERE id = '34e9598c-b887-4599-a142-57ebd6e9fa91' AND name_en IS NULL;  -- Эступиньян, Первис [exact]
UPDATE cards SET name_en = 'Mark Flekken' WHERE id = '34ea218b-7bce-491f-8d90-ed203e26dcba' AND name_en IS NULL;  -- Марк Флеккен [canonical]
UPDATE cards SET name_en = 'Sofyan Amrabat' WHERE id = '352bba9a-4e58-4088-8361-749e52ea2d57' AND name_en IS NULL;  -- Софьян Амрабат [canonical]
UPDATE cards SET name_en = 'Riccardo Calafiori' WHERE id = '35b0fc98-af08-4b7a-a0c2-e4bf5cc96c26' AND name_en IS NULL;  -- Калафьори, Риккардо [exact]
UPDATE cards SET name_en = 'Presnel Kimpembe' WHERE id = '35eb3bc0-ac75-4f08-a812-f85d24686190' AND name_en IS NULL;  -- Преснель Кимпембе [canonical]
UPDATE cards SET name_en = 'Mohammed Salisu Abdul Karim' WHERE id = '35f69818-ea16-45cd-941e-1a9941029e4d' AND name_en IS NULL;  -- Салису, Мохаммед [exact]
UPDATE cards SET name_en = 'Oliver William Skipp' WHERE id = '361317a0-5438-45ed-8a50-22320f87c147' AND name_en IS NULL;  -- Скипп, Оливер [exact]
UPDATE cards SET name_en = 'Malang Mamadou William Georges Sarr' WHERE id = '364ca3b0-1bf7-41b0-a587-702f359e18ba' AND name_en IS NULL;  -- Сарр, Маланг [exact]
UPDATE cards SET name_en = 'Alexis Alejandro Sánchez Sánchez' WHERE id = '36d0d815-0a1c-4cd3-8687-02797200f72f' AND name_en IS NULL;  -- Алексис Санчес [canonical]
UPDATE cards SET name_en = 'Kevin Kampl' WHERE id = '36e0cc69-bbc4-426b-a17f-c5e3dfe106fe' AND name_en IS NULL;  -- Кевин Кампль [canonical]
UPDATE cards SET name_en = 'Edinson Roberto Cavani Gómez' WHERE id = '36f7e0b3-b286-433a-9451-ca4d3b789c1b' AND name_en IS NULL;  -- Эдинсон Кавани [canonical]
UPDATE cards SET name_en = 'Lisandro Martínez' WHERE id = '37870b60-1a76-4bb9-90be-4b070e63c1cd' AND name_en IS NULL;  -- Мартинес, Лисандро [exact]
UPDATE cards SET name_en = 'Robin Aime Robert Le Normand' WHERE id = '3791e3c1-8680-4bb7-91ab-8ea1154771a7' AND name_en IS NULL;  -- Робен Ле Норман [canonical]
UPDATE cards SET name_en = 'Péter Gulácsi' WHERE id = '37e834ea-ab74-4037-a7ba-92960b9bdbf9' AND name_en IS NULL;  -- Петер Гулачи [canonical]
UPDATE cards SET name_en = 'Youssouf Fofana' WHERE id = '3806c93a-270c-4d0b-b697-d328526f8829' AND name_en IS NULL;  -- Юссуф Фофана [canonical]
UPDATE cards SET name_en = 'Bruno Guimarães Rodriguez Moura' WHERE id = '38c42d56-b78a-40c7-9417-e9815469f40f' AND name_en IS NULL;  -- Гимарайнс, Бруно [exact]
UPDATE cards SET name_en = 'Brennan Price Johnson' WHERE id = '38cddcb4-32f5-4f85-9e2e-d0e4cb076afc' AND name_en IS NULL;  -- Джонсон, Бреннан [exact]
UPDATE cards SET name_en = 'Niclas Füllkrug' WHERE id = '39120c56-9810-467b-85a8-e8d31063a3e7' AND name_en IS NULL;  -- Фюллькруг, Никлас [exact]
UPDATE cards SET name_en = 'Aaron Wan-Bissaka' WHERE id = '39b89fcf-1f7f-45a9-8815-77652abd8d98' AND name_en IS NULL;  -- Уан-Биссака, Эрон [exact]
UPDATE cards SET name_en = 'Alejo Véliz' WHERE id = '39bbcaf3-ed30-49b9-b490-f267db3b27fa' AND name_en IS NULL;  -- Велис, Алехо (футболист) [exact]
UPDATE cards SET name_en = 'John McGinn' WHERE id = '3a6a4818-f5ab-4798-aea1-f3597a9dc005' AND name_en IS NULL;  -- Джон Макгинн [canonical]
UPDATE cards SET name_en = 'Ivan Perišić' WHERE id = '3b5f9338-67cd-4401-854e-708b551a11c1' AND name_en IS NULL;  -- Иван Перишич [canonical]
UPDATE cards SET name_en = 'Virgil van Dijk' WHERE id = '3b6990fb-9bce-4f5e-b78d-53ec0f3f7c87' AND name_en IS NULL;  -- Ван Дейк, Вирджил [exact]
UPDATE cards SET name_en = 'Axel Wilson Arthur Disasi Mhakinis Belho' WHERE id = '3bc031b2-703c-40fc-8191-68de15fee8af' AND name_en IS NULL;  -- Дисаси, Аксель [exact]
UPDATE cards SET name_en = 'Arijanet Murić' WHERE id = '3c08813f-9ca1-45ed-9359-9fc01d986d3a' AND name_en IS NULL;  -- Мурич, Ариянет [exact]
UPDATE cards SET name_en = 'Pedro Antonio Porro Sauceda' WHERE id = '3c0b67a3-4bc6-47c8-acc8-3ff882fa7c35' AND name_en IS NULL;  -- Педро Порро [canonical]
UPDATE cards SET name_en = 'Gerard Moreno Balagueró' WHERE id = '3c4b3d43-063a-4218-91b7-1e3ba6bf65c0' AND name_en IS NULL;  -- Жерар Морено [canonical]
UPDATE cards SET name_en = 'Anthony Michael Gordon' WHERE id = '3c572dda-48d1-4fca-8276-e3d5e620a7f6' AND name_en IS NULL;  -- Энтони Гордон [canonical]
UPDATE cards SET name_en = 'Reiss Luke Nelson' WHERE id = '3c87779b-952a-47e9-bce0-920810b9aaf8' AND name_en IS NULL;  -- Нельсон, Рис [exact]
UPDATE cards SET name_en = 'Mohamed Naser Elsayed Elneny' WHERE id = '3ca78932-5af5-4412-bb19-d91ed410de51' AND name_en IS NULL;  -- Мохаммед эль-Ненни [exact]
UPDATE cards SET name_en = 'Rodrigo Hernández Cascante' WHERE id = '3cd0a996-483d-442a-88db-6a3efed61dac' AND name_en IS NULL;  -- Эрнандес, Родриго [exact]
UPDATE cards SET name_en = 'Davinson Sánchez Mina' WHERE id = '3ce03625-5a0a-47ff-a1dd-150f418962d8' AND name_en IS NULL;  -- Санчес, Давинсон [exact]
UPDATE cards SET name_en = 'Alexander Isak' WHERE id = '3da33c41-b242-4986-a76f-b2c6eccc98a9' AND name_en IS NULL;  -- Александер Исак [canonical]
UPDATE cards SET name_en = 'Leander Dendoncker' WHERE id = '3e6ead2c-fc5d-4ca9-9f0d-00477ca70ba5' AND name_en IS NULL;  -- Дендонкер, Леандер [exact]
UPDATE cards SET name_en = 'Youssef En-Nesyri' WHERE id = '3e8e4ed9-131d-4494-8c16-70188df7071f' AND name_en IS NULL;  -- Юссеф Эн-Несири [canonical]
UPDATE cards SET name_en = 'Heung-Min Son' WHERE id = '3ebb07bf-a570-4ebc-86a3-05cbdc84dae9' AND name_en IS NULL;  -- Сон Хын Мин [exact]
UPDATE cards SET name_en = 'Bernd Leno' WHERE id = '3f1d8097-b540-4681-8a45-feacd57b3cc1' AND name_en IS NULL;  -- Лено, Бернд [exact]
UPDATE cards SET name_en = 'Oleksandr Zinchenko' WHERE id = '3f31f017-5105-4833-9cca-e5f26a718b48' AND name_en IS NULL;  -- Зинченко, Александр Владимирович [exact]
UPDATE cards SET name_en = 'Armando Broja' WHERE id = '3f58ac52-db1e-4ebd-acc7-29fd69c8cd1c' AND name_en IS NULL;  -- Броя, Армандо [exact]
UPDATE cards SET name_en = 'Antonee Robinson' WHERE id = '3f590ae0-1513-42da-82d9-a80d39f25e97' AND name_en IS NULL;  -- Робинсон, Энтони (футболист) [exact]
UPDATE cards SET name_en = 'Ross Barkley' WHERE id = '3ff77a47-7373-4104-a0c2-1a1bd11628c5' AND name_en IS NULL;  -- Баркли, Росс [exact]
UPDATE cards SET name_en = 'Raphaël Xavier Varane' WHERE id = '402a3eae-9237-46d9-899e-a593a270ee65' AND name_en IS NULL;  -- Варан, Рафаэль [exact]
UPDATE cards SET name_en = 'Julián Álvarez' WHERE id = '409732e9-f933-46eb-8205-540b587732b4' AND name_en IS NULL;  -- Хулиан Альварес [canonical]
UPDATE cards SET name_en = 'Valentín Barco' WHERE id = '40aa42ac-f9d8-4f98-89a1-583cd8cc9db6' AND name_en IS NULL;  -- Барко, Валентин [exact]
UPDATE cards SET name_en = 'Ibrahima Konaté' WHERE id = '40afa9bc-9c8e-4b29-99bf-7e214ec3bd57' AND name_en IS NULL;  -- Конате, Ибраима [exact]
UPDATE cards SET name_en = 'Simon Adingra' WHERE id = '40daf0a1-8435-489d-984e-a8b107ee570f' AND name_en IS NULL;  -- Адингра, Симон [exact]
UPDATE cards SET name_en = 'Eric Jeremy Edgar Dier' WHERE id = '417137d3-39ef-4694-b590-6f26ef7f09d2' AND name_en IS NULL;  -- Эрик Дайер [canonical]
UPDATE cards SET name_en = 'Francesco Acerbi' WHERE id = '41d3bc59-d5b6-4807-baf7-73a48c2ed659' AND name_en IS NULL;  -- Франческо Ачерби [canonical]
UPDATE cards SET name_en = 'Javier Manquillo Gaitán' WHERE id = '41f660ac-eec5-472c-a5bc-08ef73ca9213' AND name_en IS NULL;  -- Манкильо, Хавьер [exact]
UPDATE cards SET name_en = 'Justin Dean Kluivert' WHERE id = '41f86948-56bd-4712-8bc9-cf234456175a' AND name_en IS NULL;  -- Клюйверт, Джастин [exact]
UPDATE cards SET name_en = 'André Miguel Valente da Silva' WHERE id = '42026845-8ad7-4570-8547-e586def2a5f0' AND name_en IS NULL;  -- Андре Силва [canonical]
UPDATE cards SET name_en = 'Julian Draxler' WHERE id = '42cf100a-c39e-40a9-909b-d432f0aaeb82' AND name_en IS NULL;  -- Юлиан Дракслер [canonical]
UPDATE cards SET name_en = 'Pascal Groß' WHERE id = '42f2a492-4464-4aeb-a46a-a6735c3a2438' AND name_en IS NULL;  -- Грос, Паскаль [exact]
UPDATE cards SET name_en = 'Brennan Price Johnson' WHERE id = '431253c2-9e7a-4e30-aa06-d7a6c1a95494' AND name_en IS NULL;  -- Бреннан Джонсон [canonical]
UPDATE cards SET name_en = 'Ryan Dominic Bertrand' WHERE id = '433a262e-ba6c-46c1-825d-2595a52a0b5e' AND name_en IS NULL;  -- Бертранд, Райан [exact]
UPDATE cards SET name_en = 'Bernardo Mota Veiga de Carvalho e Silva' WHERE id = '43b48938-1b10-4657-bb81-1feaff7ab46f' AND name_en IS NULL;  -- Силва, Бернарду [exact]
UPDATE cards SET name_en = 'Mario René Junior Lemina' WHERE id = '43e1405a-3256-486f-9790-f7c201ea7b7f' AND name_en IS NULL;  -- Лемина, Марио [exact]
UPDATE cards SET name_en = 'Calvin Bassey Ughelumba' WHERE id = '441679d5-1b08-4dab-9690-92895202769c' AND name_en IS NULL;  -- Бэсси, Калвин [exact]
UPDATE cards SET name_en = 'Romelu Menama Lukaku Bolingoli' WHERE id = '444afcd2-79e5-4e2f-a11a-ca25527a5a2d' AND name_en IS NULL;  -- Ромелу Лукаку [canonical]
UPDATE cards SET name_en = 'Bruno Miguel Borges Fernandes' WHERE id = '445378a8-8beb-4e84-8c05-ba0de7559d29' AND name_en IS NULL;  -- Фернандеш, Бруну [exact]
UPDATE cards SET name_en = 'Joseph Adrian Worrall' WHERE id = '44efbc72-8a86-439b-827a-c3c5a0629a2f' AND name_en IS NULL;  -- Уорралл, Джо [exact]
UPDATE cards SET name_en = 'Ivan Rakitić' WHERE id = '45e2f41b-bdda-4224-8939-a25a7596734e' AND name_en IS NULL;  -- Иван Ракитич [canonical]
UPDATE cards SET name_en = 'Demarai Ramelle Gray' WHERE id = '46744d4c-98ff-436b-ba19-8307bd820ed3' AND name_en IS NULL;  -- Грей, Демарай [exact]
UPDATE cards SET name_en = 'Hee-Chan Hwang' WHERE id = '468da9da-0162-49aa-9a49-5dd947d866f9' AND name_en IS NULL;  -- Хван Хи Чхан [exact]
UPDATE cards SET name_en = 'Jesse Ellis Lingard' WHERE id = '47247489-2570-4d2e-8433-4ea6531e8711' AND name_en IS NULL;  -- Лингард, Джесси [exact]
UPDATE cards SET name_en = 'André Morgan Rami Ayew' WHERE id = '473ffb56-a614-4756-96d1-a70d3756bb1c' AND name_en IS NULL;  -- Андре Айю [canonical]
UPDATE cards SET name_en = 'Vilmos Tamás Orbán' WHERE id = '48824346-544d-4567-92de-4958b021f046' AND name_en IS NULL;  -- Вилли Орбан [canonical]
UPDATE cards SET name_en = 'Sepp van den Berg' WHERE id = '4a1ed8c8-8615-4d9f-b38d-d7dffaf97d79' AND name_en IS NULL;  -- Ван ден Берг, Сепп [exact]
UPDATE cards SET name_en = 'James Alan Tarkowski' WHERE id = '4a820e08-5601-4c47-8daa-1a51da1903eb' AND name_en IS NULL;  -- Тарковски, Джеймс [exact]
UPDATE cards SET name_en = 'Renan Augusto Lodi dos Santos' WHERE id = '4a87a7a3-3134-4157-bff6-e3ae6b008c23' AND name_en IS NULL;  -- Лоди, Ренан [exact]
UPDATE cards SET name_en = 'Kelechi Promise Ịheanachọ' WHERE id = '4aa7957b-6d94-44cc-868e-bfc34b1efc87' AND name_en IS NULL;  -- Ихеаначо, Келечи [exact]
UPDATE cards SET name_en = 'Cédric Ricardo Alves Soares' WHERE id = '4ad7a1be-dc8c-40e1-84ed-62faa9dd1d2a' AND name_en IS NULL;  -- Суареш, Седрик [exact]
UPDATE cards SET name_en = 'Harvey Lewis Barnes' WHERE id = '4b05e96f-33d2-4890-a4e3-9ce2c057ab69' AND name_en IS NULL;  -- Барнс, Харви [exact]
UPDATE cards SET name_en = 'Orel Johnson Mangala' WHERE id = '4b46a226-5927-40be-a686-d8552bb66e68' AND name_en IS NULL;  -- Мангаля, Орель [exact]
UPDATE cards SET name_en = 'Thomas Teye Partey' WHERE id = '4b7f529a-b325-4b49-9d35-9e6c087d004b' AND name_en IS NULL;  -- Парти, Томас [exact]
UPDATE cards SET name_en = 'Mohammed Kudus' WHERE id = '4c22b5b5-b07b-415c-af74-aa4792d1ad8f' AND name_en IS NULL;  -- Кудус, Мохаммед [exact]
UPDATE cards SET name_en = 'Timothy Michael Krul' WHERE id = '4c8eae84-60cf-4c27-8ccd-b3d7161f9218' AND name_en IS NULL;  -- Крул, Тим [exact]
UPDATE cards SET name_en = 'Philippe Coutinho Correia' WHERE id = '4cf577d1-50f7-40ea-ad2f-7e1373151a7c' AND name_en IS NULL;  -- Коутиньо, Филипе [exact]
UPDATE cards SET name_en = 'Nathaniel Edwin Clyne' WHERE id = '4d0ed2cd-be36-4600-93db-90f4489a8cd3' AND name_en IS NULL;  -- Клайн, Натаниэл [exact]
UPDATE cards SET name_en = 'Stefan de Vrij' WHERE id = '4d775160-ed9b-4b7e-809d-419e7787b5da' AND name_en IS NULL;  -- Стефан Де Врей [canonical]
UPDATE cards SET name_en = 'Radu Matei Drăgușin' WHERE id = '4d9d344b-c53c-4c5f-ae41-ad85dccc249e' AND name_en IS NULL;  -- Дрэгушин, Раду [exact]
UPDATE cards SET name_en = 'Ché Zach Everton Fred Adams' WHERE id = '4d9f34d0-d8de-4842-85e5-b68b85fba0ee' AND name_en IS NULL;  -- Адамс, Че [exact]
UPDATE cards SET name_en = 'Michael Akpovie Olise' WHERE id = '4da47502-b2f2-4f7b-b6e3-12ac70ea0a88' AND name_en IS NULL;  -- Майкл Олисе [canonical]
UPDATE cards SET name_en = 'David de Gea Quintana' WHERE id = '4e25300f-9c87-49f7-962e-653d9d025e00' AND name_en IS NULL;  -- Де Хеа, Давид [exact]
UPDATE cards SET name_en = 'Chiedozie Ogbene' WHERE id = '4e2b3210-155c-4408-ae52-d7923b69a1b1' AND name_en IS NULL;  -- Огбене, Чидози [exact]
UPDATE cards SET name_en = 'Enzo Jeremías Fernández' WHERE id = '4e92520f-77bf-4ff2-98ee-2b7804ba715e' AND name_en IS NULL;  -- Фернандес, Энцо [exact]
UPDATE cards SET name_en = 'Anthony Michael Gordon' WHERE id = '4e9d4256-3f1e-4096-a367-31a4b7cc4896' AND name_en IS NULL;  -- Гордон, Энтони [exact]
UPDATE cards SET name_en = 'Michail Gregory Antonio' WHERE id = '4f3cfb20-b233-4460-b307-bd9e02d3c59f' AND name_en IS NULL;  -- Антонио, Майкл [exact]
UPDATE cards SET name_en = 'Kang-In Lee' WHERE id = '4f592b35-a9da-4c9e-a20f-ba967a42724e' AND name_en IS NULL;  -- Ли Кан Ин [exact]
UPDATE cards SET name_en = 'Niels Patrick Nkounkou' WHERE id = '4fdd6f61-98f5-43c3-8535-3db9c5589114' AND name_en IS NULL;  -- Нкунку, Нильс [exact]
UPDATE cards SET name_en = 'Calum Chambers' WHERE id = '4fe2eb6b-4dbc-438b-9310-2c63002702f9' AND name_en IS NULL;  -- Чеймберс, Калум [exact]
UPDATE cards SET name_en = 'Wayne Robert Hennessey' WHERE id = '50d4d582-b888-4c7a-a10c-de9c4ca68b8f' AND name_en IS NULL;  -- Хеннесси, Уэйн [exact]
UPDATE cards SET name_en = 'Ivan Perišić' WHERE id = '5172878e-86da-4b12-9680-a012467a4b72' AND name_en IS NULL;  -- Перишич, Иван [exact]
UPDATE cards SET name_en = 'Matz Willy Els Sels' WHERE id = '51b7f850-d959-41f1-9791-88013206a66a' AND name_en IS NULL;  -- Селс, Матц [exact]
UPDATE cards SET name_en = 'Diogo José Teixeira da Silva' WHERE id = '51db4707-8e76-4b09-83a1-75a44fc13969' AND name_en IS NULL;  -- Диогу Жота [exact]
UPDATE cards SET name_en = 'Joachim Christian Andersen' WHERE id = '51e24ee0-8d54-4445-95bf-453a2b5e9a92' AND name_en IS NULL;  -- Андерсен, Йоаким [exact]
UPDATE cards SET name_en = 'Benjamin Thomas Mee' WHERE id = '51edfa5c-db5e-40d6-9822-ec3b0c38f033' AND name_en IS NULL;  -- Ми, Бен [exact]
UPDATE cards SET name_en = 'Robin Everardus Gosens' WHERE id = '528bcd4f-2536-4fd7-b8e4-aaeec835c3f0' AND name_en IS NULL;  -- Робин Госенс [canonical]
UPDATE cards SET name_en = 'Levi Lemar Samuels Colwill' WHERE id = '528cbf34-c0ab-4c07-b284-576d44f86c3a' AND name_en IS NULL;  -- Колуилл, Леви [exact]
UPDATE cards SET name_en = 'Donny van de Beek' WHERE id = '52f964eb-0c8f-4960-8468-d04ab92f44f4' AND name_en IS NULL;  -- Ван де Бек, Донни [exact]
UPDATE cards SET name_en = 'Albert-Mboyo Sambi Lokonga' WHERE id = '5343c030-8227-47e7-ba8f-b57d632bb5a5' AND name_en IS NULL;  -- Самби Локонга, Альбер [exact]
UPDATE cards SET name_en = 'Raúl García Escudero' WHERE id = '53da7e8a-90d8-4664-a651-6954477a8de1' AND name_en IS NULL;  -- Рауль Гарсия [canonical]
UPDATE cards SET name_en = 'Jordan Lee Pickford' WHERE id = '5402844d-8fe4-405f-8187-2a57c851354d' AND name_en IS NULL;  -- Джордан Пикфорд [canonical]
UPDATE cards SET name_en = 'Jonjo Shelvey' WHERE id = '541617f4-c014-4133-92d9-8ea3d4df3244' AND name_en IS NULL;  -- Шелви, Джонджо [exact]
UPDATE cards SET name_en = 'Konstantinos Mavropanos' WHERE id = '54b32751-b6fb-4d3c-999b-c27aebf71160' AND name_en IS NULL;  -- Мавропанос, Константинос [exact]
UPDATE cards SET name_en = 'Kai Lukas Havertz' WHERE id = '54c3782e-8168-41bb-81c9-1de51e717958' AND name_en IS NULL;  -- Кай Хаверц [canonical]
UPDATE cards SET name_en = 'Joseph George Willock' WHERE id = '54fde542-8c55-4fe9-851b-312d017ff0d8' AND name_en IS NULL;  -- Джо Уиллок [canonical]
UPDATE cards SET name_en = 'Dušan Vlahović' WHERE id = '5509aedb-b031-4697-8dfd-e876968fc2aa' AND name_en IS NULL;  -- Душан Влахович [canonical]
UPDATE cards SET name_en = 'Piero Martín Hincapié Reyna' WHERE id = '564a299b-2e49-44e3-8ffd-d5e0e90acef1' AND name_en IS NULL;  -- Пьеро Инкапье [canonical]
UPDATE cards SET name_en = 'Jacob Matthew Ramsey' WHERE id = '566125a4-3669-4dc8-8b36-0358efd950e7' AND name_en IS NULL;  -- Рэмзи, Джейкоб [exact]
UPDATE cards SET name_en = 'Mateo Kovačić' WHERE id = '567ab4e7-a7e9-4f94-b8e3-67909ef73f2e' AND name_en IS NULL;  -- Матео Ковачич [canonical]
UPDATE cards SET name_en = 'Timothy Michael Krul' WHERE id = '56921716-daef-4048-b847-e08743a3501e' AND name_en IS NULL;  -- Тим Крул [canonical]
UPDATE cards SET name_en = 'Adrián San Miguel del Castillo' WHERE id = '56a48573-120a-4cf2-8178-6fa5afaf7b2c' AND name_en IS NULL;  -- Адриан (футболист) [exact]
UPDATE cards SET name_en = 'Andreas Hugo Hoelgebaum Pereira' WHERE id = '572b681f-2b9c-4391-8281-fc349988af3f' AND name_en IS NULL;  -- Перейра, Андреас [exact]
UPDATE cards SET name_en = 'Gnaly Albert Maxwel Cornet' WHERE id = '572be110-febf-4f67-a137-813f2ca40c22' AND name_en IS NULL;  -- Корне, Максвел [exact]
UPDATE cards SET name_en = 'Timo Werner' WHERE id = '578df6c2-bae7-4c03-ad81-42b46b7c888d' AND name_en IS NULL;  -- Вернер, Тимо [exact]
UPDATE cards SET name_en = 'Tariq Kwame Nii-Lante Lamptey' WHERE id = '57a1951a-4eac-489f-92e0-8dc2357861d7' AND name_en IS NULL;  -- Лэмпти, Тарик [exact]
UPDATE cards SET name_en = 'Ismaïla Sarr' WHERE id = '57a9ef63-dbb1-4bf1-b4eb-443c734c84e8' AND name_en IS NULL;  -- Исмаила Сарр [canonical]
UPDATE cards SET name_en = 'Duván Esteban Zapata Banguero' WHERE id = '57dc4b02-b2c8-4cf7-a6a4-ba54d0e9608d' AND name_en IS NULL;  -- Дуван Сапата [canonical]
UPDATE cards SET name_en = 'Conor John Gallagher' WHERE id = '57e3948f-9c4d-4c7d-8e18-2e75ec5fb7f6' AND name_en IS NULL;  -- Галлахер, Конор [exact]
UPDATE cards SET name_en = 'Hakan Çalhanoğlu' WHERE id = '57feba96-06e3-4551-adb5-c98ca8687b82' AND name_en IS NULL;  -- Хакан Чалханоглу [canonical]
UPDATE cards SET name_en = 'Daniel Johnson Burn' WHERE id = '581bcc94-4177-4aa7-bcf1-8f1fc0497ace' AND name_en IS NULL;  -- Берн, Дэн [exact]
UPDATE cards SET name_en = 'Rodrigo Javier De Paul' WHERE id = '58202ce4-b72d-432d-8911-7cb18622c5af' AND name_en IS NULL;  -- Родриго Де Пауль [canonical]
UPDATE cards SET name_en = 'Rúben dos Santos Gato Alves Dias' WHERE id = '58229404-b223-4842-8a28-230c0b63f2cf' AND name_en IS NULL;  -- Диаш, Рубен [exact]
UPDATE cards SET name_en = 'John McGinn' WHERE id = '586fca39-b13d-4129-9192-fdd4571228cf' AND name_en IS NULL;  -- Макгинн, Джон [exact]
UPDATE cards SET name_en = 'Thomas Glyn Doyle' WHERE id = '58b13e0c-4fc4-4e62-958c-9889e7adc1a0' AND name_en IS NULL;  -- Дойл, Томми [exact]
UPDATE cards SET name_en = 'Takumi Minamino' WHERE id = '591bbe92-d447-4af9-a26f-9c5858fb141b' AND name_en IS NULL;  -- Такуми Минамино [canonical]
UPDATE cards SET name_en = 'Moisés Isaac Caicedo Corozo' WHERE id = '59565ad3-27e4-4cdb-9be7-e0f5fa12f2d4' AND name_en IS NULL;  -- Кайседо, Мойсес [exact]
UPDATE cards SET name_en = 'André Filipe Tavares Gomes' WHERE id = '5959b196-9323-4025-a116-f9bd13fc9bb5' AND name_en IS NULL;  -- Гомеш, Андре [exact]
UPDATE cards SET name_en = 'Temitayo Olufisayo Olaoluwa Aina' WHERE id = '597ef741-ae73-4e0b-ba16-2c69f4fcb591' AND name_en IS NULL;  -- Айна, Ола [exact]
UPDATE cards SET name_en = 'Joško Gvardiol' WHERE id = '59bd44c7-6798-4319-9254-aef937d4f5ab' AND name_en IS NULL;  -- Гвардиол, Йошко [exact]
UPDATE cards SET name_en = 'Mateo Retegui' WHERE id = '5a055f55-bc2b-417c-b27a-4cc5fd473716' AND name_en IS NULL;  -- Матео Ретеги [canonical]
UPDATE cards SET name_en = 'Kieran Tierney' WHERE id = '5a53fce4-a741-4d07-ab32-db95a3ac7965' AND name_en IS NULL;  -- Киран Тирни [canonical]
UPDATE cards SET name_en = 'Thomas Alun Lockyer' WHERE id = '5b008635-0659-409c-ad5d-03ba87f7d144' AND name_en IS NULL;  -- Локьер, Том [exact]
UPDATE cards SET name_en = 'Jordan Marcel Gilbert Veretout' WHERE id = '5b471903-c602-4c52-8826-484e3cd504fc' AND name_en IS NULL;  -- Жордан Верету [canonical]
UPDATE cards SET name_en = 'Onyinye Wilfred Ndidi' WHERE id = '5b5866ca-44de-4f68-80e8-d0c93d284038' AND name_en IS NULL;  -- Ндиди, Уилфред [exact]
UPDATE cards SET name_en = 'Saša Lukić' WHERE id = '5b7a598d-67b1-42ba-9087-b55b0387b33b' AND name_en IS NULL;  -- Лукич, Саша [exact]
UPDATE cards SET name_en = 'Yussuf Yurary Poulsen' WHERE id = '5b7b4830-d499-4545-80fa-5c2b099471e2' AND name_en IS NULL;  -- Юссуф Поульсен [canonical]
UPDATE cards SET name_en = 'Rodrigo Bentancur Colmán' WHERE id = '5bbccb38-d877-4a7b-ab3f-fd7a5a2f4f2e' AND name_en IS NULL;  -- Бентанкур, Родриго [exact]
UPDATE cards SET name_en = 'Nélson Cabral Semedo' WHERE id = '5bd8b39c-3c33-4b21-92e8-7f5ad8c75d42' AND name_en IS NULL;  -- Семеду, Нелсон [exact]
UPDATE cards SET name_en = 'Thomas Müller' WHERE id = '5c95122c-2e21-445f-a5a3-513779431c8f' AND name_en IS NULL;  -- Томас Мюллер [canonical]
UPDATE cards SET name_en = 'Patrick James Bamford' WHERE id = '5d8af28b-0430-4d7d-99a8-91eaab97edc4' AND name_en IS NULL;  -- Бэмфорд, Патрик [exact]
UPDATE cards SET name_en = 'Lesley Chimuanya Ugochukwu' WHERE id = '5e4f8188-962e-4c14-b1ac-391e51a54d4f' AND name_en IS NULL;  -- Угочукву, Лесли [exact]
UPDATE cards SET name_en = 'Kasper Peter Schmeichel' WHERE id = '5fd24574-b135-437c-ad31-ece4b0855a2f' AND name_en IS NULL;  -- Шмейхель, Каспер [exact]
UPDATE cards SET name_en = 'Sean David Longstaff' WHERE id = '605f33f5-c5f1-4b67-9af4-6fba4f0d98c8' AND name_en IS NULL;  -- Шон Лонгстафф [canonical]
UPDATE cards SET name_en = 'João Victor Gomes da Silva' WHERE id = '6087cd41-7938-4a78-a89d-1ee449ab9e38' AND name_en IS NULL;  -- Гомес да Силва, Жуан [exact]
UPDATE cards SET name_en = 'Eric Jeremy Edgar Dier' WHERE id = '608cdfeb-9dcf-4410-baa1-8641ae3f0ebf' AND name_en IS NULL;  -- Дайер, Эрик [exact]
UPDATE cards SET name_en = 'Yan Bueno Couto' WHERE id = '60a22778-8707-4598-abbd-f374278eb610' AND name_en IS NULL;  -- Коуту, Иан [exact]
UPDATE cards SET name_en = 'Gary Cahill' WHERE id = '6120aea8-5556-4358-88fd-7a36587b7b07' AND name_en IS NULL;  -- Кэхилл, Гари [exact]
UPDATE cards SET name_en = 'Rasmus Nissen Kristensen' WHERE id = '6138cf90-8fef-4f61-a925-ec0ccf0b5fcc' AND name_en IS NULL;  -- Кристенсен, Расмус [exact]
UPDATE cards SET name_en = 'Rhian Joel Brewster' WHERE id = '6195ecab-1965-4a08-8c84-a30fab342e1f' AND name_en IS NULL;  -- Брустер, Риан [exact]
UPDATE cards SET name_en = 'Hamed Junior Traorè' WHERE id = '61ad1b64-7bd6-4597-a322-ac90d610140f' AND name_en IS NULL;  -- Траоре, Хамед [exact]
UPDATE cards SET name_en = 'William Alain André Gabriel Saliba' WHERE id = '61bfe255-fb65-4c3c-bef6-7c16d82c414b' AND name_en IS NULL;  -- Салиба, Вильям [exact]
UPDATE cards SET name_en = 'Borna Sosa' WHERE id = '61faf2ca-d616-4166-8b3f-ecc035561a68' AND name_en IS NULL;  -- Соса, Борна [exact]
UPDATE cards SET name_en = 'Konrad Laimer' WHERE id = '620139b7-7850-42de-801a-f2f2d890df03' AND name_en IS NULL;  -- Конрад Лаймер [canonical]
UPDATE cards SET name_en = 'Konstantinos Mavropanos' WHERE id = '620e1e3c-c602-447c-ac5c-de0be68050d4' AND name_en IS NULL;  -- Константинос Мавропанос [canonical]
UPDATE cards SET name_en = 'James John McAtee' WHERE id = '622fab41-da59-468e-ba57-f61c7226dec9' AND name_en IS NULL;  -- Макати, Джеймс [exact]
UPDATE cards SET name_en = 'Jan Kacper Bednarek' WHERE id = '624cfdbe-4e4a-4613-b5aa-785598ee6b52' AND name_en IS NULL;  -- Ян Беднарек [canonical]
UPDATE cards SET name_en = 'Evan Joe Ferguson' WHERE id = '62a58424-62ac-412d-8b70-58b803201f47' AND name_en IS NULL;  -- Фергюсон, Эван [exact]
UPDATE cards SET name_en = 'Nicolás Paz Martínez' WHERE id = '62ab7064-86b3-480d-a2c6-358ef96eb760' AND name_en IS NULL;  -- Нико Пас [canonical]
UPDATE cards SET name_en = 'Divock Okoth Origi' WHERE id = '637d0fdd-f0f3-4054-bac8-4d3322eb954c' AND name_en IS NULL;  -- Дивок Ориги [canonical]
UPDATE cards SET name_en = 'Lukas Manuel Klostermann' WHERE id = '646524d7-756c-4f12-9d30-6c5e24de7526' AND name_en IS NULL;  -- Лукас Клостерман [canonical]
UPDATE cards SET name_en = 'James Daniel Maddison' WHERE id = '64704b39-036e-4ba8-9256-946c70b220e0' AND name_en IS NULL;  -- Мэддисон, Джеймс [exact]
UPDATE cards SET name_en = 'Pablo Sarabia García' WHERE id = '64706e99-eb37-45d1-8674-3ce243aaab74' AND name_en IS NULL;  -- Сарабия, Пабло [exact]
UPDATE cards SET name_en = 'Kevin De Bruyne' WHERE id = '64a17dc4-8d8b-403b-9304-08c04cc2f35b' AND name_en IS NULL;  -- Де Брёйне, Кевин [exact]
UPDATE cards SET name_en = 'Jan Kacper Bednarek' WHERE id = '64bd1bd7-169c-4237-ac58-4ea5e57482c7' AND name_en IS NULL;  -- Беднарек, Ян [exact]
UPDATE cards SET name_en = 'Rayan Aït-Nouri' WHERE id = '64bf5a0a-8942-45c2-835d-d1915fd9d91d' AND name_en IS NULL;  -- Аит-Нури, Райан [exact]
UPDATE cards SET name_en = 'Weston James Earl McKennie' WHERE id = '6645ff8c-8cc9-4cad-b1ac-561c927d1d5d' AND name_en IS NULL;  -- Маккенни, Уэстон [exact]
UPDATE cards SET name_en = 'James Michael Edward Ward-Prowse' WHERE id = '669f2a12-52a0-4687-a0be-54a11e508bd4' AND name_en IS NULL;  -- Уорд-Проуз, Джеймс [exact]
UPDATE cards SET name_en = 'Samuel Luke Johnstone' WHERE id = '66ca3651-2c25-4986-abec-d259670415f8' AND name_en IS NULL;  -- Джонстон, Сэм [exact]
UPDATE cards SET name_en = 'Mislav Oršić' WHERE id = '6701c634-26b1-4785-a560-3e8ad2813903' AND name_en IS NULL;  -- Оршич, Мислав [exact]
UPDATE cards SET name_en = 'Kepa Arrizabalaga Revuelta' WHERE id = '67244563-2f8b-4496-937e-2ade5fc6db03' AND name_en IS NULL;  -- Аррисабалага, Кепа [exact]
UPDATE cards SET name_en = 'Matz Willy Els Sels' WHERE id = '675d0e1e-55a5-4445-b211-53adca9bc2d9' AND name_en IS NULL;  -- Матц Селс [canonical]
UPDATE cards SET name_en = 'Diego Javier Llorente Ríos' WHERE id = '67957dd2-7b30-4bd9-9c48-d8642c0d5c67' AND name_en IS NULL;  -- Льоренте, Диего [exact]
UPDATE cards SET name_en = 'Jonathan Glao Tah' WHERE id = '67a8db8e-ec06-47d3-85db-2b43ee796627' AND name_en IS NULL;  -- Джонатан Та [canonical]
UPDATE cards SET name_en = 'Alex Nicolao Telles' WHERE id = '67c53b4a-1e6b-400d-b917-85f9f9e5a7a5' AND name_en IS NULL;  -- Теллес, Алекс [exact]
UPDATE cards SET name_en = 'Claudio Jeremías Echeverri' WHERE id = '6830e1f3-84c3-4138-a77a-b7a0c9298430' AND name_en IS NULL;  -- Эчеверри, Клаудио [exact]
UPDATE cards SET name_en = 'Zackary Thomas Steffen' WHERE id = '684a257e-2728-4f61-94ec-2249409f8d55' AND name_en IS NULL;  -- Стеффен, Зак [exact]
UPDATE cards SET name_en = 'Emile Smith Rowe' WHERE id = '685f5710-adf5-4fdc-b49a-8ab530fba7ed' AND name_en IS NULL;  -- Смит-Роу, Имил [exact]
UPDATE cards SET name_en = 'Kylian Mbappé Lottin' WHERE id = '68621cc4-7bf0-4f80-8098-e2fafee7c607' AND name_en IS NULL;  -- Килиан Мбаппе [canonical]
UPDATE cards SET name_en = 'Kevin Schade' WHERE id = '686af9da-9919-4c4c-b91a-707cc01bb9af' AND name_en IS NULL;  -- Кевин Шаде [canonical]
UPDATE cards SET name_en = 'Nicolás González Iglesias' WHERE id = '68cc1dcf-1cfd-48da-876c-645cabfd778a' AND name_en IS NULL;  -- Гонсалес, Нико [exact]
UPDATE cards SET name_en = 'Jean-Philippe Mateta' WHERE id = '698c1f70-fc8a-4cae-be2e-a8fdb78cbb36' AND name_en IS NULL;  -- Жан-Филипп Матета [canonical]
UPDATE cards SET name_en = 'Timothy Michael Ream' WHERE id = '69c7cd12-62e0-4346-b877-e1df38aa6e29' AND name_en IS NULL;  -- Рим, Тим [exact]
UPDATE cards SET name_en = 'André Onana Onana' WHERE id = '69cb7f6d-4fa3-4698-b64a-d1abb6a9e960' AND name_en IS NULL;  -- Андре Онана [canonical]
UPDATE cards SET name_en = 'Issahaku Abdul Fatawu' WHERE id = '69e0d428-4ea6-4dac-b634-787945641217' AND name_en IS NULL;  -- Фатаву, Абдул [exact]
UPDATE cards SET name_en = 'Ian Ethan Maatsen' WHERE id = '6a70abb0-62b8-4fd5-a0b0-0839df6e09fb' AND name_en IS NULL;  -- Матсен, Иан [exact]
UPDATE cards SET name_en = 'Jesper Grænge Lindstrøm' WHERE id = '6af8e304-6714-4f07-bb57-2b6c2a32fdd3' AND name_en IS NULL;  -- Линдстрём, Йеспер [exact]
UPDATE cards SET name_en = 'Ibrahima Konaté' WHERE id = '6b0ab7b6-7fb9-4126-ab32-4e49660c9aa3' AND name_en IS NULL;  -- Ибраима Конате [canonical]
UPDATE cards SET name_en = 'Morgan Anthony Gibbs-White' WHERE id = '6b159a2d-cd84-43cd-9b02-9108c9a01fbd' AND name_en IS NULL;  -- Гиббс-Уайт, Морган [exact]
UPDATE cards SET name_en = 'Granit Xhaka' WHERE id = '6b70538b-6949-4f23-a710-ac0100258b69' AND name_en IS NULL;  -- Джака, Гранит [exact]
UPDATE cards SET name_en = 'Pablo Fornals Malla' WHERE id = '6b8933ca-e5e5-4162-9dbb-e7c51fdd9927' AND name_en IS NULL;  -- Форнальс, Пабло [exact]
UPDATE cards SET name_en = 'Nicolas Pépé' WHERE id = '6b988638-bef6-4ee9-afb5-17ca3c64db5a' AND name_en IS NULL;  -- Пепе, Николя [exact]
UPDATE cards SET name_en = 'John Stones' WHERE id = '6bd5ee33-282a-4ecd-9d05-8970f991bab5' AND name_en IS NULL;  -- Стоунз, Джон [exact]
UPDATE cards SET name_en = 'João Maria Lobo Alves Palhinha Gonçalves' WHERE id = '6bff4056-7110-40cc-badf-5b68901e477a' AND name_en IS NULL;  -- Пальинья, Жуан [exact]
UPDATE cards SET name_en = 'Lewis Carl Dunk' WHERE id = '6c2a4cfa-bb2b-4069-bf27-7c9072a50f4f' AND name_en IS NULL;  -- Данк, Льюис [exact]
UPDATE cards SET name_en = 'Gabriel Teodoro Martinelli Silva' WHERE id = '6c2c216b-b57f-460a-b7bc-c4874c6b7d8e' AND name_en IS NULL;  -- Мартинелли, Габриэл [exact]
UPDATE cards SET name_en = 'Harry Billy Winks' WHERE id = '6c4c04f7-249a-4f4c-92ce-77b0dcc61d50' AND name_en IS NULL;  -- Уинкс, Гарри [exact]
UPDATE cards SET name_en = 'Hugo Hadrien Dominique Lloris' WHERE id = '6c8fab90-d6d8-4912-a5b2-6ba8ab3a38a2' AND name_en IS NULL;  -- Уго Льорис [canonical]
UPDATE cards SET name_en = 'Christian Benteke Liolo' WHERE id = '6cd517b1-3480-47e5-b45d-7b9585972ed0' AND name_en IS NULL;  -- Бентеке, Кристиан [exact]
UPDATE cards SET name_en = 'Georginio Gregion Emile Wijnaldum' WHERE id = '6cff3ac2-c6a4-4e97-8726-edf8b7b06bdf' AND name_en IS NULL;  -- Джорджиньо Вейналдум [canonical]
UPDATE cards SET name_en = 'Martin Dúbravka' WHERE id = '6d0043de-e3ba-4b8f-baea-f577506c36b9' AND name_en IS NULL;  -- Мартин Дубравка [canonical]
UPDATE cards SET name_en = 'Miloš Kerkez' WHERE id = '6d0345b4-754d-4f59-993d-f2065937cd87' AND name_en IS NULL;  -- Милош Керкез [canonical]
UPDATE cards SET name_en = 'Callum Eddie Graham Wilson' WHERE id = '6e03bb2b-fcf3-4b97-a0a2-6d25e277c38b' AND name_en IS NULL;  -- Уилсон, Каллум [exact]
UPDATE cards SET name_en = 'Stefan Bajčetić Maquieira' WHERE id = '6ea63873-8186-477a-b356-616200ecbe72' AND name_en IS NULL;  -- Байчетич, Стефан [exact]
UPDATE cards SET name_en = 'Job Joël André Matip' WHERE id = '6ea708a8-066e-4ada-b9c6-303cfb8b4ba4' AND name_en IS NULL;  -- Жоэль Матип [canonical]
UPDATE cards SET name_en = 'Angelo Obinze Ogbonna' WHERE id = '6f038286-7069-486b-8ba5-710d288e1fcb' AND name_en IS NULL;  -- Огбонна, Анджело [exact]
UPDATE cards SET name_en = 'Marcel Sabitzer' WHERE id = '6f3f4fa3-c498-41b6-a2f3-9c89eb90bbcf' AND name_en IS NULL;  -- Марсель Забитцер [canonical]
UPDATE cards SET name_en = 'Leandro Daniel Paredes' WHERE id = '6f512b1d-d856-4d16-8433-d2c18708864e' AND name_en IS NULL;  -- Леандро Паредес [canonical]
UPDATE cards SET name_en = 'Kobbie Boateng Mainoo' WHERE id = '6fe18b1b-bd15-466a-9e9a-3e24a0ae278a' AND name_en IS NULL;  -- Мейну, Кобби [exact]
UPDATE cards SET name_en = 'Sandro Tonali' WHERE id = '70197c38-3421-4548-af47-8018bfa8a68e' AND name_en IS NULL;  -- Тонали, Сандро [exact]
UPDATE cards SET name_en = 'Daniel Amartey' WHERE id = '70e100da-5164-4c13-83c6-ce15ac8f61ec' AND name_en IS NULL;  -- Амарти, Дэниел [exact]
UPDATE cards SET name_en = 'Dayotchanculle Oswald Upamecano' WHERE id = '70f12a16-38d3-4919-a56f-61f3063cab81' AND name_en IS NULL;  -- Дайо Упамекано [canonical]
UPDATE cards SET name_en = 'Yehor Yarmolyuk' WHERE id = '7128ae38-e1de-4bf2-9ff5-5e9bea69220d' AND name_en IS NULL;  -- Ярмолюк, Егор Романович [exact]
UPDATE cards SET name_en = 'Thiago Alcântara do Nascimento' WHERE id = '712d14df-ebbb-440d-b48e-821f5c4ed0cc' AND name_en IS NULL;  -- Алькантара, Тьяго [exact]
UPDATE cards SET name_en = 'Kyle Andrew Walker' WHERE id = '71508f1c-a645-4e96-a093-78880c080ef1' AND name_en IS NULL;  -- Кайл Уокер [canonical]
UPDATE cards SET name_en = 'Daniel Parejo Muñoz' WHERE id = '71975c8c-9c80-456b-b44e-3f46a02d50d8' AND name_en IS NULL;  -- Даниэль Парехо [canonical]
UPDATE cards SET name_en = 'Micky van de Ven' WHERE id = '7237c8d7-9367-46c1-b5a7-221624777b8a' AND name_en IS NULL;  -- Ван де Вен, Микки [exact]
UPDATE cards SET name_en = 'Ethan Chidiebere Nwaneri' WHERE id = '72975fff-0629-4cd4-b1d0-7e7723e91955' AND name_en IS NULL;  -- Нванери, Итан [exact]
UPDATE cards SET name_en = 'Christoph Baumgartner' WHERE id = '72b5fac1-a99d-41b1-824a-cdfb93444ef0' AND name_en IS NULL;  -- Кристоф Баумгартнер [canonical]
UPDATE cards SET name_en = 'Marc Cucurella Saseta' WHERE id = '72d1c296-9c8f-4f4f-98db-c5ef8b4d41ca' AND name_en IS NULL;  -- Кукурелья, Марк [exact]
UPDATE cards SET name_en = 'Benjamin James Chilwell' WHERE id = '73056504-184b-4238-825b-3ff996baeb81' AND name_en IS NULL;  -- Чилуэлл, Бен [exact]
UPDATE cards SET name_en = 'Rodrigo Bentancur Colmán' WHERE id = '731a34ad-f491-4874-9243-a5879e3d2b9b' AND name_en IS NULL;  -- Родриго Бентанкур [canonical]
UPDATE cards SET name_en = 'Brandon Paul Brian Williams' WHERE id = '731acb47-ff15-4a7f-9dd5-3fae35ba5a78' AND name_en IS NULL;  -- Уильямс, Брандон [exact]
UPDATE cards SET name_en = 'Alexandre Armand Lacazette' WHERE id = '73a4504c-30fa-42d4-88d0-8e1301a61340' AND name_en IS NULL;  -- Александр Ляказетт [canonical]
UPDATE cards SET name_en = 'Romelu Menama Lukaku Bolingoli' WHERE id = '742bc3eb-c088-4828-aeae-473596bd8799' AND name_en IS NULL;  -- Лукаку, Ромелу [exact]
UPDATE cards SET name_en = 'Mykhailo Mudryk' WHERE id = '743430cc-7e42-4802-8775-ad03edccce35' AND name_en IS NULL;  -- Мудрик, Михаил Петрович [exact]
UPDATE cards SET name_en = 'Sergio Busquets Burgos' WHERE id = '74d1a3b7-c0cb-4feb-9d4c-91d6f5ff92e1' AND name_en IS NULL;  -- Серхио Бускетс [canonical]
UPDATE cards SET name_en = 'Antony Matheus dos Santos' WHERE id = '74ede627-ac86-45fc-9a66-02615ddc92a3' AND name_en IS NULL;  -- Антони (футболист) [exact]
UPDATE cards SET name_en = 'Idrissa Gana Gueye' WHERE id = '74f71f81-eb74-46ec-8e9b-6803cfbd17d4' AND name_en IS NULL;  -- Идрисса Гейе [canonical]
UPDATE cards SET name_en = 'Mohamed Zeki Amdouni' WHERE id = '7513fa0e-d793-4cc5-9e78-60d04e340a95' AND name_en IS NULL;  -- Амдуни, Зеки [exact]
UPDATE cards SET name_en = 'Daniel Noel Drinkwater' WHERE id = '75261dda-5c5c-4cf0-8ba5-f82175c4c1da' AND name_en IS NULL;  -- Дринкуотер, Дэнни [exact]
UPDATE cards SET name_en = 'Jonathan Grant Evans' WHERE id = '752aac32-936d-4b51-911d-94aeffaf3051' AND name_en IS NULL;  -- Эванс, Джонни [exact]
UPDATE cards SET name_en = 'Harvey Daniel James Elliott' WHERE id = '7613ae56-c2bc-4767-8c32-ccad6a2493bb' AND name_en IS NULL;  -- Харви Эллиотт [canonical]
UPDATE cards SET name_en = 'Nick Woltemade' WHERE id = '761fb3c7-d492-44f3-819f-766772ab7fa8' AND name_en IS NULL;  -- Ник Вольтемаде [canonical]
UPDATE cards SET name_en = 'Hélder Wander Sousa de Azevedo e Costa' WHERE id = '7663de1f-01e7-43e4-8185-1f372383caab' AND name_en IS NULL;  -- Кошта, Элдер [exact]
UPDATE cards SET name_en = 'Florian Richard Wirtz' WHERE id = '76a4a83e-9a52-48dc-b4e2-cb822259c1be' AND name_en IS NULL;  -- Флориан Вирц [canonical]
UPDATE cards SET name_en = 'Jack Peter Grealish' WHERE id = '77be2b84-ee07-4b7e-a591-42747f71104d' AND name_en IS NULL;  -- Грилиш, Джек [exact]
UPDATE cards SET name_en = 'Gabriel Fernando de Jesus' WHERE id = '77efecc9-129d-46e1-969d-95683f52e828' AND name_en IS NULL;  -- Жезус, Габриэл [exact]
UPDATE cards SET name_en = 'Julián Álvarez' WHERE id = '78586915-dfe9-4c58-a461-20128510a3bf' AND name_en IS NULL;  -- Альварес, Хулиан [exact]
UPDATE cards SET name_en = 'Degnand Wilfried Gnonto' WHERE id = '78c10bbe-281e-4fd0-94b6-8364d1b6ac8d' AND name_en IS NULL;  -- Ньонто, Вилли [exact]
UPDATE cards SET name_en = 'Carlos Soler Barragán' WHERE id = '78ff1b75-6204-414d-9ae6-e3729644c663' AND name_en IS NULL;  -- Солер, Карлос [exact]
UPDATE cards SET name_en = 'Ibrahim Sangaré' WHERE id = '7afd3fe9-39f4-48e2-bc42-52c60ff41927' AND name_en IS NULL;  -- Сангаре, Ибраим [exact]
UPDATE cards SET name_en = 'Philip Walter Foden' WHERE id = '7b0e4963-27cc-44d0-9556-49622f5e9458' AND name_en IS NULL;  -- Фоден, Фил [exact]
UPDATE cards SET name_en = 'Nathaniel Nyakie Chalobah' WHERE id = '7b76d1e9-289a-43b2-849a-fe08db58a91e' AND name_en IS NULL;  -- Чалоба, Натаниэл [exact]
UPDATE cards SET name_en = 'Sergio Gómez Martín' WHERE id = '7bcea338-8eb3-4500-b7db-590dec9eeae1' AND name_en IS NULL;  -- Гомес Мартин, Серхио [exact]
UPDATE cards SET name_en = 'Houssem-Eddine Chaâbane Aouar' WHERE id = '7bfadbfb-17e3-4a85-8721-13ebe00dcc1a' AND name_en IS NULL;  -- Уссем Ауар [canonical]
UPDATE cards SET name_en = 'Enock Mwepu' WHERE id = '7c16e296-a9fd-4388-9178-811c2eedf5e2' AND name_en IS NULL;  -- Мвепу, Инок [exact]
UPDATE cards SET name_en = 'Amadou Ba Zeund Georges Mvom Onana' WHERE id = '7c34e0ba-cdd1-4159-92bf-841f05656b31' AND name_en IS NULL;  -- Онана, Амаду [exact]
UPDATE cards SET name_en = 'Lucas Rodrigues Moura da Silva' WHERE id = '7c82570b-3a24-46a1-9cbd-11e3c1d76330' AND name_en IS NULL;  -- Лукас Моура [canonical]
UPDATE cards SET name_en = 'Nicholas Williams Arthuer' WHERE id = '7d1f4dc3-136c-42e2-bd89-9e4fc9e742bb' AND name_en IS NULL;  -- Нико Уильямс [canonical]
UPDATE cards SET name_en = 'Michael Akpovie Olise' WHERE id = '7e6bc99a-1aa4-41a2-be29-0a4235dc18e1' AND name_en IS NULL;  -- Олисе, Майкл [exact]
UPDATE cards SET name_en = 'Paulo Dino Gazzaniga Farias' WHERE id = '7f47ae7c-3fb4-4dc7-91cb-c991e3a6475e' AND name_en IS NULL;  -- Гассанига, Пауло [exact]
UPDATE cards SET name_en = 'Lucas Erik Holger Bergvall' WHERE id = '7f6a2c85-6b29-43a2-8c79-3d5b09270aa7' AND name_en IS NULL;  -- Бергвалль, Лукас [exact]
UPDATE cards SET name_en = 'Nicolás González Iglesias' WHERE id = '7fb0eebe-51c3-4a5e-8b09-326f4c18eee3' AND name_en IS NULL;  -- Нико Гонсалес [canonical]
UPDATE cards SET name_en = 'Jarrad Paul Branthwaite' WHERE id = '800515c8-51e8-45e4-8142-55b459ae8421' AND name_en IS NULL;  -- Брантуэйт, Джарред [exact]
UPDATE cards SET name_en = 'Billy Clifford Gilmour' WHERE id = '80c91c53-035b-4b6e-a576-cd573d5a1b68' AND name_en IS NULL;  -- Гилмор, Билли [exact]
UPDATE cards SET name_en = 'Giorgi Mamardashvili' WHERE id = '80edb1f8-2adf-4beb-9598-28d977951c67' AND name_en IS NULL;  -- Мамардашвили, Георгий [exact]
UPDATE cards SET name_en = 'Mats Julian Hummels' WHERE id = '81ce751c-c685-489a-98c7-ef6c436bf615' AND name_en IS NULL;  -- Матс Хуммельс [canonical]
UPDATE cards SET name_en = 'Kevin Johannes Willem Strootman' WHERE id = '823a6188-244c-46c9-a1d5-3cf10a5ee0f8' AND name_en IS NULL;  -- Кевин Стротман [canonical]
UPDATE cards SET name_en = 'Tijjani Reijnders' WHERE id = '82698161-dee0-42f4-8973-85ca073821af' AND name_en IS NULL;  -- Тиджани Рейндерс [canonical]
UPDATE cards SET name_en = 'Daniel Owen James' WHERE id = '82e2b362-5f9d-49d9-9058-787262b1a284' AND name_en IS NULL;  -- Джеймс, Дэниел [exact]
UPDATE cards SET name_en = 'Aymeric Jean Louis Gérard Alph Laporte' WHERE id = '8417d8ec-ff30-4666-9eaa-c69a014b263d' AND name_en IS NULL;  -- Ляпорт, Эмерик [exact]
UPDATE cards SET name_en = 'Erling Braut Haaland' WHERE id = '844d5a9c-4e20-4537-8dc0-ec601943ec77' AND name_en IS NULL;  -- Холанн, Эрлинг [exact]
UPDATE cards SET name_en = 'Jesse Ellis Lingard' WHERE id = '855ea0e6-489d-4c1e-88e6-b37840d019a4' AND name_en IS NULL;  -- Джесси Лингард [canonical]
UPDATE cards SET name_en = 'Jordan Pierre Ayew' WHERE id = '85dce9b7-5573-4085-8869-66e071a9336b' AND name_en IS NULL;  -- Джордан Айю [canonical]
UPDATE cards SET name_en = 'Juan Manuel Mata García' WHERE id = '85f564e0-14f7-4798-9ee1-251061fffe8c' AND name_en IS NULL;  -- Мата, Хуан [exact]
UPDATE cards SET name_en = 'Cole Jermaine Palmer' WHERE id = '860128c7-ac78-41eb-bf7c-594a876d8440' AND name_en IS NULL;  -- Палмер, Коул [exact]
UPDATE cards SET name_en = 'Jordi Alba Ramos' WHERE id = '86220fd9-13ec-43d0-b501-89091e8059fe' AND name_en IS NULL;  -- Жорди Альба [canonical]
UPDATE cards SET name_en = 'Lucas Vázquez Iglesias' WHERE id = '86a350df-bbf6-4a5d-a7d8-629d9d433dc1' AND name_en IS NULL;  -- Лукас Васкес [canonical]
UPDATE cards SET name_en = 'Ricardo Domingos Barbosa Pereira' WHERE id = '86accbc7-23bf-4bae-b62e-84e00032312f' AND name_en IS NULL;  -- Барбоза Перейра, Рикарду Домингуш [exact]
UPDATE cards SET name_en = 'Willian Joel Pacho Tenorio' WHERE id = '86ccb92a-e665-4e69-a7f8-319276f9270c' AND name_en IS NULL;  -- Вильян Пачо [canonical]
UPDATE cards SET name_en = 'Ogochukwu Frank Onyeka' WHERE id = '86d87b0f-c55f-4167-907e-adfe994e5fef' AND name_en IS NULL;  -- Франк Оньека [canonical]
UPDATE cards SET name_en = 'Dara Joseph O''Shea' WHERE id = '86f6ff53-9668-4df9-bdcd-d89fdac0084e' AND name_en IS NULL;  -- О’Ши, Дара [exact]
UPDATE cards SET name_en = 'Daichi Kamada' WHERE id = '8704cb2b-9244-4033-9444-c69d1c1b36ce' AND name_en IS NULL;  -- Камада, Даити [exact]
UPDATE cards SET name_en = 'Manuel Obafemi Akanji' WHERE id = '8785caad-9519-4b23-8a01-22b9ebd2e8af' AND name_en IS NULL;  -- Аканджи, Мануэль [exact]
UPDATE cards SET name_en = 'Liam Rory Delap' WHERE id = '87b8522f-b2c5-41b1-b27c-6401b734fd94' AND name_en IS NULL;  -- Лиам Делап [canonical]
UPDATE cards SET name_en = 'Francisco António Machado Mota de Castro Trincão' WHERE id = '883455fe-146b-4847-9c4c-36e4aea68c68' AND name_en IS NULL;  -- Тринкан, Франсишку [exact]
UPDATE cards SET name_en = 'Aaron Christopher Ramsdale' WHERE id = '88491f70-eb11-4d72-b32d-3fc1ad29376a' AND name_en IS NULL;  -- Рамздейл, Эрон [exact]
UPDATE cards SET name_en = 'Nathaniel Harry Phillips' WHERE id = '8866c1df-9fac-45f4-bbf4-ffb04da231d1' AND name_en IS NULL;  -- Филлипс, Натаниэль [exact]
UPDATE cards SET name_en = 'Liam Rory Delap' WHERE id = '88fddc61-827d-4d1a-b86d-62fe8c772b4f' AND name_en IS NULL;  -- Делап, Лиам [exact]
UPDATE cards SET name_en = 'Neco Shay Williams' WHERE id = '891d040f-9b15-4958-8b88-677587c2a6a6' AND name_en IS NULL;  -- Неко Уильямс [canonical]
UPDATE cards SET name_en = 'Mathias Jensen' WHERE id = '8968b6b5-719a-4172-9f31-fa17fd22a824' AND name_en IS NULL;  -- Йенсен, Матиас [exact]
UPDATE cards SET name_en = 'Vitaly Janelt' WHERE id = '899f3911-1dc3-45d0-9e4b-da3a931b7935' AND name_en IS NULL;  -- Янельт, Витали [exact]
UPDATE cards SET name_en = 'Kenny Joelle Tete' WHERE id = '89a78814-f34b-49cb-9eb8-8cfc3f0d0cf7' AND name_en IS NULL;  -- Тете, Кенни [exact]
UPDATE cards SET name_en = 'Karl Jakob Hein' WHERE id = '8a9608e2-a682-458f-acb0-198461a255a6' AND name_en IS NULL;  -- Хейн, Карл Якоб [exact]
UPDATE cards SET name_en = 'Mario Pašalić' WHERE id = '8aefbc01-4df7-4dba-9084-d7c5f672dd26' AND name_en IS NULL;  -- Марио Пашалич [canonical]
UPDATE cards SET name_en = 'Conor David Coady' WHERE id = '8b03121f-0a4a-473a-a224-6d42754016bf' AND name_en IS NULL;  -- Коуди, Конор [exact]
UPDATE cards SET name_en = 'Ivan Benjamin Elijah Toney' WHERE id = '8b07d7b6-462e-4ced-abd3-031be0c21851' AND name_en IS NULL;  -- Тоуни, Айван [exact]
UPDATE cards SET name_en = 'Dean Donny Huijsen' WHERE id = '8b26077b-6b39-4276-bc6a-dec5547db009' AND name_en IS NULL;  -- Хёйсен, Дин [exact]
UPDATE cards SET name_en = 'Heung-Min Son' WHERE id = '8b59bb5e-9d52-4a0c-bba4-7c514e5e3d4e' AND name_en IS NULL;  -- Хын Мин Сон [canonical]
UPDATE cards SET name_en = 'Jordan Brian Henderson' WHERE id = '8c0117e5-272d-43ef-9d2b-9de728981579' AND name_en IS NULL;  -- Джордан Хендерсон [canonical]
UPDATE cards SET name_en = 'Loïc Badé' WHERE id = '8c03cf52-a8e2-4e04-a544-11319802c926' AND name_en IS NULL;  -- Лоик Баде [canonical]
UPDATE cards SET name_en = 'Nuno Albertino Varela Tavares' WHERE id = '8cd09f38-4157-4605-8ee8-17ae578cdf7a' AND name_en IS NULL;  -- Тавариш, Нуну [exact]
UPDATE cards SET name_en = 'Bart Verbruggen' WHERE id = '8d1b205e-54f8-405d-baaa-4a6e95ff5cf5' AND name_en IS NULL;  -- Барт Вербрюгген [canonical]
UPDATE cards SET name_en = 'Thomas Strakosha' WHERE id = '8d7a4068-cf00-42e0-a5a7-345e0d5bc95c' AND name_en IS NULL;  -- Томас Стракоша [canonical]
UPDATE cards SET name_en = 'Riyad Karim Mahrez' WHERE id = '8dcdf64a-1612-40d4-943c-5c00df61b4c2' AND name_en IS NULL;  -- Махрез, Рияд [exact]
UPDATE cards SET name_en = 'Bertrand Isidore Traoré' WHERE id = '8e064b15-2164-44b5-836e-eae9c128de1c' AND name_en IS NULL;  -- Траоре, Бертран [exact]
UPDATE cards SET name_en = 'Manor Solomon' WHERE id = '908e09c4-7067-4a6e-afbd-37ce86827ff7' AND name_en IS NULL;  -- Соломон, Манор [exact]
UPDATE cards SET name_en = 'Miguel Ángel Almirón Rejala' WHERE id = '9137d06d-1cf2-47b3-90bb-aca9a144d04c' AND name_en IS NULL;  -- Альмирон, Мигель [exact]
UPDATE cards SET name_en = 'Héctor Bellerín Moruno' WHERE id = '91543995-9d97-4552-bca3-f7c213d0ad54' AND name_en IS NULL;  -- Бельерин, Эктор [exact]
UPDATE cards SET name_en = 'Emre Can' WHERE id = '91f14bb3-0269-4597-9f1f-16e11d55b278' AND name_en IS NULL;  -- Эмре Джан [canonical]
UPDATE cards SET name_en = 'Adam David Lallana' WHERE id = '92ca1ce1-bf22-43a3-b0be-55a720f151f1' AND name_en IS NULL;  -- Лаллана, Адам [exact]
UPDATE cards SET name_en = 'Declan Rice' WHERE id = '93400604-240e-45f9-bf85-ab2f9d13062e' AND name_en IS NULL;  -- Деклан Райс [canonical]
UPDATE cards SET name_en = 'Alexander Isak' WHERE id = '93c5fedc-4d45-4c91-93f8-2a5cd0dbeca0' AND name_en IS NULL;  -- Исак, Александер [exact]
UPDATE cards SET name_en = 'Séamus Coleman' WHERE id = '9424bb62-6a21-427b-8bdf-6ad99033cfa2' AND name_en IS NULL;  -- Коулман, Шеймус [exact]
UPDATE cards SET name_en = 'Amad Diallo Traoré' WHERE id = '9479ee2b-a68a-40f9-b3fd-b06d26570825' AND name_en IS NULL;  -- Диалло, Амад [exact]
UPDATE cards SET name_en = 'Jérémy Baffour Doku' WHERE id = '951f60d6-3f64-4b86-af3b-325fb0473ecb' AND name_en IS NULL;  -- Доку, Жереми [exact]
UPDATE cards SET name_en = 'Dejan Kulusevski' WHERE id = '958c766f-d242-43a3-bb7d-c10ed2ffb56c' AND name_en IS NULL;  -- Кулушевски, Деян [exact]
UPDATE cards SET name_en = 'Marc Cucurella Saseta' WHERE id = '95aa4b02-3426-402f-ad61-a1e8c2bac4f0' AND name_en IS NULL;  -- Марк Кукурелья [canonical]
UPDATE cards SET name_en = 'Breel Donald Embolo' WHERE id = '9613319f-5bde-40bb-bc44-8caddd3f699b' AND name_en IS NULL;  -- Брель Эмболо [canonical]
UPDATE cards SET name_en = 'Remo Marco Freuler' WHERE id = '962a0a53-aea4-4926-8f06-98cd2755d797' AND name_en IS NULL;  -- Фройлер, Ремо [exact]
UPDATE cards SET name_en = 'Miguel Ángel Almirón Rejala' WHERE id = '96718350-28de-409e-a25d-29d5d2f470d4' AND name_en IS NULL;  -- Мигель Альмирон [canonical]
UPDATE cards SET name_en = 'Antoine Griezmann' WHERE id = '967970a4-262e-49be-a28a-9aa02553a489' AND name_en IS NULL;  -- Антуан Гризманн [canonical]
UPDATE cards SET name_en = 'Wesley Tidjan Fofana' WHERE id = '968fa6d0-2fd4-43a6-93c0-813ea29da3db' AND name_en IS NULL;  -- Фофана, Весле [exact]
UPDATE cards SET name_en = 'Nabil Fekir' WHERE id = '96c7d09a-07e0-43aa-8ca8-80dcf66cd55e' AND name_en IS NULL;  -- Набиль Фекир [canonical]
UPDATE cards SET name_en = 'Pau Francisco Torres' WHERE id = '97003c9a-b39a-42ed-a669-20bdbe33d777' AND name_en IS NULL;  -- Пау Торрес [canonical]
UPDATE cards SET name_en = 'Abdul-Nasir Oluwatosin Oluwadoyinsolami Adarabioyo' WHERE id = '97132967-5389-48fb-b1f3-d0c59295c4f1' AND name_en IS NULL;  -- Адарабиойо, Тосин [exact]
UPDATE cards SET name_en = 'Federico Santiago Valverde Dipetta' WHERE id = '9744ff4e-5b52-4cc8-8a45-0bee6f6f8ff2' AND name_en IS NULL;  -- Федерико Вальверде [canonical]
UPDATE cards SET name_en = 'Anthony Jordan Martial' WHERE id = '97ebe66f-79cf-4629-bd4d-ea845e5f6768' AND name_en IS NULL;  -- Марсьяль, Антони [exact]
UPDATE cards SET name_en = 'Hamza Dewan Choudhury' WHERE id = '9813be75-d8b1-4310-9271-4207aca63017' AND name_en IS NULL;  -- Чаудри, Хамза [exact]
UPDATE cards SET name_en = 'Harry Wilson' WHERE id = '98690d7d-65f0-483a-9f8c-da7e561977a9' AND name_en IS NULL;  -- Уилсон, Харри [exact]
UPDATE cards SET name_en = 'Deivid Washington de Souza Eugênio' WHERE id = '98bd8135-66f3-4008-995c-b797f704f1a0' AND name_en IS NULL;  -- Дейвид Вашингтон [exact]
UPDATE cards SET name_en = 'Stephan Kareem El Shaarawy' WHERE id = '98dfd7e1-46e7-4632-a423-17783da8b541' AND name_en IS NULL;  -- Стефан Эль Шаарави [canonical]
UPDATE cards SET name_en = 'Diego Alexander Gómez Amarilla' WHERE id = '99217eb0-66f6-4ffd-aa67-36378f62c616' AND name_en IS NULL;  -- Гомес, Диего (парагвайский футболист) [exact]
UPDATE cards SET name_en = 'Matthew Stuart Cash' WHERE id = '999ba795-6615-4129-b44f-9beee405ebed' AND name_en IS NULL;  -- Кэш, Мэтти [exact]
UPDATE cards SET name_en = 'Nathan Benjamin Aké' WHERE id = '99afa2e2-4d56-4a09-96d4-4c14285c6bf1' AND name_en IS NULL;  -- Аке, Натан [exact]
UPDATE cards SET name_en = 'Raphaël Xavier Varane' WHERE id = '99e2ac79-7662-4dc7-8d02-90afba4e515a' AND name_en IS NULL;  -- Рафаэль Варан [canonical]
UPDATE cards SET name_en = 'Serge David Gnabry' WHERE id = '9a2eed9e-c187-4797-83c3-da0a3f54a30b' AND name_en IS NULL;  -- Серж Гнабри [canonical]
UPDATE cards SET name_en = 'Fábio Daniel Ferreira Vieira' WHERE id = '9a508cea-b936-4e98-9170-1c2138342065' AND name_en IS NULL;  -- Виейра, Фабиу [exact]
UPDATE cards SET name_en = 'David Datro Fofana' WHERE id = '9a638f1d-28e8-4e86-9e46-6db2aed52da4' AND name_en IS NULL;  -- Фофана, Давид Датро [exact]
UPDATE cards SET name_en = 'Daniel Ward' WHERE id = '9afd8034-976a-4464-8d30-0411dc2022ca' AND name_en IS NULL;  -- Уорд, Дэнни [exact]
UPDATE cards SET name_en = 'Vladimír Coufal' WHERE id = '9b1d51b0-b266-43b3-9a6a-7beb0091732d' AND name_en IS NULL;  -- Цоуфал, Владимир [exact]
UPDATE cards SET name_en = 'Milan Badelj' WHERE id = '9b2b5b59-c074-4464-b146-aafb4e4219de' AND name_en IS NULL;  -- Милан Бадель [canonical]
UPDATE cards SET name_en = 'Rick Karsdorp' WHERE id = '9b9b1e4b-4c63-49d8-8124-ba8f5b1c6472' AND name_en IS NULL;  -- Рик Карсдорп [canonical]
UPDATE cards SET name_en = 'Miloš Kerkez' WHERE id = '9b9cfafa-318a-4304-b39e-ce2b1cecf29e' AND name_en IS NULL;  -- Керкез, Милош [exact]
UPDATE cards SET name_en = 'Ruben Ira Loftus-Cheek' WHERE id = '9bbbcf7f-c823-4fa1-8c16-4194cdf9a9f5' AND name_en IS NULL;  -- Лофтус-Чик, Рубен [exact]
UPDATE cards SET name_en = 'Tyrone Deon Mings' WHERE id = '9bd3cc7b-c6f0-4a8d-a070-3297ba4b7e0d' AND name_en IS NULL;  -- Мингз, Тайрон [exact]
UPDATE cards SET name_en = 'Patrick Chinazaekpere Dorgu' WHERE id = '9bd94464-784d-43a0-86b6-020f0d9d412f' AND name_en IS NULL;  -- Патрик Доргу [canonical]
UPDATE cards SET name_en = 'Kieran Tierney' WHERE id = '9ca6a4ec-b5e0-483a-aeb0-191dcebb0b90' AND name_en IS NULL;  -- Тирни, Киран [exact]
UPDATE cards SET name_en = 'David Raya Martin' WHERE id = '9cfb642a-187c-491e-8c78-424c51d7163e' AND name_en IS NULL;  -- Райя, Давид [exact]
UPDATE cards SET name_en = 'Mateus Gonçalo Espanha Fernandes' WHERE id = '9da122ea-4f1a-4fa9-b86e-43125eeee71b' AND name_en IS NULL;  -- Матеуш Фернандеш [canonical]
UPDATE cards SET name_en = 'Hugo Hadrien Dominique Lloris' WHERE id = '9db3a896-9dbc-4fe5-84a9-cfa86108738d' AND name_en IS NULL;  -- Льорис, Уго [exact]
UPDATE cards SET name_en = 'Bamidele Jermaine Alli' WHERE id = '9df7e6e3-bdbe-4279-ad56-a761a2c71eba' AND name_en IS NULL;  -- Алли, Деле [exact]
UPDATE cards SET name_en = 'Enes Ünal' WHERE id = '9e205764-46d2-427c-a50a-b39e548877a3' AND name_en IS NULL;  -- Унал, Энес [exact]
UPDATE cards SET name_en = 'Harvey Daniel James Elliott' WHERE id = '9e5449cf-cb18-475d-a1cf-a65b6d45058f' AND name_en IS NULL;  -- Эллиотт, Харви [exact]
UPDATE cards SET name_en = 'Antonio Rüdiger' WHERE id = '9e82c314-bebd-47e9-a8bf-9c7716036fba' AND name_en IS NULL;  -- Антонио Рюдигер [canonical]
UPDATE cards SET name_en = 'Kenan Yıldız' WHERE id = '9eb8bb21-07f7-46b6-bf23-3f9bd93ba538' AND name_en IS NULL;  -- Кенан Йылдыз [canonical]
UPDATE cards SET name_en = 'Davinson Sánchez Mina' WHERE id = '9ec80a59-28b4-4f24-bb37-b925de9388db' AND name_en IS NULL;  -- Давинсон Санчес [canonical]
UPDATE cards SET name_en = 'Dean Bradley Henderson' WHERE id = '9ee976ba-2e72-4420-88b5-32a1e007c81c' AND name_en IS NULL;  -- Дин Хендерсон [canonical]
UPDATE cards SET name_en = 'Leandro Trossard' WHERE id = '9eef0c3f-d5ad-456f-bfea-f91d1084cf6a' AND name_en IS NULL;  -- Троссард, Леандро [exact]
UPDATE cards SET name_en = 'Gianluca Mancini' WHERE id = '9f0644f4-779e-4e80-baa2-244757afe3d8' AND name_en IS NULL;  -- Джанлука Манчини [canonical]
UPDATE cards SET name_en = 'Leon Patrick Bailey Butler' WHERE id = '9fa6524e-da89-4c19-bf24-a811cb42c79a' AND name_en IS NULL;  -- Бейли, Леон [exact]
UPDATE cards SET name_en = 'João Pedro Cavaco Cancelo' WHERE id = 'a03cc9fb-48e8-4db7-ad37-ab12fdcd8f2d' AND name_en IS NULL;  -- Канселу, Жуан [exact]
UPDATE cards SET name_en = 'Noussair Mazraoui' WHERE id = 'a0ef7e83-db6a-4c70-9ba8-b8456096abe9' AND name_en IS NULL;  -- Нуссаир Мазрауи [canonical]
UPDATE cards SET name_en = 'Keane William Lewis-Potter' WHERE id = 'a2a66322-a077-4b21-be0c-5b231cc4f094' AND name_en IS NULL;  -- Кин Луис-Поттер [canonical]
UPDATE cards SET name_en = 'João Filipe Iria Santos Moutinho' WHERE id = 'a3fc5ead-c5a9-446b-9412-ff809d947ba4' AND name_en IS NULL;  -- Моутинью, Жоау [exact]
UPDATE cards SET name_en = 'Sofyan Amrabat' WHERE id = 'a40a4cf1-f8f2-45c2-a8ee-743ca0b036de' AND name_en IS NULL;  -- Амрабат, Софьян [exact]
UPDATE cards SET name_en = 'Samir Handanovič' WHERE id = 'a415d2c4-a987-4e5d-a23d-34fed4afdeb8' AND name_en IS NULL;  -- Самир Ханданович [canonical]
UPDATE cards SET name_en = 'Julio César Enciso Espínola' WHERE id = 'a474cb3f-98d1-453f-b36a-14e38c263671' AND name_en IS NULL;  -- Энсисо, Хулио Сесар (футболист, 2004) [exact]
UPDATE cards SET name_en = 'Damián Emiliano Martínez Romero' WHERE id = 'a4d8a853-f452-4c0d-9465-4dec3e257f8a' AND name_en IS NULL;  -- Эмилиано Мартинес [canonical]
UPDATE cards SET name_en = 'Yves Bissouma' WHERE id = 'a54fb62d-beff-4d8d-bec3-7f0e4b1cfed0' AND name_en IS NULL;  -- Биссума, Ив [exact]
UPDATE cards SET name_en = 'Jules Olivier Koundé' WHERE id = 'a58aa4ab-3e46-4ca9-9553-8846e0fa5b54' AND name_en IS NULL;  -- Жюль Кунде [canonical]
UPDATE cards SET name_en = 'Jean-Philippe Gbamin' WHERE id = 'a5c6ccb7-5983-4afe-bbd6-65413ec38a84' AND name_en IS NULL;  -- Гбамен, Жан-Филипп [exact]
UPDATE cards SET name_en = 'Nikola Vlašić' WHERE id = 'a621abff-5ce2-48a7-ad44-1c8eea57f91d' AND name_en IS NULL;  -- Влашич, Никола [exact]
UPDATE cards SET name_en = 'Francisco Evanilson de Lima Barbosa' WHERE id = 'a6b474dd-e399-45d4-a127-2ff28519aba3' AND name_en IS NULL;  -- Эванилсон (футболист, 1999) [exact]
UPDATE cards SET name_en = 'Tanguy Ndombélé Alvaro' WHERE id = 'a6d35aad-7a1e-4fa7-916b-18275d1533d2' AND name_en IS NULL;  -- Ндомбеле, Танги [exact]
UPDATE cards SET name_en = 'Juan Manuel Mata García' WHERE id = 'a7c1fa06-d592-4135-a9a1-b0b0e4438239' AND name_en IS NULL;  -- Хуан Мата [canonical]
UPDATE cards SET name_en = 'Bart Verbruggen' WHERE id = 'a7d1f078-8822-4072-a78d-326aefddccd8' AND name_en IS NULL;  -- Вербрюгген, Барт [exact]
UPDATE cards SET name_en = 'Amir Selmane Ramy Bensebaïni' WHERE id = 'a7da0db0-0964-4e9f-ac7a-b9ed45b32e85' AND name_en IS NULL;  -- Рами Бенсебайни [canonical]
UPDATE cards SET name_en = 'Facundo Pellistri Rebollo' WHERE id = 'a80f23be-5d2d-470f-8cf2-28fe83d14eb0' AND name_en IS NULL;  -- Пельистри, Факундо [exact]
UPDATE cards SET name_en = 'James David Garner' WHERE id = 'a81f5acd-42fa-4cd9-b672-2da0db0c401a' AND name_en IS NULL;  -- Гарнер, Джеймс (футболист) [exact]
UPDATE cards SET name_en = 'Gonçalo Manuel Ganchinho Guedes' WHERE id = 'a8595852-e745-47a0-a6d5-d59bdb04f144' AND name_en IS NULL;  -- Гедеш, Гонсалу [exact]
UPDATE cards SET name_en = 'Justin Dean Kluivert' WHERE id = 'a9519afa-96a5-47b2-a395-f8e4e036e09b' AND name_en IS NULL;  -- Джастин Клюйверт [canonical]
UPDATE cards SET name_en = 'Jack Butland' WHERE id = 'a996ba74-a009-43eb-97af-0b0f27d64664' AND name_en IS NULL;  -- Батленд, Джек [exact]
UPDATE cards SET name_en = 'Carney Chibueze Chukwuemeka' WHERE id = 'a9efebb6-1d74-4a52-9286-aad69c58ee56' AND name_en IS NULL;  -- Чуквуэмека, Карни [exact]
UPDATE cards SET name_en = 'Chukwunonso Tristan Madueke' WHERE id = 'a9f55b65-07a9-43ec-8177-86c11b72bedc' AND name_en IS NULL;  -- Мадуэке, Нони [exact]
UPDATE cards SET name_en = 'Nikola Milenković' WHERE id = 'aa39a6d2-c44f-490f-8e37-04055d494fa1' AND name_en IS NULL;  -- Миленкович, Никола [exact]
UPDATE cards SET name_en = 'Jaka Bijol' WHERE id = 'aa46c4b4-d3b5-4b71-963e-9869be79b11a' AND name_en IS NULL;  -- Яка Бийол [canonical]
UPDATE cards SET name_en = 'Jorge Resurrección Merodio' WHERE id = 'aa49b38b-2e34-4f31-a1ef-8019d38e3612' AND name_en IS NULL;  -- Коке [exact]
UPDATE cards SET name_en = 'Aaron James Ramsey' WHERE id = 'aa658fb4-ea5d-4cca-9c09-942083e33584' AND name_en IS NULL;  -- Рэмзи, Аарон [exact]
UPDATE cards SET name_en = 'Alexander Mark David Oxlade-Chamberlain' WHERE id = 'aa7c0ce6-02a3-46c4-8e2b-6a0f4aeb4da2' AND name_en IS NULL;  -- Окслейд-Чемберлен, Алекс [exact]
UPDATE cards SET name_en = 'Joshua Orobosa Zirkzee' WHERE id = 'aa939222-2a01-44ed-b73e-6088387dc6b5' AND name_en IS NULL;  -- Зиркзе, Джошуа [exact]
UPDATE cards SET name_en = 'Robert Samuel Holding' WHERE id = 'aac7a134-82da-4b24-bec9-68b66aa79c16' AND name_en IS NULL;  -- Роб Холдинг [canonical]
UPDATE cards SET name_en = 'Fabian Delph' WHERE id = 'ab19e9a3-487e-4052-b9ec-3c73fef7bdaf' AND name_en IS NULL;  -- Делф, Фабиан [exact]
UPDATE cards SET name_en = 'Joshua King' WHERE id = 'ab275a90-65a0-418a-8a09-c9493567ebae' AND name_en IS NULL;  -- Кинг, Джошуа [exact]
UPDATE cards SET name_en = 'José Diogo Dalot Teixeira' WHERE id = 'ab2d5866-4ea4-449b-9de9-282771ada82d' AND name_en IS NULL;  -- Дало, Диогу [exact]
UPDATE cards SET name_en = 'Thomas Teye Partey' WHERE id = 'ab2e8ce1-c4a6-4eb6-9fa1-75c6fb88004e' AND name_en IS NULL;  -- Томас Парти [canonical]
UPDATE cards SET name_en = 'Ui-Jo Hwang' WHERE id = 'ab4effac-8083-4d48-8d89-844b4ea40e36' AND name_en IS NULL;  -- Хван Ый Джо [exact]
UPDATE cards SET name_en = 'Mattéo Elias Kenzo Guendouzi Olié' WHERE id = 'ab6f434f-d72a-4491-bf99-001a3bff43c0' AND name_en IS NULL;  -- Маттео Гендузи [canonical]
UPDATE cards SET name_en = 'Noussair Mazraoui' WHERE id = 'ab7cbf70-58e1-49f0-a28e-f6f3f0af92ae' AND name_en IS NULL;  -- Мазрауи, Нуссаир [exact]
UPDATE cards SET name_en = 'Vitalii Mykolenko' WHERE id = 'abb66aff-bff1-4379-8f23-df55b184305d' AND name_en IS NULL;  -- Миколенко, Виталий Сергеевич [exact]
UPDATE cards SET name_en = 'Kieffer Roberto Francisco Moore' WHERE id = 'abec0bd7-0ae6-4f33-a428-cd5be252db72' AND name_en IS NULL;  -- Мур, Киффер [exact]
UPDATE cards SET name_en = 'Alexander Chuka Iwobi' WHERE id = 'abef07b3-47b3-4ae3-97a4-05b91e713a0d' AND name_en IS NULL;  -- Алекс Ивоби [canonical]
UPDATE cards SET name_en = 'Daniel Olmo Carvajal' WHERE id = 'ac90ae5b-a291-49db-b3c1-a5a74fc9bc50' AND name_en IS NULL;  -- Дани Ольмо [canonical]
UPDATE cards SET name_en = 'Lucas Tolentino Coelho de Lima' WHERE id = 'ace24bff-5aca-4560-9e9f-b4b9cf9fae01' AND name_en IS NULL;  -- Лукас Пакета [exact]
UPDATE cards SET name_en = 'Marcus Bettinelli' WHERE id = 'ad13b326-298f-4dec-a257-1d23e76595f5' AND name_en IS NULL;  -- Беттинелли, Маркус [exact]
UPDATE cards SET name_en = 'Benoît Guy Robert Costil' WHERE id = 'adab24d7-20c6-4631-81ed-efec7bd2af14' AND name_en IS NULL;  -- Бенуа Костиль [canonical]
UPDATE cards SET name_en = 'Edson Omar Álvarez Velázquez' WHERE id = 'adb6d6d2-4777-4eda-ac5a-a747528fbd00' AND name_en IS NULL;  -- Альварес, Эдсон [exact]
UPDATE cards SET name_en = 'Walter Daniel Benítez' WHERE id = 'ae34cb47-9aca-4595-8abd-654152959cfb' AND name_en IS NULL;  -- Бенитес, Вальтер Даниэль [exact]
UPDATE cards SET name_en = 'Nathan Adewale Temitayo Tella' WHERE id = 'ae86cfbf-d1b4-46a5-adb5-6d6e433fa7c1' AND name_en IS NULL;  -- Телла, Нейтан [exact]
UPDATE cards SET name_en = 'Ismaïla Sarr' WHERE id = 'aebb8b61-c9cc-4925-969d-104d77d7a775' AND name_en IS NULL;  -- Сарр, Исмаила [exact]
UPDATE cards SET name_en = 'Jhon Jader Durán Palacio' WHERE id = 'aedbef9b-eae0-4a89-bbeb-f80baf92091f' AND name_en IS NULL;  -- Дуран, Джон [exact]
UPDATE cards SET name_en = 'Taiwo Micheal Awoniyi' WHERE id = 'af60e771-f7d5-4cd1-8f69-fdb191532621' AND name_en IS NULL;  -- Авоньи, Тайво [exact]
UPDATE cards SET name_en = 'Gianluca Scamacca' WHERE id = 'afdf77e5-c261-4fba-b6cc-f6cf46e1abdc' AND name_en IS NULL;  -- Скамакка, Джанлука [exact]
UPDATE cards SET name_en = 'Addji Keaninkin Marc-Israel Guéhi' WHERE id = 'b00c3a42-6399-442a-9549-94644388d569' AND name_en IS NULL;  -- Гехи, Марк [exact]
UPDATE cards SET name_en = 'Sandro Tonali' WHERE id = 'b02a8a16-0925-4662-9a9f-86ed341bd8b3' AND name_en IS NULL;  -- Сандро Тонали [canonical]
UPDATE cards SET name_en = 'José Pedro Malheiro de Sá' WHERE id = 'b04f34b9-4390-4235-b865-bb628a161c80' AND name_en IS NULL;  -- Са, Жозе [exact]
UPDATE cards SET name_en = 'Jens-Lys Michel Cajuste' WHERE id = 'b0d25a54-0c66-46ab-8d9b-960677305e57' AND name_en IS NULL;  -- Каюсте, Йенс [exact]
UPDATE cards SET name_en = 'Curtis Julian Jones' WHERE id = 'b1149c23-781d-48e3-9a21-9e457b03f754' AND name_en IS NULL;  -- Джонс, Кертис (футболист) [exact]
UPDATE cards SET name_en = 'Norberto Murara Neto' WHERE id = 'b12b4a00-49af-4093-9a33-9ba044f14337' AND name_en IS NULL;  -- Нето, Норберто Мурара [exact]
UPDATE cards SET name_en = 'Gonzalo Ariel Montiel' WHERE id = 'b20ffbd1-3a15-4baf-afc1-a0d93e663e60' AND name_en IS NULL;  -- Монтиэль, Гонсало [exact]
UPDATE cards SET name_en = 'Gabriel dos Santos Magalhães' WHERE id = 'b21f0890-c139-40a3-b8fc-d26a338c264c' AND name_en IS NULL;  -- Магальяйнс, Габриэл [exact]
UPDATE cards SET name_en = 'Kacper Szymon Kozłowski' WHERE id = 'b246802a-ab1c-40c7-8633-08e8dbebe79b' AND name_en IS NULL;  -- Козловский, Кацпер (футболист) [exact]
UPDATE cards SET name_en = 'Pedro Antonio Porro Sauceda' WHERE id = 'b25520e9-d89f-420d-922e-a5f6dbdd5529' AND name_en IS NULL;  -- Порро, Педро [exact]
UPDATE cards SET name_en = 'Wilfredo Daniel Caballero Lazcano' WHERE id = 'b26f82e2-1eea-4eb1-81d1-0297dc2ac9b8' AND name_en IS NULL;  -- Кабальеро, Вильфредо [exact]
UPDATE cards SET name_en = 'Ethan Kwame Colm Raymond Ampadu' WHERE id = 'b294953b-ac22-4af2-b57a-4e964078e79d' AND name_en IS NULL;  -- Ампаду, Итан [exact]
UPDATE cards SET name_en = 'Conor Bradley' WHERE id = 'b2ccfc72-c2a1-4ad4-b215-aea8a8e7decc' AND name_en IS NULL;  -- Брэдли, Конор [exact]
UPDATE cards SET name_en = 'Clément Nicolas Laurent Lenglet' WHERE id = 'b2e7110b-426c-4008-87cb-559011b5925e' AND name_en IS NULL;  -- Лангле, Клеман [exact]
UPDATE cards SET name_en = 'Wout Felix Lina Faes' WHERE id = 'b324998a-b2aa-44f0-9000-21a5d08b167c' AND name_en IS NULL;  -- Фас, Ваут [exact]
UPDATE cards SET name_en = 'Nicolò Barella' WHERE id = 'b4031278-4041-43f9-bc52-4ab8b52231ff' AND name_en IS NULL;  -- Николо Барелла [canonical]
UPDATE cards SET name_en = 'Alessandro Florenzi' WHERE id = 'b480a824-2d27-41a0-8172-cad0babf87c4' AND name_en IS NULL;  -- Алессандро Флоренци [canonical]
UPDATE cards SET name_en = 'Phil Anthony Jones' WHERE id = 'b4e85a29-0bb1-46a5-b84a-9b673e6c1845' AND name_en IS NULL;  -- Джонс, Фил [exact]
UPDATE cards SET name_en = 'José Manuel Reina Páez' WHERE id = 'b4f4aa61-4664-4ded-84e5-88b5363e2f06' AND name_en IS NULL;  -- Пепе Рейна [canonical]
UPDATE cards SET name_en = 'Lazar Vujadin Samardžić' WHERE id = 'b559cbad-5e96-4418-b512-a1cd6d0d1761' AND name_en IS NULL;  -- Лазар Самарджич [canonical]
UPDATE cards SET name_en = 'Emiliano Buendía Stati' WHERE id = 'b5e28483-b7da-4eb7-8550-7c93106c9efe' AND name_en IS NULL;  -- Буэндия, Эмилиано [exact]
UPDATE cards SET name_en = 'Robert Lynch Sánchez' WHERE id = 'b61349bd-68d6-4ad2-a9c1-712e6551d35a' AND name_en IS NULL;  -- Санчес, Роберт [exact]
UPDATE cards SET name_en = 'Taylor Jay Harwood-Bellis' WHERE id = 'b632b8c5-79ca-4869-82f5-2e5436e1ecfb' AND name_en IS NULL;  -- Харвуд-Беллис, Тейлор [exact]
UPDATE cards SET name_en = 'Iyenoma Destiny Udogie' WHERE id = 'b6e51867-2122-4cfc-8f1b-2076f9324b5f' AND name_en IS NULL;  -- Удоджи, Дестини [exact]
UPDATE cards SET name_en = 'Lautaro Javier Martínez' WHERE id = 'b6e73770-ad85-4713-bcd5-87ec7c07cf02' AND name_en IS NULL;  -- Лаутаро Мартинес [canonical]
UPDATE cards SET name_en = 'Adam James Armstrong' WHERE id = 'b75c19f8-deea-4c9b-a978-41f54039151b' AND name_en IS NULL;  -- Армстронг, Адам (футболист) [exact]
UPDATE cards SET name_en = 'Pau Cubarsí Paredes' WHERE id = 'b7655764-3a72-434a-90e0-38481d4c7f00' AND name_en IS NULL;  -- Пау Кубарси [canonical]
UPDATE cards SET name_en = 'Hakim Ziyech' WHERE id = 'b76cd159-d31e-4213-a33e-644dd5c3f57b' AND name_en IS NULL;  -- Зиеш, Хаким [exact]
UPDATE cards SET name_en = 'Fabian Lukas Schär' WHERE id = 'b780b649-8cfd-48e1-9ad2-952d5aa5c76e' AND name_en IS NULL;  -- Шер, Фабиан [exact]
UPDATE cards SET name_en = 'Pape Matar Sarr' WHERE id = 'b7837675-5a44-4906-82eb-4e0135cdbc5d' AND name_en IS NULL;  -- Пап Матар Сарр [canonical]
UPDATE cards SET name_en = 'Marcin Bułka' WHERE id = 'b79f2da8-068b-4484-a0fb-31bba9c4a259' AND name_en IS NULL;  -- Марцин Булка [canonical]
UPDATE cards SET name_en = 'Anwar El Ghazi' WHERE id = 'b7be7f4f-740f-472c-8412-167583f7f8fd' AND name_en IS NULL;  -- Эль-Гази, Анвар [exact]
UPDATE cards SET name_en = 'Ebere Paul Onuachu' WHERE id = 'b7cfc2ed-c786-4519-a887-141d2502c249' AND name_en IS NULL;  -- Онуачу, Пол [exact]
UPDATE cards SET name_en = 'Mohamed Amine Elyounoussi' WHERE id = 'b8028a98-7687-4786-891d-c133dfda69df' AND name_en IS NULL;  -- Эльюнусси, Мохамед [exact]
UPDATE cards SET name_en = 'Rade Krunić' WHERE id = 'b81a22f1-7236-47c1-8040-cb5771235088' AND name_en IS NULL;  -- Раде Крунич [canonical]
UPDATE cards SET name_en = 'David de Gea Quintana' WHERE id = 'b8a1affc-4ab3-4cab-b801-e89e19294b09' AND name_en IS NULL;  -- Давид Де Хеа [canonical]
UPDATE cards SET name_en = 'Wout Weghorst' WHERE id = 'b8ce050e-5ff0-43b5-abd0-4188df04db41' AND name_en IS NULL;  -- Ваут Вегхорст [canonical]
UPDATE cards SET name_en = 'Luka Modrić' WHERE id = 'b8dc8d0a-75dd-4c06-897c-950ec057056a' AND name_en IS NULL;  -- Лука Модрич [canonical]
UPDATE cards SET name_en = 'Luis Fernando Díaz Marulanda' WHERE id = 'b8f679af-22ff-43af-a097-2a7515e30312' AND name_en IS NULL;  -- Диас, Луис Фернандо [exact]
UPDATE cards SET name_en = 'Luke Paul Hoare Shaw' WHERE id = 'b9fc0b6e-81af-49d7-a365-63696587cf8c' AND name_en IS NULL;  -- Шоу, Люк [exact]
UPDATE cards SET name_en = 'Matías Nicolás Viña Susperreguy' WHERE id = 'bac2810b-e062-4acc-adc3-f272297a3a5b' AND name_en IS NULL;  -- Винья, Матиас [exact]
UPDATE cards SET name_en = 'Ademola Lookman Olajade Alade Aylola Lookman' WHERE id = 'bc3522e6-f148-4a87-aae1-92288b200d86' AND name_en IS NULL;  -- Лукман, Адемола [exact]
UPDATE cards SET name_en = 'Pau Francisco Torres' WHERE id = 'bc478f72-3b7e-4861-9497-d372530c2aaf' AND name_en IS NULL;  -- Торрес, Пау [exact]
UPDATE cards SET name_en = 'David Olatukunbo Alaba' WHERE id = 'bc67503d-5e5b-4e4e-ab90-81148facb97b' AND name_en IS NULL;  -- Давид Алаба [canonical]
UPDATE cards SET name_en = 'Timothy Tarpeh Weah' WHERE id = 'bc6962f4-20a2-4f30-a446-ff8f82372969' AND name_en IS NULL;  -- Тимоти Веа [canonical]
UPDATE cards SET name_en = 'Giovani Lo Celso' WHERE id = 'bc766625-0709-46b2-86e7-6dfaa10f231f' AND name_en IS NULL;  -- Ло Чельсо, Джовани [exact]
UPDATE cards SET name_en = 'Robin Leon Koch' WHERE id = 'bcdb72ca-eebb-48b1-bde1-3a70c192f389' AND name_en IS NULL;  -- Кох, Робин [exact]
UPDATE cards SET name_en = 'Konstantinos Tsimikas' WHERE id = 'bcf2c0ff-0c1e-4a2a-9eaa-1c4c54108c3f' AND name_en IS NULL;  -- Цимикас, Константинос [exact]
UPDATE cards SET name_en = 'Jonjo Shelvey' WHERE id = 'bd6fca19-f2b3-4754-a61e-006ff5cb459a' AND name_en IS NULL;  -- Джонджо Шелви [canonical]
UPDATE cards SET name_en = 'Valentino Francisco Livramento' WHERE id = 'bd847885-1637-4415-8cfb-65811f6992a4' AND name_en IS NULL;  -- Ливраменто, Тино [exact]
UPDATE cards SET name_en = 'Daniel Maldini' WHERE id = 'bdaae697-04c7-4ff6-8a97-5082e08bf7dc' AND name_en IS NULL;  -- Даниэль Мальдини [canonical]
UPDATE cards SET name_en = 'Yerry Fernando Mina González' WHERE id = 'bef34019-4f48-4cb0-876f-2fe7f1b2aade' AND name_en IS NULL;  -- Мина, Ерри [exact]
UPDATE cards SET name_en = 'Kaoru Mitoma' WHERE id = 'bf5ce886-2e76-41fb-bd85-6ab057645557' AND name_en IS NULL;  -- Митома, Каору [exact]
UPDATE cards SET name_en = 'Antoine Serlom Semenyo' WHERE id = 'bfb6c456-75b6-4d41-a6cc-8c495cc378eb' AND name_en IS NULL;  -- Антуан Семеньо [canonical]
UPDATE cards SET name_en = 'Adama Traoré Diarra' WHERE id = 'bfc56a61-6c6a-4946-a6c8-97cc11c5f930' AND name_en IS NULL;  -- Траоре, Адама (испанский футболист) [exact]
UPDATE cards SET name_en = 'Jarrod Bowen' WHERE id = 'c04e8f75-4585-4dc8-bb9b-d7fcb7c49b86' AND name_en IS NULL;  -- Боуэн, Джаррод [exact]
UPDATE cards SET name_en = 'Pedro Lomba Neto' WHERE id = 'c072e845-e78f-4da8-95b0-429f159e0f82' AND name_en IS NULL;  -- Нету, Педру [exact]
UPDATE cards SET name_en = 'Florian Richard Wirtz' WHERE id = 'c0af4f65-c26b-4e9b-bb26-5312c2825410' AND name_en IS NULL;  -- Вирц, Флориан [exact]
UPDATE cards SET name_en = 'Matteo Darmian' WHERE id = 'c13b8f48-2611-4917-b708-2d6e54c334de' AND name_en IS NULL;  -- Маттео Дармиан [canonical]
UPDATE cards SET name_en = 'William Alain André Gabriel Saliba' WHERE id = 'c164f0b1-7add-4170-93db-509cea44dcf5' AND name_en IS NULL;  -- Вильям Салиба [canonical]
UPDATE cards SET name_en = 'Neal Maupay' WHERE id = 'c1b465f5-3fd5-4e59-a15e-19e74caf8339' AND name_en IS NULL;  -- Мопе, Нил [exact]
UPDATE cards SET name_en = 'Frenkie de Jong' WHERE id = 'c213377d-951f-4d9e-95eb-e3d7b4a06631' AND name_en IS NULL;  -- Френки Де Йонг [canonical]
UPDATE cards SET name_en = 'Jurriën David Norman Timber' WHERE id = 'c22a5a13-aa2d-4a89-ad25-6a19101cb27a' AND name_en IS NULL;  -- Тимбер, Юрриен [exact]
UPDATE cards SET name_en = 'Edward Keddar Nketiah' WHERE id = 'c27c14f5-7047-4500-8b1e-2562a1328ce1' AND name_en IS NULL;  -- Эдди Нкетиа [canonical]
UPDATE cards SET name_en = 'Jan Oblak' WHERE id = 'c28c0405-5618-464d-a225-00aa0a355071' AND name_en IS NULL;  -- Ян Облак [canonical]
UPDATE cards SET name_en = 'Alex Sandro Lobo Silva' WHERE id = 'c2b78759-ae33-49ec-8f1a-65a0e01bb8c5' AND name_en IS NULL;  -- Алекс Сандро [exact]
UPDATE cards SET name_en = 'Arda Güler' WHERE id = 'c32297a0-ff3a-4fa7-b3e4-18cad480c772' AND name_en IS NULL;  -- Арда Гюлер [canonical]
UPDATE cards SET name_en = 'Trent John Alexander-Arnold' WHERE id = 'c37d6be0-4aae-49c9-bd58-0fa979a013d6' AND name_en IS NULL;  -- Александер-Арнольд, Трент [exact]
UPDATE cards SET name_en = 'Jarell Amorin Quansah' WHERE id = 'c383bfc2-8b51-4c12-aa35-5fc8c5abe5c0' AND name_en IS NULL;  -- Куанса, Джарелл [exact]
UPDATE cards SET name_en = 'Alessandro Bastoni' WHERE id = 'c39a3b4c-011d-48c3-aced-fedf25a7f797' AND name_en IS NULL;  -- Алессандро Бастони [canonical]
UPDATE cards SET name_en = 'Daniel Nii Tackie Mensah Welbeck' WHERE id = 'c3a3477d-d2e8-4167-9c33-e1302864cc04' AND name_en IS NULL;  -- Уэлбек, Дэнни [exact]
UPDATE cards SET name_en = 'Marco Verratti' WHERE id = 'c3ef4764-eb45-4bd0-b845-c58b7cb65549' AND name_en IS NULL;  -- Марко Верратти [canonical]
UPDATE cards SET name_en = 'Pervis Josué Estupiñán Tenorio' WHERE id = 'c4010b8a-7381-4571-af4b-10fd4b652401' AND name_en IS NULL;  -- Первис Эступиньян [canonical]
UPDATE cards SET name_en = 'André Onana Onana' WHERE id = 'c4107718-bd7e-49e8-baf0-445d4896beb8' AND name_en IS NULL;  -- Онана, Андре [exact]
UPDATE cards SET name_en = 'Deniz Undav' WHERE id = 'c450427b-ec1e-4a3b-9854-9e9f95ca7259' AND name_en IS NULL;  -- Ундав, Дениз [exact]
UPDATE cards SET name_en = 'Nikola Vlašić' WHERE id = 'c45a1efa-a0d3-4d1c-a167-6442e5dee4da' AND name_en IS NULL;  -- Никола Влашич [canonical]
UPDATE cards SET name_en = 'Patrick Cutrone' WHERE id = 'c51a628c-98ba-4c02-8186-074a08cf425f' AND name_en IS NULL;  -- Кутроне, Патрик [exact]
UPDATE cards SET name_en = 'Diego Carlos Santos Silva' WHERE id = 'c5344eef-9e34-45d1-9c0c-955a8eb82dc1' AND name_en IS NULL;  -- Диего Карлос (футболист, 1993) [exact]
UPDATE cards SET name_en = 'Raúl Albiol i Tortajada' WHERE id = 'c548fdc3-4baf-49a4-9819-8e03fe3116c6' AND name_en IS NULL;  -- Рауль Альбиоль [canonical]
UPDATE cards SET name_en = 'Dazet Wilfried Armel Zaha' WHERE id = 'c5ab83b3-3347-4d4f-b3fb-a1a5f68fa7ba' AND name_en IS NULL;  -- Заа, Вильфрид [exact]
UPDATE cards SET name_en = 'Kepa Arrizabalaga Revuelta' WHERE id = 'c5d8f9a3-65f5-4026-bc01-8f050c35d106' AND name_en IS NULL;  -- Кепа Аррисабалага [canonical]
UPDATE cards SET name_en = 'Phil Anthony Jones' WHERE id = 'c6041d85-44c5-415f-9c5e-bb417336d2e7' AND name_en IS NULL;  -- Фил Джонс [canonical]
UPDATE cards SET name_en = 'Kyle Andrew Walker' WHERE id = 'c62bfd1b-2f64-4203-b93b-a99bf474428f' AND name_en IS NULL;  -- Уокер, Кайл [exact]
UPDATE cards SET name_en = 'Daniel William John Ings' WHERE id = 'c662a1ca-323c-47cd-bd65-7dd67c72dd6c' AND name_en IS NULL;  -- Ингз, Дэнни [exact]
UPDATE cards SET name_en = 'Raheem Shaquille Sterling' WHERE id = 'c6c105bc-8419-47aa-a4dd-cc20eacd3adc' AND name_en IS NULL;  -- Рахим Стерлинг [canonical]
UPDATE cards SET name_en = 'Mateus Cardoso Lemos Martins' WHERE id = 'c6ee8f04-0391-4399-8a9a-a6c5c26fcef0' AND name_en IS NULL;  -- Тете (футболист, 2000) [exact]
UPDATE cards SET name_en = 'Duje Ćaleta-Car' WHERE id = 'c71a6438-d255-4aa0-854d-92224d798ca2' AND name_en IS NULL;  -- Чалета-Цар, Дуе [exact]
UPDATE cards SET name_en = 'Dean Donny Huijsen' WHERE id = 'c7d30d92-c069-4a9a-b215-c043f0db1975' AND name_en IS NULL;  -- Дин Хёйсен [canonical]
UPDATE cards SET name_en = 'Patson Daka' WHERE id = 'c807beac-a927-40e7-a9c6-a0ac805a8d3e' AND name_en IS NULL;  -- Дака, Патсон [exact]
UPDATE cards SET name_en = 'Ângelo Gabriel Borges Damaceno' WHERE id = 'c856d96c-befb-4928-a2d5-94f76d86e1c9' AND name_en IS NULL;  -- Анжело Габриэл [exact]
UPDATE cards SET name_en = 'Folarin Jerry Balogun' WHERE id = 'c8615f26-57e3-4e48-8f1c-2b71133f9e09' AND name_en IS NULL;  -- Балоган, Фоларин [exact]
UPDATE cards SET name_en = 'Bamidele Jermaine Alli' WHERE id = 'c8e52d53-832c-470c-b838-bf0a802911b1' AND name_en IS NULL;  -- Деле Алли [canonical]
UPDATE cards SET name_en = 'Victor Jörgen Nilsson Lindelöf' WHERE id = 'c8f73fe0-96e6-40b8-929b-b1be4313defa' AND name_en IS NULL;  -- Линделёф, Виктор [exact]
UPDATE cards SET name_en = 'Marco Sportiello' WHERE id = 'c8fe5265-2db6-4df3-9632-40ce7e6b6ef9' AND name_en IS NULL;  -- Марко Спортьелло [canonical]
UPDATE cards SET name_en = 'Dean Bradley Henderson' WHERE id = 'c958b259-67fd-4212-8747-069f1e653cd3' AND name_en IS NULL;  -- Хендерсон, Дин [exact]
UPDATE cards SET name_en = 'Nikola Milenković' WHERE id = 'c9a15b36-1735-47d6-869e-daf43173dbbb' AND name_en IS NULL;  -- Никола Миленкович [canonical]
UPDATE cards SET name_en = 'Liam David Ian Cooper' WHERE id = 'c9e42ebe-f544-44b0-b7f2-a7a686f576c8' AND name_en IS NULL;  -- Купер, Лиам [exact]
UPDATE cards SET name_en = 'Fábio Leandro Freitas Gouveia de Carvalho' WHERE id = 'c9e9abf6-0371-463f-986a-49950f957342' AND name_en IS NULL;  -- Карвалью, Фабиу [exact]
UPDATE cards SET name_en = 'Nayef Aguerd' WHERE id = 'c9eb11a9-1228-4faf-aa03-d5dd48961771' AND name_en IS NULL;  -- Агерд, Найеф [exact]
UPDATE cards SET name_en = 'Ionuț Andrei Radu' WHERE id = 'ca1ecc31-4b14-43b3-8275-0d2ffffadd61' AND name_en IS NULL;  -- Раду, Йонуц [exact]
UPDATE cards SET name_en = 'Joelinton Cássio Apolinário de Lira' WHERE id = 'ca3920d0-7129-477a-b64f-2378c6cc4774' AND name_en IS NULL;  -- Жоэлинтон [exact]
UPDATE cards SET name_en = 'Divock Okoth Origi' WHERE id = 'ca3f9b6d-2b63-4d32-8e77-5e3fcdc9dd03' AND name_en IS NULL;  -- Ориги, Дивок [exact]
UPDATE cards SET name_en = 'Yunus Akgün' WHERE id = 'ca4001dd-56c2-46c4-8733-d2274463c0ed' AND name_en IS NULL;  -- Акгюн, Юнус [exact]
UPDATE cards SET name_en = 'Samuel Joseph Szmodics' WHERE id = 'cafc2cb3-ec71-464b-b602-1bf5b880d92e' AND name_en IS NULL;  -- Смодикс, Сэмми [exact]
UPDATE cards SET name_en = 'Abdul Rahman Baba' WHERE id = 'cb213c22-7a6a-43dc-8c62-7f0ef9fa8316' AND name_en IS NULL;  -- Баба, Абдул Рахман [exact]
UPDATE cards SET name_en = 'Jannik Vestergaard' WHERE id = 'cbe60dd1-6bd9-4e0d-b48c-d0cdaa6f6ed0' AND name_en IS NULL;  -- Вестергор, Янник [exact]
UPDATE cards SET name_en = 'Fodé Ballo-Touré' WHERE id = 'cc126bb6-c58e-4a52-90c0-4e8f303a13c0' AND name_en IS NULL;  -- Балло-Туре, Фоде [exact]
UPDATE cards SET name_en = 'Matthew Charles Turner' WHERE id = 'cc144c49-7441-45a4-afe7-007f8f7d2c14' AND name_en IS NULL;  -- Тернер, Мэтт [exact]
UPDATE cards SET name_en = 'Armel Bella-Kotchap' WHERE id = 'cc3b5e29-09b6-4f0e-a14f-9d97ac6f4d64' AND name_en IS NULL;  -- Белла-Кочап, Армель [exact]
UPDATE cards SET name_en = 'Sergio Reguilón Rodríguez' WHERE id = 'cc725800-4870-4284-94cf-3328ffbdf14b' AND name_en IS NULL;  -- Регилон, Серхио [exact]
UPDATE cards SET name_en = 'Oliver George Arthur Watkins' WHERE id = 'cc7f55e8-788c-4b80-b95a-d94921e71299' AND name_en IS NULL;  -- Олли Уоткинс [canonical]
UPDATE cards SET name_en = 'José Salomón Rondón Giménez' WHERE id = 'cca4595a-cb4c-4a60-bc3e-bcaca6a9cd79' AND name_en IS NULL;  -- Рондон, Хосе Саломон [exact]
UPDATE cards SET name_en = 'Odysseas Vlachodimos' WHERE id = 'ccbdd903-6206-4914-a7c4-47a00e75eb08' AND name_en IS NULL;  -- Влаходимос, Одиссеас [exact]
UPDATE cards SET name_en = 'Jean-Clair Dimitri Roger Todibo' WHERE id = 'cd581748-236e-4cf8-a09d-3039db3b480f' AND name_en IS NULL;  -- Тодибо, Жан-Клер [exact]
UPDATE cards SET name_en = 'Lamine Yamal Nasraoui Ebana' WHERE id = 'cdbbc676-8f39-40ad-9db5-852370df7715' AND name_en IS NULL;  -- Ламин Ямаль [exact]
UPDATE cards SET name_en = 'Benjamin William White' WHERE id = 'ce7897a7-b06d-4e6b-987d-c3f48a7a9538' AND name_en IS NULL;  -- Уайт, Бен [exact]
UPDATE cards SET name_en = 'Mason Will John Greenwood' WHERE id = 'cee65ce2-4faf-4c1e-bb34-6b5295e63a54' AND name_en IS NULL;  -- Гринвуд, Мейсон [exact]
UPDATE cards SET name_en = 'Tyrell Johannes Chicco Malacia' WHERE id = 'cf09e0dc-3209-4abe-9607-218f59a1fb14' AND name_en IS NULL;  -- Маласия, Тайрелл [exact]
UPDATE cards SET name_en = 'Brenden Russell Aaronson' WHERE id = 'cf4fa7e8-12b5-4608-9531-9fdf0de976a9' AND name_en IS NULL;  -- Эронсон, Бренден [exact]
UPDATE cards SET name_en = 'Yunus Dimoara Musah' WHERE id = 'cf8a0a8f-cb99-4f8b-a420-8339ffcf3560' AND name_en IS NULL;  -- Юнус Муса [canonical]
UPDATE cards SET name_en = 'Karim Mostafa Benzema' WHERE id = 'cfdf8fbf-2953-4e9f-bbac-2e77f9f6c707' AND name_en IS NULL;  -- Карим Бензема [canonical]
UPDATE cards SET name_en = 'Lloyd Casius Kelly' WHERE id = 'd083afe2-d31c-4c7b-a4c8-1139f065f743' AND name_en IS NULL;  -- Келли, Ллойд [exact]
UPDATE cards SET name_en = 'Ethan Shea Horvath' WHERE id = 'd0fc1cab-5f47-4ef0-a435-0646242d1e8a' AND name_en IS NULL;  -- Хорват, Итан [exact]
UPDATE cards SET name_en = 'Malo Gusto' WHERE id = 'd19e7174-cef2-4a07-b9d3-7d197e970c38' AND name_en IS NULL;  -- Гюсто, Мало [exact]
UPDATE cards SET name_en = 'Raheem Shaquille Sterling' WHERE id = 'd1b65a2a-395b-427b-9805-7374a9977f57' AND name_en IS NULL;  -- Стерлинг, Рахим [exact]
UPDATE cards SET name_en = 'Joško Gvardiol' WHERE id = 'd211e924-8bea-4e39-bc3b-a2c5e4d54ec7' AND name_en IS NULL;  -- Йошко Гвардиол [canonical]
UPDATE cards SET name_en = 'Maghnes Akliouche' WHERE id = 'd26be515-6c04-45c0-b6d9-538d5c837307' AND name_en IS NULL;  -- Манес Аклиуш [canonical]
UPDATE cards SET name_en = 'Mikkel Krogh Damsgaard' WHERE id = 'd29c5649-6cdc-40e8-a409-25b6cd7ce062' AND name_en IS NULL;  -- Дамсгор, Миккель [exact]
UPDATE cards SET name_en = 'Idrissa Gana Gueye' WHERE id = 'd2c43b66-8fe0-4ed8-b23a-9d5d69f62b41' AND name_en IS NULL;  -- Гейе, Идрисса [exact]
UPDATE cards SET name_en = 'Loris Sven Karius' WHERE id = 'd3187851-282d-4981-b204-18b95796da90' AND name_en IS NULL;  -- Кариус, Лорис [exact]
UPDATE cards SET name_en = 'Stephy Alvaro Mavididi' WHERE id = 'd33ba808-73f0-421a-a671-dc2eb6e53bf2' AND name_en IS NULL;  -- Мавидиди, Стефи [exact]
UPDATE cards SET name_en = 'Oriol Romeu Vidal' WHERE id = 'd35a11d0-0b10-4e06-87b7-37dac0f68d9a' AND name_en IS NULL;  -- Ромеу, Ориоль [exact]
UPDATE cards SET name_en = 'Martin Ødegaard' WHERE id = 'd363888e-92a8-49a3-b6ab-abcaa5503710' AND name_en IS NULL;  -- Эдегор, Мартин [exact]
UPDATE cards SET name_en = 'Kevin Volland' WHERE id = 'd3af346c-fea8-4a31-9117-649ae1092a77' AND name_en IS NULL;  -- Кевин Фолланд [canonical]
UPDATE cards SET name_en = 'Máximo Perrone' WHERE id = 'd3ea25fe-e47d-46bc-acd7-01ec9787239d' AND name_en IS NULL;  -- Перроне, Максимо [exact]
UPDATE cards SET name_en = 'Robin Patrick Olsen' WHERE id = 'd418daaf-d67d-4f0a-bb66-ef85eb3fd881' AND name_en IS NULL;  -- Ульсен, Робин [exact]
UPDATE cards SET name_en = 'Dominik Szoboszlai' WHERE id = 'd4322397-c9e3-4e29-9313-72bbe15e1043' AND name_en IS NULL;  -- Собослаи, Доминик [exact]
UPDATE cards SET name_en = 'Sèrge Alain Stéphane Aurier' WHERE id = 'd4d3c6d1-fb5c-42f5-bc4e-22d7285b0877' AND name_en IS NULL;  -- Орье, Серж [exact]
UPDATE cards SET name_en = 'Raúl Alonso Jiménez Rodríguez' WHERE id = 'd4e7a547-9538-48e0-be2d-6057c52afeff' AND name_en IS NULL;  -- Хименес, Рауль (футболист) [exact]
UPDATE cards SET name_en = 'Roberto Firmino Barbosa de Oliveira' WHERE id = 'd55a5263-2808-45c6-a263-4991c6c3c268' AND name_en IS NULL;  -- Роберто Фирмино [exact]
UPDATE cards SET name_en = 'Oscar Bobb' WHERE id = 'd607ab9b-a24a-4e06-9f21-eee0246c89f6' AND name_en IS NULL;  -- Бобб, Оскар [exact]
UPDATE cards SET name_en = 'Manuel Ugarte Ribeiro' WHERE id = 'd617c84d-7933-4a0b-b527-62e99a21f04d' AND name_en IS NULL;  -- Угарте, Мануэль (футболист) [exact]
UPDATE cards SET name_en = 'Enzo Jeremías Fernández' WHERE id = 'd652e531-2aaf-45b0-acc7-60c818cc6b69' AND name_en IS NULL;  -- Энцо Фернандес [canonical]
UPDATE cards SET name_en = 'Étienne René Capoue' WHERE id = 'd6665572-84f0-43c3-8977-60a50b4293a0' AND name_en IS NULL;  -- Этьен Капу [canonical]
UPDATE cards SET name_en = 'Wout Weghorst' WHERE id = 'd66f78fb-210c-4fe1-af08-b6b5b6cab708' AND name_en IS NULL;  -- Вегхорст, Ваут [exact]
UPDATE cards SET name_en = 'Cole Jermaine Palmer' WHERE id = 'd6dc13cc-0944-4e0e-a887-93fa3747dab8' AND name_en IS NULL;  -- Коул Палмер [canonical]
UPDATE cards SET name_en = 'Diego da Silva Costa' WHERE id = 'd6dc66e9-afa0-4039-9c4e-e36ca38f8efa' AND name_en IS NULL;  -- Коста, Диего [exact]
UPDATE cards SET name_en = 'Jamie Richard Vardy' WHERE id = 'd7ae61c6-cfb0-40b2-945e-e26536ca5052' AND name_en IS NULL;  -- Варди, Джейми [exact]
UPDATE cards SET name_en = 'Kasper Peter Schmeichel' WHERE id = 'd7c27946-65de-45bd-a3aa-3e7ab8556e40' AND name_en IS NULL;  -- Каспер Шмейхель [canonical]
UPDATE cards SET name_en = 'Carlos Henrique Casimiro' WHERE id = 'd851f0d1-bcf0-4691-9b50-9589d1bed0af' AND name_en IS NULL;  -- Каземиро [exact]
UPDATE cards SET name_en = 'Samy Sayed Morsy' WHERE id = 'd854833f-77ae-4648-89a5-f15bb108e50f' AND name_en IS NULL;  -- Морси, Сэм [exact]
UPDATE cards SET name_en = 'Andrey Nascimento dos Santos' WHERE id = 'd8f80737-4bca-4de1-b500-5e8384aeed32' AND name_en IS NULL;  -- Сантос, Андрей [exact]
UPDATE cards SET name_en = 'Denzel Justus Morris Dumfries' WHERE id = 'd9c574a1-9178-4a4b-bdbb-0468d7781974' AND name_en IS NULL;  -- Дензел Дюмфрис [canonical]
UPDATE cards SET name_en = 'Harry Edward Kane' WHERE id = 'd9dbb003-e10b-4cbe-8945-86fc2355e6fd' AND name_en IS NULL;  -- Кейн, Гарри [exact]
UPDATE cards SET name_en = 'Guido Rodríguez' WHERE id = 'da048b1e-98cc-4ed2-9a44-991e37aab7dd' AND name_en IS NULL;  -- Родригес, Гидо [exact]
UPDATE cards SET name_en = 'Ángel Fabián Di María Hernández' WHERE id = 'da107f65-8dd0-45a3-a5c0-bc5cd0db44e1' AND name_en IS NULL;  -- Анхель Ди Мария [canonical]
UPDATE cards SET name_en = 'Anssumane Fati Vieira' WHERE id = 'da15a686-6206-43e3-8e0b-06c1e9b6b0fc' AND name_en IS NULL;  -- Фати, Ансу [exact]
UPDATE cards SET name_en = 'Archie James Francis Gray' WHERE id = 'da1df85e-d9a9-4d3b-8f3f-f4808730e700' AND name_en IS NULL;  -- Арчи Грей [canonical]
UPDATE cards SET name_en = 'Oliver George Arthur Watkins' WHERE id = 'da2d5bcc-94ab-4cec-80e5-8dd4d8b0edb9' AND name_en IS NULL;  -- Уоткинс, Олли [exact]
UPDATE cards SET name_en = 'Granit Xhaka' WHERE id = 'da6a5b5f-7e47-4e14-9147-cb5393fd8b7c' AND name_en IS NULL;  -- Гранит Джака [canonical]
UPDATE cards SET name_en = 'Jack Frank Porteous Cork' WHERE id = 'da90de6f-54a9-4895-9902-bc881f765eca' AND name_en IS NULL;  -- Корк, Джек [exact]
UPDATE cards SET name_en = 'Omari Elijah Giraud-Hutchinson' WHERE id = 'db66bdff-2cc2-4ce9-9a53-54756e18ad1d' AND name_en IS NULL;  -- Омари Хатчинсон [canonical]
UPDATE cards SET name_en = 'Adam James Wharton' WHERE id = 'db9f3c9e-8be7-493c-a3ce-57b1ef9fb4a0' AND name_en IS NULL;  -- Уортон, Адам [exact]
UPDATE cards SET name_en = 'Bryan Cristante' WHERE id = 'dbb813c8-ea6a-4df4-a6bc-e3306b18151b' AND name_en IS NULL;  -- Брайан Кристанте [canonical]
UPDATE cards SET name_en = 'Matthew James Doherty' WHERE id = 'dbc15bb4-6bbf-432d-9bcd-4dff2f66fe9d' AND name_en IS NULL;  -- Доэрти, Мэтт [exact]
UPDATE cards SET name_en = 'Faustino Adebola Rasheed Anjorin' WHERE id = 'dc0815d9-9f44-43d1-9196-00200bc622ac' AND name_en IS NULL;  -- Анджорин, Тино [exact]
UPDATE cards SET name_en = 'Benoît Ntambue Badiashile Mukinayi Baya' WHERE id = 'dcf36b5b-95d0-4718-be94-c7d738e9e78c' AND name_en IS NULL;  -- Бадьяшиль, Бенуа [exact]
UPDATE cards SET name_en = 'Bernardo Mota Veiga de Carvalho e Silva' WHERE id = 'dd4311b8-266d-4e65-b980-beab8b8c58ae' AND name_en IS NULL;  -- Бернарду Силва [canonical]
UPDATE cards SET name_en = 'Jorge Luiz Frello Filho' WHERE id = 'de6b1158-1f25-40ed-bd4b-b66ac369bba6' AND name_en IS NULL;  -- Жоржиньо (итальянский футболист) [exact]
UPDATE cards SET name_en = 'Cristian Gabriel Romero' WHERE id = 'df05ece9-24ad-4323-b8a1-c50f44442ead' AND name_en IS NULL;  -- Ромеро, Кристиан [exact]
UPDATE cards SET name_en = 'Andrej Kramarić' WHERE id = 'df0851da-ad98-4b5a-b3a0-14ff0892ff12' AND name_en IS NULL;  -- Андрей Крамарич [canonical]
UPDATE cards SET name_en = 'Jack Robinson' WHERE id = 'dfdbbd3b-e882-44a6-a87c-0ad472948667' AND name_en IS NULL;  -- Робинсон, Джек (футболист, 1870) [exact]
UPDATE cards SET name_en = 'Scott Paul Carson' WHERE id = 'dff7dfb8-7588-4a87-ac35-da39bdc053d1' AND name_en IS NULL;  -- Карсон, Скотт [exact]
UPDATE cards SET name_en = 'Alexandre Moreno Lopera' WHERE id = 'e0552d6b-33ff-4746-ae75-b86ea0dc0ba3' AND name_en IS NULL;  -- Морено, Алехандре [exact]
UPDATE cards SET name_en = 'Mohamed Salah Hamed Mahrous Ghaly' WHERE id = 'e0557867-3ae9-4d86-94c8-686fc85094de' AND name_en IS NULL;  -- Мохаммед Салах [exact]
UPDATE cards SET name_en = 'Ezri Konsa Ngoyo' WHERE id = 'e06fa9e4-b8e9-4587-9193-794396e9a40c' AND name_en IS NULL;  -- Конса, Эзри [exact]
UPDATE cards SET name_en = 'Jonathan Grant Evans' WHERE id = 'e0dad030-f2c7-421e-aaf4-4e7d114bca01' AND name_en IS NULL;  -- Джонни Эванс [canonical]
UPDATE cards SET name_en = 'Jeremie Agyekum Frimpong' WHERE id = 'e0dc9a69-bc13-4694-86e7-d4c3257619a9' AND name_en IS NULL;  -- Фримпонг, Джереми [exact]
UPDATE cards SET name_en = 'Ashley Simon Young' WHERE id = 'e0fcdf52-28fc-4116-ab48-3b29c2c2e532' AND name_en IS NULL;  -- Эшли Янг [canonical]
UPDATE cards SET name_en = 'Alejandro Garnacho Ferreyra' WHERE id = 'e2802cc6-4c3b-40cd-b0ef-604b2bdff454' AND name_en IS NULL;  -- Гарначо, Алехандро [exact]
UPDATE cards SET name_en = 'Wataru Endo' WHERE id = 'e2bed9b4-1229-4a4a-a558-21a521ce06ee' AND name_en IS NULL;  -- Эндо, Ватару [exact]
UPDATE cards SET name_en = 'Mohamed Saïd Benrahma' WHERE id = 'e2ec9ca9-778a-4569-8500-8eea16530b53' AND name_en IS NULL;  -- Бенрахма, Саид [exact]
UPDATE cards SET name_en = 'Jude Victor William Bellingham' WHERE id = 'e2f4c572-69bf-4d89-b19f-6b886174fff0' AND name_en IS NULL;  -- Джуд Беллингем [canonical]
UPDATE cards SET name_en = 'Ivo Grbić' WHERE id = 'e30ddbb6-7446-4d70-bf29-27b0b1843795' AND name_en IS NULL;  -- Грбич, Иво [exact]
UPDATE cards SET name_en = 'Youri Marion A. Tielemans' WHERE id = 'e323e977-08b3-4a6f-b7fb-2215378da615' AND name_en IS NULL;  -- Юри Тилеманс [canonical]
UPDATE cards SET name_en = 'Joshua Walter Kimmich' WHERE id = 'e376ba1f-22b5-45c7-a694-9f4964f701e4' AND name_en IS NULL;  -- Йозуа Киммих [canonical]
UPDATE cards SET name_en = 'Kevin Schade' WHERE id = 'e37b0a97-4d08-4390-984a-ceddc4038779' AND name_en IS NULL;  -- Шаде, Кевин [exact]
UPDATE cards SET name_en = 'Caoimhín Odhrán Kelleher' WHERE id = 'e3c972c6-3ab8-4e38-b9e8-c13b951d11d3' AND name_en IS NULL;  -- Келлехер, Куивин [exact]
UPDATE cards SET name_en = 'Kouassi Ryan Sessegnon' WHERE id = 'e48b7653-bf3f-4e37-b951-ca812a3ae60f' AND name_en IS NULL;  -- Сессеньон, Райан [exact]
UPDATE cards SET name_en = 'Sadio Mané' WHERE id = 'e4a4e4b8-5118-4e63-b6aa-6dea9f62b065' AND name_en IS NULL;  -- Мане, Садио [exact]
UPDATE cards SET name_en = 'Trent John Alexander-Arnold' WHERE id = 'e520ad0e-5984-4775-a995-0d6081a0dbc4' AND name_en IS NULL;  -- Трент Александер-Арнольд [canonical]
UPDATE cards SET name_en = 'Jack David Harrison' WHERE id = 'e5c86ee6-4787-4869-91ba-456f041b8b6a' AND name_en IS NULL;  -- Харрисон, Джек [exact]
UPDATE cards SET name_en = 'Jakub Piotr Kiwior' WHERE id = 'e5d6421b-0797-492f-bcf9-8adb49db9a0c' AND name_en IS NULL;  -- Кивёр, Якуб [exact]
UPDATE cards SET name_en = 'Kalvin Mark Phillips' WHERE id = 'e6524cf5-a49e-4135-ad1f-3a94bf4ea1b5' AND name_en IS NULL;  -- Филлипс, Калвин [exact]
UPDATE cards SET name_en = 'Daniel Castelo Podence' WHERE id = 'e680e551-a4b3-4073-afb6-f1a4c08cf951' AND name_en IS NULL;  -- Поденсе, Даниэл [exact]
UPDATE cards SET name_en = 'Lucas Rodrigues Moura da Silva' WHERE id = 'e7a17c38-804f-4028-9bb4-1b9b01db7cdc' AND name_en IS NULL;  -- Моура, Лукас [exact]
UPDATE cards SET name_en = 'Mark Noble' WHERE id = 'e7e7439f-1522-4dc8-a572-1adb0d12659d' AND name_en IS NULL;  -- Нобл, Марк [exact]
UPDATE cards SET name_en = 'Nicolò Zaniolo' WHERE id = 'e85fad34-8000-47c2-8884-98999929885f' AND name_en IS NULL;  -- Дзаньоло, Николо [exact]
UPDATE cards SET name_en = 'Willy-Arnaud Zobo Boly' WHERE id = 'e876ea94-8985-4af6-a00d-95cab3963cf9' AND name_en IS NULL;  -- Боли, Вилли [exact]
UPDATE cards SET name_en = 'Dominic Ayodele Solanke-Mitchell' WHERE id = 'e8ca067e-96b6-4720-bf5d-480f0ddba4ac' AND name_en IS NULL;  -- Соланке, Доминик [exact]
UPDATE cards SET name_en = 'Mohammed Kudus' WHERE id = 'e98f3111-afd4-42f7-bc82-8328b0543ec8' AND name_en IS NULL;  -- Мохаммед Кудус [canonical]
UPDATE cards SET name_en = 'Abdoulaye Doucouré' WHERE id = 'e99ff287-ec29-491a-a0b1-012f00bdf62a' AND name_en IS NULL;  -- Дукуре, Абдулай [exact]
UPDATE cards SET name_en = 'Marc Kevin Albrighton' WHERE id = 'ea484117-cfc3-4b98-93fa-01f3c58df4a7' AND name_en IS NULL;  -- Олбрайтон, Марк [exact]
UPDATE cards SET name_en = 'Christopher Alan Nkunku' WHERE id = 'eb2e646c-569f-4908-9c89-2a7c0444af9e' AND name_en IS NULL;  -- Нкунку, Кристофер [exact]
UPDATE cards SET name_en = 'Andros Darryl Townsend' WHERE id = 'eb3dc951-cb08-46c0-9ff9-8a221bb52f99' AND name_en IS NULL;  -- Таунсенд, Андрос [exact]
UPDATE cards SET name_en = 'Marcus Rashford' WHERE id = 'eb536f7f-e740-4ed3-b55b-be361fca830d' AND name_en IS NULL;  -- Рашфорд, Маркус [exact]
UPDATE cards SET name_en = 'Willian Borges da Silva' WHERE id = 'ebd9181e-641e-4068-adf5-0b03a2ab6e66' AND name_en IS NULL;  -- Виллиан (футболист) [exact]
UPDATE cards SET name_en = 'Hannibal Mejbri' WHERE id = 'ebe1c4cd-16fb-4b8d-b49c-b6390f96c031' AND name_en IS NULL;  -- Межбри, Ханнибал [exact]
UPDATE cards SET name_en = 'Fraser Gerard Forster' WHERE id = 'ec1dd60b-445a-4bcf-9064-9d084aab62d4' AND name_en IS NULL;  -- Форстер, Фрейзер [exact]
UPDATE cards SET name_en = 'Ko Itakura' WHERE id = 'ec2d64da-93b7-4c96-9fc6-c788fd4d67f6' AND name_en IS NULL;  -- Итакура, Ко [exact]
UPDATE cards SET name_en = 'Nicolò Zaniolo' WHERE id = 'ecbce60a-1d5c-41c3-ab6e-58fa25784245' AND name_en IS NULL;  -- Николо Дзаньоло [canonical]
UPDATE cards SET name_en = 'Stefan Ortega Moreno' WHERE id = 'eccff7e0-1cac-48c5-b7b4-7f6a80555e50' AND name_en IS NULL;  -- Ортега, Штефан [exact]
UPDATE cards SET name_en = 'Manuel Peter Neuer' WHERE id = 'ecd001db-029d-4f2c-b780-df80f3958dce' AND name_en IS NULL;  -- Мануэль Нойер [canonical]
UPDATE cards SET name_en = 'Mathys Henri Tel' WHERE id = 'ecd282e8-1d8c-462d-8a01-9980da4c1ecc' AND name_en IS NULL;  -- Тель, Матис [exact]
UPDATE cards SET name_en = 'Youri Marion A. Tielemans' WHERE id = 'ed041878-9d96-47ad-a1b1-e402b9ada3c7' AND name_en IS NULL;  -- Тилеманс, Юри [exact]
UPDATE cards SET name_en = 'Daley Blind' WHERE id = 'ed57609e-f1b5-41e7-ab3c-42df07aec43b' AND name_en IS NULL;  -- Дейли Блинд [canonical]
UPDATE cards SET name_en = 'Giovanni Alejandro Reyna' WHERE id = 'ee10972f-b7a8-4263-bb40-159cd9352bdd' AND name_en IS NULL;  -- Рейна, Джованни [exact]
UPDATE cards SET name_en = 'Job Joël André Matip' WHERE id = 'ee7751e0-c9f6-463c-9848-b30f12c89bb5' AND name_en IS NULL;  -- Матип, Жоэль [exact]
UPDATE cards SET name_en = 'Ashley Simon Young' WHERE id = 'eeadc18b-1d01-4895-abc5-13088a99cec4' AND name_en IS NULL;  -- Янг, Эшли [exact]
UPDATE cards SET name_en = 'Íñigo Martínez Berridi' WHERE id = 'eecc6c42-d9d0-4de7-826e-7a81fb1216d3' AND name_en IS NULL;  -- Иньиго Мартинес [canonical]
UPDATE cards SET name_en = 'Kingsley Junior Coman' WHERE id = 'ef467cfd-f864-4897-ba7d-b757dc6ee54d' AND name_en IS NULL;  -- Кингсли Коман [canonical]
UPDATE cards SET name_en = 'Kurt Happy Zouma' WHERE id = 'ef6ab49b-d15d-4dba-a75c-30edaa9e046a' AND name_en IS NULL;  -- Зума, Курт [exact]
UPDATE cards SET name_en = 'Ederson Santana de Moraes' WHERE id = 'eff00c92-e81b-4dc2-85c1-20af0ef5abb7' AND name_en IS NULL;  -- Сантана ди Мораес, Эдерсон [exact]
UPDATE cards SET name_en = 'Toni Kroos' WHERE id = 'f019431d-a314-44d7-8179-7a7ab7820408' AND name_en IS NULL;  -- Тони Кроос [canonical]
UPDATE cards SET name_en = 'Ryan Jiro Gravenberch' WHERE id = 'f042f681-3bcf-4f93-b1bf-53e56abc7119' AND name_en IS NULL;  -- Райан Гравенберх [canonical]
UPDATE cards SET name_en = 'Milan Škriniar' WHERE id = 'f0d5b93b-301a-4219-8c02-682607d8e615' AND name_en IS NULL;  -- Милан Шкриньяр [canonical]
UPDATE cards SET name_en = 'Ferdi Erenay Kadıoğlu' WHERE id = 'f1af142d-aa32-40af-b1a2-6e243bf7e017' AND name_en IS NULL;  -- Кадиоглу, Ферди [exact]
UPDATE cards SET name_en = 'Iliman Cheikh Baroy Ndiaye' WHERE id = 'f1bc898d-41cb-4af9-871a-b116d216cfeb' AND name_en IS NULL;  -- Ндиай, Илиман [exact]
UPDATE cards SET name_en = 'Claudio Andrés Bravo Muñoz' WHERE id = 'f1c62cb4-5ce7-476b-8cdf-94d1027acefe' AND name_en IS NULL;  -- Клаудио Браво [canonical]
UPDATE cards SET name_en = 'Christopher Grant Wood' WHERE id = 'f206c546-04b6-483b-80ac-8619bc2e0d78' AND name_en IS NULL;  -- Вуд, Крис (футболист) [exact]
UPDATE cards SET name_en = 'Héctor Junior Firpo Adames' WHERE id = 'f2321e66-4d46-4189-9832-ba8490c9c704' AND name_en IS NULL;  -- Фирпо, Хуниор [exact]
UPDATE cards SET name_en = 'Federico Chiesa' WHERE id = 'f29d7d19-f927-4329-8ccf-0b8c115fc149' AND name_en IS NULL;  -- Федерико Кьеза [canonical]
UPDATE cards SET name_en = 'Darwin Gabriel Núñez Ribeiro' WHERE id = 'f3566121-3b90-4b09-925a-f4dd1f699065' AND name_en IS NULL;  -- Дарвин Нуньес [canonical]
UPDATE cards SET name_en = 'Matthijs de Ligt' WHERE id = 'f3679310-1856-45b0-9c1c-aa46a43c1414' AND name_en IS NULL;  -- Де Лигт, Маттейс [exact]
UPDATE cards SET name_en = 'Joseph Dave Gomez' WHERE id = 'f3b9923b-e3c6-4367-9d37-0750f67d64dd' AND name_en IS NULL;  -- Гомес, Джозеф [exact]
UPDATE cards SET name_en = 'Kiernan Frank Dewsbury-Hall' WHERE id = 'f3de54e4-976c-4c25-a7dd-f1a3d0f16859' AND name_en IS NULL;  -- Дьюзбери-Холл, Кирнан [exact]
UPDATE cards SET name_en = 'Steven Charles Bergwijn' WHERE id = 'f48c803b-4223-43f6-80c1-8d23480de58d' AND name_en IS NULL;  -- Бергвейн, Стивен [exact]
UPDATE cards SET name_en = 'Francisco Román Alarcón Suárez' WHERE id = 'f4d17e81-5675-4da6-84ae-9dfb0c4d23ab' AND name_en IS NULL;  -- Иско [exact]
UPDATE cards SET name_en = 'Martin Dúbravka' WHERE id = 'f5677c54-d51c-438f-89a5-2ba294598474' AND name_en IS NULL;  -- Дубравка, Мартин [exact]
UPDATE cards SET name_en = 'Benjamin Mendy' WHERE id = 'f599e00c-66c1-4f9d-aaf2-20812e93e14c' AND name_en IS NULL;  -- Менди, Бенжамен [exact]
UPDATE cards SET name_en = 'Samuel Iling-Junior' WHERE id = 'f5a1d1c4-ead5-4aeb-ae5a-486acf6b6d3c' AND name_en IS NULL;  -- Илинг-Джуниор, Сэмьюэл [exact]
UPDATE cards SET name_en = 'Asmir Begović' WHERE id = 'f61683ce-81d5-492c-b56d-f1c3f3a585ef' AND name_en IS NULL;  -- Бегович, Асмир [exact]
UPDATE cards SET name_en = 'Franck Yannick Kessié' WHERE id = 'f63648b0-504a-485a-b8fa-e754b2327b99' AND name_en IS NULL;  -- Франк Кессье [canonical]
UPDATE cards SET name_en = 'Nemanja Matić' WHERE id = 'f666f128-b27e-4a54-8167-c217f80d9649' AND name_en IS NULL;  -- Неманья Матич [canonical]
UPDATE cards SET name_en = 'İlkay Gündoğan' WHERE id = 'f67b5d3a-cc66-46b1-9e77-d8747413f855' AND name_en IS NULL;  -- Гюндоган, Илкай [exact]
UPDATE cards SET name_en = 'Mason Tony Mount' WHERE id = 'f68b0347-31ee-4e64-87d2-765aec6bea2f' AND name_en IS NULL;  -- Маунт, Мейсон [exact]
UPDATE cards SET name_en = 'Reece Lewis James' WHERE id = 'f6f57e8f-98bc-4bf6-ba00-66da30aa6bfb' AND name_en IS NULL;  -- Джеймс, Рис (футболист, 1999) [exact]
UPDATE cards SET name_en = 'Pape Alassane Gueye' WHERE id = 'f7390952-cc41-4438-8611-25e50759e473' AND name_en IS NULL;  -- Пап Гейе [canonical]
UPDATE cards SET name_en = 'Roméo Lavia' WHERE id = 'f8010447-f0fc-4553-97df-91c8bf420c9a' AND name_en IS NULL;  -- Лавия, Ромео [exact]
UPDATE cards SET name_en = 'Matheus Santos Carneiro da Cunha' WHERE id = 'f815f907-6125-4028-a292-bf4f1b4f4d47' AND name_en IS NULL;  -- Кунья, Матеус [exact]
UPDATE cards SET name_en = 'Thibaut Nicolas Marc Courtois' WHERE id = 'f885332b-4421-41dd-bb0e-afd28f6a86c6' AND name_en IS NULL;  -- Тибо Куртуа [canonical]
UPDATE cards SET name_en = 'Cheikhou Kouyaté' WHERE id = 'f921ccdc-0d67-4f48-9157-06781a36fd68' AND name_en IS NULL;  -- Куяте, Шейху [exact]
UPDATE cards SET name_en = 'Kurt Happy Zouma' WHERE id = 'f97c98ff-5bfa-4e53-b9f9-8d8387ad3ae8' AND name_en IS NULL;  -- Курт Зума [canonical]
UPDATE cards SET name_en = 'Julian Brandt' WHERE id = 'f98ec49b-634b-41a4-902c-3081b7e3b638' AND name_en IS NULL;  -- Юлиан Брандт [canonical]
UPDATE cards SET name_en = 'Leny Yoro' WHERE id = 'fa0cca3a-0564-4c19-a961-2ec1526ea6ac' AND name_en IS NULL;  -- Йоро, Лени [exact]
UPDATE cards SET name_en = 'Rasmus Winther Højlund' WHERE id = 'fa887094-dfa5-4c23-acfa-394ae68dc944' AND name_en IS NULL;  -- Хёйлунн, Расмус [exact]
UPDATE cards SET name_en = 'Federico Dimarco' WHERE id = 'fc7cad1d-7c67-4d15-8ceb-f8ca1b30b8d4' AND name_en IS NULL;  -- Федерико Димарко [canonical]
UPDATE cards SET name_en = 'Keylor Antonio Navas Gamboa' WHERE id = 'fd4f742c-a5da-4716-a7f5-207e6b2ebdc4' AND name_en IS NULL;  -- Навас, Кейлор [exact]
UPDATE cards SET name_en = 'Thomas Strakosha' WHERE id = 'fd73552d-6486-4f41-949b-19ac48c93c61' AND name_en IS NULL;  -- Стракоша, Томас [exact]
UPDATE cards SET name_en = 'Nicolas Jackson' WHERE id = 'feaba073-b3d8-4f11-be17-067f2f4d9bc2' AND name_en IS NULL;  -- Джексон, Николас [exact]
UPDATE cards SET name_en = 'Theo James Walcott' WHERE id = 'ff3cc7bd-2b17-4b87-8cc6-791cbc1da696' AND name_en IS NULL;  -- Уолкотт, Тео [exact]
UPDATE cards SET name_en = 'Gianluigi Donnarumma' WHERE id = 'ff434e65-4c2f-448e-be74-644085fa1956' AND name_en IS NULL;  -- Джанлуиджи Доннарумма [canonical]
UPDATE cards SET name_en = 'Alexander Sørloth' WHERE id = 'ff47ef25-7ec5-4e5a-9692-bc5768f7431a' AND name_en IS NULL;  -- Александер Сёрлот [canonical]

-- NO MATCH in players_meta (stay NULL):
-- id 0017899b-ad2b-4696-b392-9c1637b8aa2c  name Сергей Рыжиков
-- id 003aec99-7d1f-4cc2-8238-f5572ef9d38a  name Тимур Сулейманов
-- id 0051f0da-7aab-44e0-a837-bef7696b22b8  name Анжело Перуцци
-- id 008f6bad-545f-4f47-8086-dfe6b9fb736b  name Войцех Ковалевски
-- id 00b8bacf-50e3-4192-a470-14f73b8d1981  name Марк Вильмотс
-- id 00c3ff3b-9ac3-4b04-b08f-d116420d511a  name Филиппо Индзаги
-- id 00d9450b-915f-4958-8a62-8fe6c751611a  name Филипп Мексес
-- id 0104403b-b056-48ed-9e3a-ecf1a9f7ea76  name Гаэтано Ширеа
-- id 013fae7d-0568-4a6d-a8b4-a4a979e491d0  name Алексей Ионов
-- id 0176b983-d80b-4dd1-a738-c8d2d01bb91a  name Олег Рябчук
-- id 017f41f3-4819-440c-ae08-965b541bc734  name Ривалдо
-- id 01a674b2-834c-4ca6-950a-4c7677f3a9a9  name Лилиан Тюрам
-- id 01a67917-e07d-45e5-a2c9-19b2a3638906  name Рауль
-- id 01c9d78c-fab7-4be7-ad25-79ae5a6d321d  name Таффарел
-- id 022bf996-3b4a-43d5-b360-cca02f3d7e1e  name Георги Миланов
-- id 023c6230-df69-4c4e-aeed-18d928467ecb  name Маурисио Перейра
-- id 023ec79f-ddbf-45b8-8678-c4c65d12b97a  name Юрий Лодыгин
-- id 02941060-bf13-40d4-a18e-a1bc835a467b  name Резиуан Мирзов
-- id 032cd763-38c2-4abc-bc35-8b6d5f4bda33  name Кайо
-- id 032d4aff-4c56-44dc-beeb-918f0c11eea3  name Йосип Иличич
-- id 033b7dcc-288e-4393-a08d-f77e7ebe95bd  name Сердар Таски
-- id 03654f07-00dc-4a04-9eea-aafb5198e494  name Владимир Быстров
-- id 03689949-46e3-4eba-9a66-174fc0cb33ec  name Артем Ребров
-- id 0383b2f7-eb1a-4e47-86ce-35515178fd07  name Исмаэль Дукуре
-- id 0385b967-2cac-4e62-adb6-f00408b6a57c  name Харри Кейн
-- id 03d1689a-8fb2-4376-828f-fcdbffaa1960  name Симао
-- id 03e0be4c-2043-47e4-8bf0-be48ff1beb4e  name Дмитрий Булыкин
-- id 040360fb-8801-42b4-b83e-2764663116ff  name Роман Шишкин
-- id 04085921-8355-4d46-9557-170964563c07  name Виктор Васин
-- id 0419f3bf-8086-48d8-b072-af006486e77d  name Адам Марушич
-- id 043b796a-9b1f-4f20-98ab-361a11d99b55  name Миралем Пьянич
-- id 047675cb-ac3e-42a6-bde4-31dc8917b7ec  name Солтмурад Бакаев
-- id 04a21074-3cb5-4ca1-9e7e-b598dae533de  name Майкл Эссьен
-- id 04f4d5a5-f62f-4ebb-82dd-48b70b3d125c  name Давид Оспина
-- id 04fe3b97-a260-4376-a255-b58d73208abd  name Скотт МакТоминэй
-- id 050577e9-592a-48d6-a4b2-ec723d72ae9e  name Джованни Ди Лоренцо
-- id 0549fa30-b4d7-4c89-9f9a-35cc70138af8  name Бенуа Ассу-Экото
-- id 0565be23-f7a2-450c-8590-4ce9f69a2687  name Алексей Игонин
-- id 05695ac6-58bf-493d-bacb-34a3ca342443  name Сергей Еременко
-- id 05b71aef-d001-4881-a53c-21708463ea91  name Юрий Дюпин
-- id 05cea5d3-1562-4152-936b-69375ae173f8  name Владимир Кулик
-- id 062dde6b-854b-44b1-9a59-db36ce28a256  name Джо Харт
-- id 0634f1f9-3f85-4569-aecb-705726768ca2  name Алессио Романьоли
-- id 06383f44-d940-45bd-a9d9-1c35dbf94a3d  name Жоазиньо
-- id 0656bc75-80c4-40f4-b4b2-2055dad65f09  name Мартин Палермо
-- id 065bed31-ea11-4383-9a28-4000c125de0d  name Виктор Дьёкереш
-- id 06866283-05f6-4d44-a9ed-29fdf29c65e8  name Александр Самедов
-- id 06d4d83a-764e-4c2c-8cf7-0adaadaeff32  name Жулио Сезар
-- id 06f7f15c-2ef9-47a2-892f-4d704f092e38  name Бруно Гимараэш
-- id 0742cafd-fb45-4d9f-a5e1-2877099e676c  name Жерзино Ньямси
-- id 077a869e-447b-4408-a00b-15985944dee5  name Карлос Тевес
-- id 07b3038a-69f0-4952-9c62-3972c8c3f64c  name Джермейн Дефо
-- id 07fecde2-d902-4b7f-bf1c-4f92020cffe0  name Станислав Агкацев
-- id 0804f7eb-9adb-4d59-bdee-bbc42da7d523  name Корентен Толиссо
-- id 080fd251-78a7-43b6-afba-bd22e72957fb  name Мохамед Эльнени
-- id 0823a2cc-73f4-46eb-9092-0ed21c74ce64  name Александр Беленов
-- id 088a303f-a284-4904-a5d6-b1a19597f903  name Оливье Жиру
-- id 08a26ad0-139d-4d8f-9032-e3024c5d154b  name Марио Фернандес
-- id 08b4b567-cbde-4954-8312-d73fd1a46f78  name Александр Головин
-- id 08c402ec-4196-45b1-a67b-db9c3ca5fcd2  name Йонас Хофманн
-- id 08ccfacf-4412-4ce8-bbb9-ff27fb1b6464  name Пол Робинсон
-- id 09137768-b664-4bbf-9cf2-da6f4dd9bbba  name Нкванкво Кану
-- id 09697278-5f37-477f-9557-bac4a05b304d  name Карлес Пуйоль
-- id 09941e7a-cbcd-459c-84ec-995ff32a8e30  name Сауль Гуарирапа
-- id 09bab305-1768-4eb6-bec1-fbab8e467f99  name Стив Манданда
-- id 09c15cf5-48b4-4b29-9b3a-7b7ae06bdc56  name Одил Ахмедов
-- id 09d2eee4-7f9f-4903-a41a-3b920cdf39b7  name Марсело Брозович
-- id 0a0d5ffb-b0e5-4af7-8410-85f3f49189a3  name Никола Легротталье
-- id 0a48341b-1490-4d62-8916-366e8dc6ea08  name Виктор Александров
-- id 0a86fd62-29e5-4ab0-a37e-68cdf789d646  name Петр Чех
-- id 0b02b168-eaea-4692-a55d-23bc4be0a77c  name Данила Козлов
-- id 0b131030-d643-497a-b065-205a335a5459  name Лечи Садулаев
-- id 0b222bc8-c6e8-482e-baa9-460621a69c31  name Алессандро Дель Пьеро
-- id 0b6c8f57-ef80-407f-8257-07ff0d35b6b4  name Жеронимо Рулли
-- id 0b850d7b-25e4-4652-9c66-8a09877f4d40  name Александр Мартынович
-- id 0bcfc303-4f9c-4668-a56d-77a8bd1cab7f  name Дмитрий Воробьёв
-- id 0c20db9a-e647-433e-8528-1ec3f9c500b6  name Грегори Купе
-- id 0c26e8fd-2b91-47df-b907-6a21dbda8c47  name Александр Ломовицкий
-- id 0cdd97ae-020f-4ca6-a8a5-c4db09ef508f  name Дэвид Симэн
-- id 0cf3c879-d53c-44ab-9652-c94ea21cfa97  name Радамель Фалькао
-- id 0d23b902-8d69-4c3a-9d82-8d482ec0a7b9  name Доди Лукебакио
-- id 0d523da6-1cfb-40ef-acc7-6372c6382e5f  name Георге Попеску
-- id 0d543a87-7246-412b-823a-2abea0f64986  name Манфред Угальде
-- id 0d6daedf-0f34-41ec-84ba-2e0c3b742137  name Константин Зырянов
-- id 0dc6057c-7b91-4bb2-befe-a80810c9e77b  name Нани
-- id 0e07f0d5-2e3f-4dd3-9eef-8009f9d66120  name Жан-Пьер Папен
-- id 0e1badab-cfd6-4c2b-b5c4-8225c25b51a1  name Хуан Мануэль Инссауральде
-- id 0ead0f77-ae3d-4bfa-a96c-2cc0c87779dc  name Артур Юсупов
-- id 1004a76d-c904-42fc-8eb9-dcd97e3432fe  name Горан Пандев
-- id 100f4985-e0ac-44e4-b594-ed80e1f80ed2  name Кристиан Эриксен
-- id 101b086d-4ff6-4106-b7ea-2c848d76ad08  name Абдукодир Хусанов
-- id 104c00ee-92d1-488d-bc69-c6142f941d5a  name Арно Калимуэндо
-- id 10961e1b-d451-4b99-af68-1d2d2b0b50ec  name Патрик Херрман
-- id 10f642a7-c682-4815-9fee-4737c9219d21  name Егор Титов
-- id 1102cd05-99d4-4abd-be2a-84dc8e962250  name Фёдор Черенков
-- id 1114e27d-180a-4028-bc90-695dd2ce2ff4  name Юрий Никифоров
-- id 1128931c-1fa3-4713-9356-06e30f9ccdf6  name Эммануэль Адебайор
-- id 1167ad11-5155-47f1-bd29-2b19432d4ee9  name Диего Кавальери
-- id 1171fcc3-41d8-4e8a-81bd-8a146e70e2dd  name Никита Кривцов
-- id 1177f8f0-65ef-44cf-bcd3-036e8a2f087c  name Алиссон
-- id 118ac6e7-070f-497f-9dbf-e0fc7c9e8691  name Мохамед Салах
-- id 11fe5a76-5d64-41e4-839d-a2b27864c7fe  name Илья Помазун
-- id 1205dbcd-c817-4b8a-b9a2-d52d3a912472  name Адиль Рами
-- id 1293e114-2162-4848-b3ef-7a0f304b34f2  name Владимир Вайсс
-- id 12b92492-3462-4de2-aa9a-69396472ca78  name Данило Катальди
-- id 1331aa11-f491-4648-9115-9d1b5d9b2973  name Эмиль Хески
-- id 1346b220-c8f8-4b88-bbc8-3ecafd1fa5e0  name Дони
-- id 1353e8d0-5535-4505-9057-4cd9675d6e61  name Тоби Алдервейрельд
-- id 137e661e-ed02-41a7-9cf7-07eb3cd9a27e  name Тэмми Абрахам
-- id 13a8cd0a-d452-46bd-b11e-87c995f87d5c  name Антон Заболотный
-- id 14632b38-30c7-45c5-98ae-632377a4e8bb  name Евгений Латышонок
-- id 14635125-a4b3-486e-86b8-e4ad3284fce8  name Ларс Бендер
-- id 14b44d73-bf22-4cd9-853a-26105f58ec27  name Брэдли Барколя
-- id 15257d35-aec2-4806-b207-63974849825b  name Андреа Пирло
-- id 154e9ea9-c80e-4825-824f-f559140342fa  name Даниил Фомин
-- id 15579e47-4057-4a6e-b17a-a8ee8972ebac  name Джанлука Дзамбротта
-- id 15e0701d-097b-48db-9867-2e8c67d8cf83  name Нико Гонсалез
-- id 16050cfa-bb60-4bf7-a7aa-a2fa16f26a4c  name Станислав Лоботка
-- id 162b53ea-e2c4-4964-a619-8c5bfbf4efb9  name Иван Сергеев
-- id 163362ff-acab-48e9-865b-c6f7662c8c86  name Фабиан Шэр
-- id 167c4653-dc0e-4470-9fd0-b4560fe0fb64  name Иньяки Уильямс
-- id 168713eb-7435-4d78-a950-d62706432613  name Харри Магуайр
-- id 16b46967-f805-4328-8bc2-327329acc7eb  name Хавьер Пасторе
-- id 16be5543-2340-4ad0-b70a-20f88b2b3f3d  name Рияд Марез
-- id 16e88535-565a-449e-88dc-1142a846192c  name Андреас Бек
-- id 170e1aec-f62f-4b0e-8466-31404f7178d6  name Тьяго Силва
-- id 17369aff-ba7c-4904-aa8c-246ceee2f4ab  name Маркос Алонсо
-- id 173fd965-dfbb-4151-8ef8-ec9d0fae3f94  name Фрэнк Лэмпард
-- id 1749f3de-5993-4593-bd48-841f6edc6cbb  name Дмитрий Хлестов
-- id 174d14a4-ded4-4848-811f-5d0aa4d23fb1  name Жером Боатенг
-- id 179cd305-1fd6-452c-b308-624ade48b213  name Владимир Маминов
-- id 17f452b4-e6df-4d0b-abd3-4a527af8115d  name Иван Кордоба
-- id 17fdc5d0-c2bf-4701-a595-da766ee67372  name Сослан Джанаев
-- id 181e9550-6ded-4b81-be51-bbc5b589ce39  name Жереми Фримпонг
-- id 182ecd7a-7a2b-47b5-a076-901a49e1d4fb  name Николас Ломбертс
-- id 183b9891-9f50-4ba5-bde1-bf26fd4aca71  name Сергей Семак
-- id 18492e51-a2d3-4229-b243-4dea853d892b  name Мартин Йоргенсен
-- id 18514431-ba6f-4b58-a4e9-9a30a6cb7ab3  name Антонио Валенсия
-- id 1858d8fd-7079-4c7e-9b75-05a531ea99a5  name Клаудио Писарро
-- id 186e8032-ea8e-49ab-be68-c8e9f20976c0  name Антони Паненка
-- id 1893f251-0cdd-4345-b985-48dbcbfcaf60  name Джейми Каррагер
-- id 18b020d7-77b1-40f4-9e9e-dbe7802d5335  name Микаэль Сильвестр
-- id 18cce5b1-bef7-40ed-ae9d-6f57cc0e0d4c  name Угочукву Иву
-- id 192528df-9cc7-406c-a878-c3b014518731  name Кристиан Аббьяти
-- id 19871dfb-ae1e-4cae-bd6f-a00e1e316771  name Томаш Ржепка
-- id 19f200d0-a23f-4b32-86ab-56bc8a4e8a6f  name Александр Тарханов
-- id 1a31b9ea-a6b0-4dff-85cb-14c5494c16d2  name Джо Коул
-- id 1a3dfefa-3512-405e-a0ec-d9e5fdab5735  name Костас Манолас
-- id 1a61bb0c-e1da-45b9-b1ba-809cd94abdc0  name Александр Черников
-- id 1a63ce34-2321-40f2-8325-c03df01a23a0  name Вячеслав Караваев
-- id 1ab04154-01b4-43a2-b6f0-37da10458f5e  name Уэйн Руни
-- id 1afb9fd3-bcfe-4bcb-88d0-d9fe7a732c3f  name Кирилл Щетинин
-- id 1b14d921-d790-4a19-97ce-839ceec9febf  name Давид Силва
-- id 1b15c97b-ac5f-4f3e-9be6-f6c9d9480c42  name Павел Недвед
-- id 1bb6002b-ed34-40ef-bcf4-c2d9d5c49af9  name Балаш Джуджак
-- id 1be02134-976a-4ba7-b7d0-88b690e49980  name Нголо Канте
-- id 1bf96ea4-114e-4d17-8a73-ba26659e15d3  name Андрей Шевченко
-- id 1c26d2b4-8cea-4267-a3bf-b7444382f2a7  name Франк Лебёф
-- id 1c3c0c3d-ac35-469c-b3b7-a63d9ac393c6  name Эдер
-- id 1c82c9b1-4c5d-4ba2-b4de-0ce673702f0b  name Денис Макаров
-- id 1cce0c66-5d50-47f6-9bb4-e93679a56cbf  name Кевин Де Брюйне
-- id 1cf9b84f-82ec-4bc0-8526-fab1dad40d20  name Джоване Элбер
-- id 1d8bba6f-c1e1-49c7-abc7-50bbc3aa414c  name Шон Райт-Филлипс
-- id 1dc7b854-95e1-43d5-b219-2fcb3baaa863  name Секу Койта
-- id 1dcd9d6d-3302-49cb-9a14-0ef189477a9d  name Энди Кэрролл
-- id 1e2520f3-f761-4949-ad1a-aa36aee7e50c  name Жоржиньо
-- id 1e59fd65-f5fa-44bc-b0ba-db5df76135eb  name Карлос Камени
-- id 1e5c96d6-9d81-47c8-9c15-e80a1cbe78a6  name Бобби Мур
-- id 1e6ebf4c-1054-4634-b11a-00cb49486f3a  name Рэй Уилкинс
-- id 1e7c3387-0ae2-440e-8e0d-a5be637b58a5  name Робиньо
-- id 1e90337c-d3cd-4d1f-9e00-32388f96f771  name Макси Моралез
-- id 1e940397-e21b-40b1-961c-82a69d6f5353  name Мануэль Альмуния
-- id 1e97cc72-420a-40d0-80ac-ff17b24f3819  name Максвелл
-- id 1eeb13fc-9f4f-4113-a325-2259b4e8761b  name Ален Халилович
-- id 1efe7e91-bfbe-47ec-8c2b-7f6857e661ff  name Кристиан Гентнер
-- id 1f234c27-c0e6-4fd8-857e-0ffbd473183e  name Джо Гомес
-- id 1f9d480d-c60d-4b7b-ab97-f988af942035  name Алешандре Пато
-- id 1fe18eaa-5f30-4c26-a533-78cd589fe076  name Доменико Кришито
-- id 1feaa483-d770-48fb-8212-37550655cfcc  name Штефан Кислинг
-- id 2008c103-ffc5-44f6-a3d5-cd319bbde85b  name Оскар
-- id 20388eed-6e02-4c1a-896a-a3d33024cb70  name Свен Ульряйх
-- id 2045484f-5c1c-431e-9a2c-6b5e9e0ab86d  name Каха Каладзе
-- id 20ad6bd9-bdaa-42cc-b742-bcde028cd17b  name Магомед-Шапи Сулейманов
-- id 21475952-8526-4907-a8b1-fc4390f838bf  name Владимир Шмицер
-- id 21a99aee-6560-4ccc-b3fb-aaa8c9e47042  name Райан Бабель
-- id 21cd4d4b-d98b-492f-92d2-360dd8e29755  name Николя Анелька
-- id 21ecf926-b0ec-4873-8c06-8f04f2edfd26  name Марк Овермарс
-- id 2205f55d-7d82-4e9f-8524-6820d55ec08d  name Леандро Фернандес
-- id 22617193-3cf8-4e3a-af6a-fb63b7811cea  name Исмаэль Беннасер
-- id 22706dd9-41bd-4581-baf6-d498c091b6d6  name Стефан Савич
-- id 22b28547-d47e-4e0d-9c84-98b855abc5bb  name Тамерлан Мусаев
-- id 23045a01-00f5-4d9d-bcbb-38d7ed3b4fc2  name Сержиньо
-- id 230578f9-06b5-4990-b66d-cafb7a0443c3  name Александр Кокорин
-- id 231d1db7-6532-4694-a70b-709563ca4a35  name Жереми Менез
-- id 23d67671-9c9c-4e41-a7be-6d75331ac8f9  name Дрис Мертенс
-- id 23de5cfe-cc49-4ecd-9902-1252bb0b79e1  name Грэм Сунесс
-- id 23ea0796-c5d6-4deb-b2b6-a4f4da4e9be2  name Дейвидас Шемберас
-- id 24075348-9ad6-4f85-8a75-2d234718cfaf  name Кевин Гамейро
-- id 240c8c14-122b-419c-9734-1e29f83dc513  name Александр Коларов
-- id 24108d2f-9925-4cfc-9aeb-ac1d0a426164  name Крис Смоллинг
-- id 246f2637-2edc-403f-b1f7-59261480bec3  name Морган Де Санктис
-- id 248de211-30bc-4c9b-8950-fa341c7d508c  name Хесус Медина
-- id 24df2d63-e3be-408f-99b4-147cfc851659  name Станислав Магкеев
-- id 256cb8f8-2caf-4580-aabd-c5bdd171636c  name Генрих Мхитарян
-- id 2586f02a-f1f0-4729-9952-a066a7f70687  name Жо
-- id 258e4862-c3d6-4f85-964d-f99521e689e5  name Понтус Вернблум
-- id 25946f8a-c82b-4177-96a6-81b386a9ce57  name Виктор Понедельник
-- id 25b56715-76d2-4e1b-882d-2555cdd29a93  name Ули Хёнесс
-- id 25b8cb25-81d3-433f-84ca-7776a06ac308  name Малком
-- id 26a7bfbc-78fb-457a-8066-d92110139b34  name Евгений Макеев
-- id 26ab1953-51b6-44c5-8ab0-2431a29923fc  name Франко Барези
-- id 27a8d65a-bf93-4455-b4ef-8c01e710f5bd  name Антон Фердинанд
-- id 27bd14c9-ec33-4e4b-9334-461a550e9849  name Хавьер Дзанетти
-- id 27d742f5-acf9-4ac4-bc8f-f44f0d8ca9bd  name Маттиа Дзакканьи
-- id 281baa0b-46f6-4457-a816-253b109730ae  name Вадим Раков
-- id 28484aab-ad49-4489-a97a-80d13ea509ce  name Себастьян Дриусси
-- id 2872d4c5-77a7-4572-b730-c904315c9ffa  name Тайе Тайво
-- id 28e9d109-5944-4954-bb9f-03b3ed385d40  name Холанд
-- id 294886b4-aec4-483a-8890-b1c231c3e420  name Александр Точилин
-- id 2948da4a-12a4-432a-8f84-37d205e1490a  name Фернандо Торрес
-- id 2984b7b4-0d6c-4cd1-bd2b-1add25ce78e5  name Родриго Паласио
-- id 29ca5aad-7525-4eea-b7e4-32663be21977  name Давид Альбельда
-- id 29dd4e9e-70ba-4d1c-9314-edb3d7d5c61b  name Дерлей
-- id 29e6b773-a944-47c1-83d8-9fa39326b09c  name Давид Рая
-- id 2a3bc0e7-57e6-48e8-a96f-c748ec45fe82  name Роман Бюрки
-- id 2a56cae6-f51d-42ff-9973-e544bb06745a  name Диего Форлан
-- id 2a85dfd3-5770-49c2-bf06-b9b19d420466  name Дмитрий Комбаров
-- id 2c21c491-c914-45ea-8e51-5c9ac86471c3  name Уэс Браун
-- id 2c448b96-f8ea-4ccb-8ab1-3a7ee992bdac  name Роман Березовский
-- id 2c824f3e-644b-4fd2-9d42-2f4b81002da7  name Рафаэль Кариока
-- id 2c82a97c-370e-4620-af25-1f327a69dfa7  name Майк Маньян
-- id 2cd52949-1eef-410b-b4ab-3da0ec190311  name Джон Оби Микел
-- id 2d2cfb12-b011-4ad7-ad1c-0d51f6d5c18f  name Эшли Коул
-- id 2d5c5393-5247-4200-880c-5c7c5ecd3a3d  name Маркус Тюрам
-- id 2da3fc54-2ace-4dc7-ba08-8c7c5ad97277  name Рууд Ван Нистелрой
-- id 2da62dda-7b02-4ba3-91a2-a9b497e12d6c  name Филипп Лам
-- id 2dc9d37c-ef31-440b-9442-1565680268b1  name Эдуард Стрельцов
-- id 2dd0d75f-1a85-4166-90fc-d433575e0750  name Никита Ермаков
-- id 2e400f6f-715a-4442-addd-1d725c87065f  name Алан Ширер
-- id 2e5f738d-e20c-4e51-94ce-0460033baa5c  name Дани Алвес
-- id 2ea42e31-e836-4551-b43b-16e91a8cec00  name Кафу
-- id 2eb44e7a-e468-4fe3-9fa4-87cdce512208  name Карлос Марчена
-- id 2f2f02b5-7fa6-4b8c-8d8a-24510c9d5245  name Хесус Навас
-- id 2fcadb77-5cc9-4ac8-9d9c-1ac27bd3dac2  name Василий Березуцкий
-- id 2fec3f9d-fffd-4fef-bbda-c1e28202ac31  name Олег Блохин
-- id 305c37a5-8f34-4184-a6d4-64c52b7bcd8f  name Александр Соболев
-- id 30616425-5167-4342-bd05-b08674836d0c  name Михаил Кержаков
-- id 306263e7-99d8-4a87-9af8-1f308856189b  name Фелипе Андерсон
-- id 30749839-60e8-4d50-8427-d49520a10efc  name Коло Туре
-- id 3108d4d6-7973-46c9-ba51-85b640c37705  name Уго Экитике
-- id 314d90d5-f390-4ab8-88d6-2c2a88363b83  name Лоренцо Инсинье
-- id 317c1be2-dc56-4367-bc4d-32ec1d2dfb64  name Свен Бендер
-- id 31b08391-f16a-410d-a3b7-bcfd58c93e06  name Папу Гомез
-- id 31ce5e3b-a820-4840-8c71-98d6025468c5  name Юрий Газинский
-- id 326c2576-6913-4297-8347-1cc3a98c8b21  name Вилли Саньоль
-- id 3287b7ea-4ceb-4a97-8690-17ecc544fc3d  name Томас Гальдамес
-- id 329c0a0a-00a6-41d0-94df-7b830b62e5c6  name Диего Марадона
-- id 33218ec5-87d6-4c4f-ae38-db90aa3c4adb  name Маркиньос
-- id 334f94e6-122e-4481-9d0b-3abab27c337a  name Давид Трезеге
-- id 335a1fb1-1b29-446a-8236-3f717fc9bb65  name Дмитрий Кириченко
-- id 337eed20-6ba8-4422-ae8f-de4676dcd1ba  name Ярослав Гладышев
-- id 33b5bb91-0ecf-4042-ba7c-affd210a0b1c  name Леандро Троссар
-- id 33df7d56-fca2-4801-8059-58e991d61893  name Ярослав Михайлов
-- id 34aaea30-3b9d-423d-ae37-354ebb6f9e35  name Диого Жота
-- id 34f6b590-3ea8-4cfc-bfc3-b4bf31979ad2  name Вагнер Лав
-- id 34ffdde8-aaa8-417e-8c0c-7102822be5b0  name Джон Терри
-- id 355805d2-62db-46f9-89db-e9063948f8a6  name Пьетро Террачиано
-- id 35985866-6a97-4bbb-86b0-b87cdfefb4f8  name Маурисио Почеттино
-- id 35ba644a-2c8a-4924-b24d-6c5136c26805  name Бастиан Швайнштайгер
-- id 35c0c189-17a5-4b28-a2a8-3b340a55b668  name Маркус Рэшфорд
-- id 35c4bad7-d065-47dd-9297-a4291569b989  name Рицу Доан
-- id 35fbea02-786c-40c4-a6b0-113fa2a9bb97  name Илья Рожков
-- id 361ba467-f188-4f1b-913f-c121cb39dcce  name Том Хаддлстоун
-- id 365b781a-3539-4bfa-933f-0adf23b72e6b  name Петр Зелиньски
-- id 366f93d0-ce96-4fbc-b106-71797fdbe2b6  name Виктор Са
-- id 36bb6014-831a-40b1-841b-e538fdde01b8  name Джакомо Бонавентура
-- id 37196f5e-9542-4883-8a97-1bc3a752ae31  name Керем Актюркоглу
-- id 3750f378-acb1-4080-b40e-b71e0e6fb5b1  name Мерт Гюнок
-- id 37523450-92cd-4ca5-ba44-b25f172efe53  name Робби Фаулер
-- id 376ca5c9-7265-41fc-9b8c-1592c3f93c6b  name Яя Туре
-- id 37aa9b89-413e-4a8d-9e47-95abc19d0ef9  name Уэстон Маккени
-- id 37b0f400-9bb6-4c1b-9f80-6d0423b0eeba  name Кристиан Киву
-- id 385467fa-3610-4887-a05a-f37473213b6b  name Виктор Онопко
-- id 3887007d-8e88-405f-b595-b1a0612ed2ea  name Феликс Магат
-- id 38b21a0d-9d13-4940-8ed0-a23ec8c0ab46  name Эрик Ламела
-- id 38b4b337-ca19-4c67-8968-720a9b7118e2  name Рафинья
-- id 38eb2b9e-63cd-464f-9ee4-7452345b1fd5  name Андерсон
-- id 38f00c8a-546c-49f4-ad05-bd28356675b2  name Уэйн Бридж
-- id 38f1facf-c2ac-4b2b-9b4c-0da22d217c8c  name Владислав Радимов
-- id 39908dfc-b477-4e77-a4ee-32991dd49f3a  name Серхио Агуэро
-- id 39f61e6b-0f91-4828-adc7-dd57c96424cf  name Крейг Беллами
-- id 3a1900ff-1aa0-4c03-8186-2f0e4c845905  name Фабьен Бартез
-- id 3a203134-6387-40cb-909b-33483be685b0  name Луис Альберто
-- id 3a226e97-7610-4a83-a1b6-02aae3b0be16  name Юрген Клинсманн
-- id 3a43a9da-1c95-4c53-b4ac-c714d1cad668  name Ханс Хатебур
-- id 3a641835-bd5c-4573-b987-e15b2e3b715f  name Беллингем
-- id 3a97ccb3-5cf2-4dfb-8372-f4c71ecb180f  name Дуайт Йорк
-- id 3aa8ce64-1968-4144-a993-993b3bf440b0  name Эгаш Касинтура
-- id 3b0008f5-a1c3-4e0f-b38d-b6461651dc01  name Данил Пруцев
-- id 3b2b5363-0728-4cfd-9867-8a39554077ef  name Поль Погба
-- id 3b39e70d-81eb-429d-9d69-7c2775030855  name Макси Перейра
-- id 3b60bb14-6db9-4be9-89ca-267d012a5eea  name Гарет Бэйл
-- id 3b80771e-8755-45ff-9de9-0e0665af025e  name Питер Крауч
-- id 3c1b2377-c1b5-4546-a15c-9879f26005a6  name Вендел
-- id 3ca82e70-c6be-4cfc-b87a-bf498361bdc1  name Джанни Ривера
-- id 3ccc4475-82ad-4fa1-9264-dd1cd85be967  name Тони Адамс
-- id 3ce0e957-8f83-4028-813b-b8000696b8c3  name Венсан Кандела
-- id 3cfc4b45-010e-4d7b-8ce8-cf546563a4af  name Рафаэль Маркес
-- id 3d082e9c-29ea-42d2-b8c8-5279881d822a  name Чиро Феррара
-- id 3d64919e-bb25-4eea-8f0d-ad13d867e44d  name Никлас Зуле
-- id 3d69ab73-cf80-4f7d-8e86-b0c9b2020516  name Игорь Дивеев
-- id 3e056bb1-60a2-4478-82fe-f576d77d0dae  name Кристиан Нобоа
-- id 3e8b3ae6-bcae-4fc7-ae13-cdf36c95176a  name Мойзес Кайседо
-- id 3ecd8bf0-d41e-428b-891b-7503e24acb28  name Патрик Виммер
-- id 3f31c641-907e-49bf-b046-3b2643e36c4f  name Матьё Вальбуэна
-- id 3f719780-9988-4d52-8165-b3ea3e6763c9  name Алан Смит
-- id 3f89ccb4-04ff-4fc7-9a02-d5a0bb28cf91  name Клод Макелеле
-- id 3f8e2d90-8371-411d-ac04-29636f51cc61  name Кристиан Сапата
-- id 3fe7724b-b350-4bd5-809d-91100a9fa715  name Тьерри Анри
-- id 3fec63c9-19f8-4d77-89ed-fce7be3a218c  name Томаш Уйфалуши
-- id 4023498e-2f31-4a1a-86d4-a24aa22285d9  name Алиссон Беккер
-- id 402a71b1-951f-4523-b1f1-a8efd22695fc  name Венсан Компани
-- id 4037a2c8-d10e-40cd-ab17-3a2c66198cda  name Мирлинд Даку
-- id 4049fb23-937f-420a-8f6a-151e6762712f  name Кирилл Набабкин
-- id 40b36223-67c7-4bdb-91af-5f407f66a892  name Бен Дэвис
-- id 411b17c6-16d1-4fda-8ba8-225ff6780e72  name Александр Трошечкин
-- id 418cf25a-ecf6-4355-a54a-0429ab7e0857  name Ян Зоммер
-- id 41be8a4e-d952-42a2-8372-28fa6848ba4b  name Егор Тесленко
-- id 42169854-8f41-423e-8784-10f959e78ebd  name Сантьяго Канисарес
-- id 42a7699d-65b5-417b-a366-b388e261eb9b  name Александр Кержаков
-- id 431dda92-1bf7-4cbb-b4a0-aedb74d7b25d  name Ари
-- id 43487d08-0a2d-48e2-bdf3-06b97b26dd42  name Соломон Квирквелия
-- id 434ab7b2-d798-4469-952d-72fcf8610cac  name Харальд Шумахер
-- id 434cae06-04fc-41db-af1d-2d14b30c10e7  name Ким Чельстрём
-- id 4352c49b-2fd9-4343-9a69-eecc60d7d30f  name Роберто Ди Маттео
-- id 43859dfd-19f0-4317-9661-ddc3692d8495  name Алессандро Неста
-- id 4387503c-0eeb-4a79-9e1c-cb3b7ab0252c  name Наир Тикнизян
-- id 43d6f8d9-22fd-45f0-a7c7-5f39fe6b4f60  name Ромарио
-- id 43f9674e-0ca7-4279-9a58-71e561e4d6c5  name Эдерсон
-- id 440f32b6-b368-4627-ad6d-8a255238a044  name Али Соу
-- id 4412ee00-b164-4829-ac74-462d65114d26  name Игорь Шалимов
-- id 441ce586-1dda-4bb4-b665-1c75bcede544  name Варди
-- id 44c9660a-63e4-4c22-b6db-4cff3f797cd9  name Марк Гейи
-- id 44d240a9-6310-4e33-b447-e9c4d14c42fb  name Эдуард Сперцян
-- id 453bc06c-4067-4244-901c-8564cc8761ee  name Жозе Фонте
-- id 45849360-35e1-4a7e-92c0-314c6c1a143a  name Максим Бузникин
-- id 4596697d-94ff-4cee-bba5-aad7580479e3  name Диогу Коста
-- id 4648bbf7-4f23-49f5-a054-7f6d9855e546  name Маруан Феллайни
-- id 465ce5b3-64bf-4af5-9247-bca373593473  name Юрий Горшков
-- id 46a27393-d4b3-437a-84d3-7dc9c5320304  name Арсен Адамов
-- id 46d2aa35-bb5e-44e3-b446-4d7a7f3d0cbe  name Даниел Субашич
-- id 46d953fa-7770-4d3e-88e3-06087d3fde59  name Андрей Канчельскис
-- id 46dbe23f-c898-4d57-9d32-a489832f4dd0  name Владимир Габулов
-- id 47289ea5-a410-48d8-8992-da75693c012c  name Давиде Калабриа
-- id 4799ef14-4769-4b1b-994d-4325aae3efb6  name Леонардо Бонуччи
-- id 47d44b2f-43cf-4b2d-9cd9-378d9be4e414  name Лукас Фассон
-- id 484ed7b0-fb5b-4e21-991c-108e1b3486b5  name Виталий Гудиев
-- id 48a09b0c-d42f-4104-b521-62523a3db684  name Данте
-- id 48f6ed51-1d32-4699-863e-930c0de972b5  name Жерар Пике
-- id 495b67a5-5f71-4694-b81d-7ca689d4f952  name Роберто Айяла
-- id 49884c2e-b410-496c-8a2c-1d109170dd97  name Руй Кошта
-- id 49962a32-758c-48fe-9e5e-a854ef9006bf  name Дмитрий Кабутов
-- id 49af79b8-4428-4419-bb3a-8919de2915f2  name Владислав Сарвели
-- id 49b9b49c-9e17-407b-973a-3728b8bb14c1  name Хави Мартинес
-- id 49d9b83e-1f2b-4cd6-933c-a6a47dfe41b1  name Мартин Демичелис
-- id 4a00722e-0269-4f5f-9554-18ee462641b4  name Луиш Нету
-- id 4a25a3ce-ba32-4a79-a16a-dbb20453f511  name Никлас Бендтнер
-- id 4ad5800f-9d88-4298-afef-8e82c2701690  name Игорь Денисов
-- id 4af031c6-d57f-4388-915b-7b816a69b3a8  name Олег Иванов
-- id 4afe8ede-61f1-41f4-849a-47a50d0b3994  name Аарон Уан-Биссака
-- id 4b52ce77-7e83-432b-9836-d31cbcde0d17  name Ренат Янбаев
-- id 4b89125a-dd2e-4f2b-82a4-dbe2d3a39bc0  name Фернанрдо Мейра
-- id 4ba1750c-321c-42e3-b433-64d024975dac  name Гамид Агаларов
-- id 4c022d02-f1bd-408c-9505-220db0357f2f  name Рональд Куман
-- id 4c82680a-f177-4d05-8e4b-0565a458fd2b  name Саша Зделар
-- id 4c88d966-3228-40e7-b90c-19e4f1fae80b  name Лукаш Градецки
-- id 4c9a5a0a-9c79-4064-99e6-44d64de1d38e  name Рустам Ятимов
-- id 4cfe1855-80f9-4e91-96c5-a32745a2312e  name Майкон
-- id 4d74867a-3e6e-44d0-a11d-226547150d39  name Элдер Поштига
-- id 4d7c553d-5cd2-41c9-991e-0a9597adcc77  name Давид Писарро
-- id 4dc9d579-28fb-4652-9467-4d3ed9919531  name Мауро Каморанези
-- id 4dd16a26-ee6a-4a30-9059-e04b78442a28  name Марсель Десайи
-- id 4e0bca10-b24c-400b-85db-e84fe8e0a9d1  name Джей Идзес
-- id 4e7324fd-3f94-4044-9795-a6ff1172191a  name Константин Тюкавин
-- id 4e87b390-b677-44cc-9b5c-29e3dca360c4  name Налдо
-- id 4e9110bf-6c04-4886-a2f1-2aea5a1cd33f  name Аарон Леннон
-- id 4ef70bd2-ba82-486b-a1f3-f3f800610a2d  name Мариано Андухар
-- id 4f499843-479c-40ac-8b9a-0929a80506cf  name Микель Артета
-- id 4f87aabf-b604-4ed2-bd06-76dac48c4a1c  name Тайлер Диблинг
-- id 5011c5be-db70-4fb7-b124-6912def91e5c  name Робер Пирес
-- id 515108fb-2f71-47a4-9d58-cd3c9a23465a  name Пабло Аймар
-- id 515a03bd-8396-42c6-9ce4-18dcd15e2438  name Милан Гайич
-- id 51d11ad2-c364-4a90-9ccb-76e6c551d2cf  name Маркус Берг
-- id 51d63dce-d5c7-4d32-922c-2d8a57070c2e  name Евгений Савин
-- id 51f7846c-b444-4b85-bc24-9d67cc4e2a7d  name Вячеслав Грулев
-- id 52773eeb-2d89-4323-a225-487aaaff4627  name Кирилл Комбаров
-- id 52a73cdb-ddb8-4967-b712-fed3d5536ae1  name Юто Нагатомо
-- id 530a2639-a451-47e4-b83c-351bac0da141  name Виктор Шустиков
-- id 531935d6-ea82-4392-b3f8-51c20a9c9e4b  name Юра Мовсисян
-- id 5323d27f-fa5c-487d-8e5e-7816dcd87600  name Людовик Обраньяк
-- id 53af6f58-fdfd-448c-a555-f73abc94da7c  name Паоло Каннаваро
-- id 53d1921a-5249-4ac0-8c21-859fd41b054e  name Александр Руденко
-- id 53e870b2-a9f6-4fc0-85f3-64d635977ae1  name Данни
-- id 5424ec60-c6d3-4dc6-8e50-e34e82e9f874  name Гаэтано Кастровилли
-- id 5433f201-4285-432e-afbe-aed7c718bffa  name Нолито
-- id 54a3bc52-8f54-4595-b4f0-17ea26cec642  name Джексон Мартинес
-- id 54a7a3e1-e828-4105-98b7-f4edfa6960a6  name Ведран Чорлука
-- id 552a9cb3-a506-4d2a-9349-a4b89fc71293  name Лоран Блан
-- id 55d01c74-f102-42ec-801a-a56b849b3fac  name Сидней Гову
-- id 560bf45a-8caf-48e1-9e10-e5dffe78a82a  name Винсент Эньеама
-- id 562a8e35-7c2e-4867-8615-5740af2a14dc  name Юрий Ковтун
-- id 5644b586-7e69-4ff2-8566-d1a3c835aad5  name Рио Фердинанд
-- id 56b6f7b0-af8c-4060-b58a-ab84b7867b90  name Сергей Милинкович-Савич
-- id 56dc07bb-bd26-435c-85dd-1e8247e4e06a  name Лес Фердинанд
-- id 56f6a55b-d205-4f67-bda6-5230692a2664  name Максим Ненахов
-- id 5715d6f7-8337-4548-9978-e6f3b34d3b7d  name Гави
-- id 572c2713-d3b4-45d8-a7ce-aaef666cf81d  name Сергей Бабкин
-- id 5821683a-a2e8-4ca6-b59b-6ed920dab5b7  name Папу Гомес
-- id 582a7131-657c-4291-91cd-b0cc7d1670a0  name Джонатан Дос Сантос
-- id 5833a367-c114-4272-8a32-ddc338ca8b4c  name Люка Эрнандес
-- id 58455a2d-785c-4290-9a89-b721d4b1e001  name Бафетимби Гомис
-- id 5883952d-d2d0-4007-9ad9-d44615ac762c  name Егор Голенков
-- id 588978ef-ceec-4469-85cf-13a8c128c2a3  name Массимо Каррера
-- id 58fd2c9e-4d8c-4db2-9f5e-7148e53b835c  name Бенжамен Стамбули
-- id 59854e79-f784-4593-9bb9-e40084b7f248  name Войцех Щенсны
-- id 5991df05-42da-470f-82c4-dc507b2f56ad  name Роман Павлюченко
-- id 59998a17-1740-403b-ad9b-60bf8e0bb249  name Абу Диаби
-- id 5a1d424c-aa75-4fe4-a479-b74132e23f39  name Матео Мусаккио
-- id 5af219e4-81de-4679-89ad-c62902e7fee3  name Альваро Мората
-- id 5b42ee92-4837-419b-8ebc-c83f5389e5e1  name Мартин Субименди
-- id 5b7e8326-e3e7-4fe0-900e-6080e349bbac  name Какау
-- id 5b853ae3-45ae-4acf-aa6e-e4e9460773dd  name Кевин Киган
-- id 5bd554fb-b47a-4d61-9912-e1260abac8a2  name Гиорги Шелия
-- id 5be01ec4-b611-4121-88c2-4486fe46c6a6  name Мэйсон Маунт
-- id 5c1c65e9-5182-4a7a-bc4d-92ad285ad7f4  name Алессандро Костакурта
-- id 5c3ec23a-c443-4d85-b67e-15ba1213d3a6  name Александр Бубнов
-- id 5c5bcd5f-a77e-453e-a576-05ad97d8d63f  name Деннис Лоу
-- id 5cb493c0-c7e1-43c8-bd77-dc13a79ecd71  name Йон Арне Риисе
-- id 5cbbd136-d7ab-400d-981c-bc25983cea5d  name Мирослав Богосавац
-- id 5cdc7534-6915-44dd-9844-3e0544fe1d2a  name Алдаир
-- id 5ce9c77c-e26d-4e15-be18-aa18b5f9cc69  name Владислав Игнатьев
-- id 5d1f5ed6-1f8f-4dbd-8b82-efe07b21affc  name Витинья
-- id 5d6246fd-ed3c-4d1e-9d54-11b97bf64c58  name Пабло Барриос
-- id 5d867f24-33d6-4646-b65d-58d375bd16f8  name Бруно Фернандеш
-- id 5da728de-9bcf-475f-b6a5-ceeb6e960d3d  name Ивица Крижанац
-- id 5da81343-dc68-4cc8-909f-715249ffa28f  name Эндрю Робертсон
-- id 5e0f83fe-52de-442b-aad0-cd7d1b11614e  name Жоао Педро
-- id 5e11254a-cd28-470b-bc86-7bae8d6a0a66  name Димитар Бербатов
-- id 5e6bc2a2-a304-45b1-aa3e-07f207e74ee7  name Филипе Луис
-- id 5e8f7a9e-7c16-4c85-a57b-d6de48e00c99  name Сергей Петров
-- id 5ed1452c-02e1-421e-8660-735b1e918cee  name Джек Уилшир
-- id 5ed48eb9-e88d-4fcd-957d-0923ea95c16c  name Себастьян Кель
-- id 5eee8dc2-a3df-4f42-a107-2aee98b2a63c  name Эдмонд Тапсоба
-- id 5ef9729b-93bb-4ca8-981a-87732bbc88ea  name Элтон
-- id 5f33bdb6-5fb6-4146-bc2d-e2ed091cb7ff  name Антон Шунин
-- id 5f5e8281-cf6f-4f61-b6df-91c8e8f55665  name Мартин Йиранек
-- id 5f60e240-3a86-480f-9f9b-0477787aabd5  name Гарри Невилл
-- id 5fc44377-16d6-4d9a-8521-0a095cc680c6  name Дино Дзофф
-- id 5fd24274-2499-4179-9afc-1e1d52ad4562  name Рифат Жемалетдинов
-- id 60753eb5-b46a-481e-a961-8857949e6dc1  name Франк Райкаард
-- id 60b68049-16f5-4436-a9b8-885d766745fe  name Джон Дюран
-- id 60ce1153-ee78-4c26-adfd-378fa666395f  name Владимир Ильин
-- id 60ecf852-55c4-4e9b-ba02-fb217495dbb5  name Харри Кьюэлл
-- id 60f491ee-9b70-4a4b-95a1-5ce040ecb371  name Дмитрий Лоськов
-- id 610c3e30-16e7-4c25-9f2a-fa041fc8d63e  name Кристиано Бираги
-- id 615d08e2-2e22-4046-8b72-ef4277131b1d  name Евгений Марков
-- id 6194670c-bb43-43eb-a515-ef0d84404c08  name Лев Яшин
-- id 61bd9ed6-fe6c-48f3-8c29-3f2ee526165d  name Хуан Рикельме
-- id 61d888bf-23ce-4a32-974c-40bb3fd7ac51  name Миранда
-- id 62527bdd-2e26-4510-8040-2471c9884107  name Хавьер Маскерано
-- id 628bf932-8689-41e1-b0a6-028fe4f84f39  name Ивелин Попов
-- id 629e4d5b-ca36-4504-b5b8-df04f83a0cd4  name Хоакин
-- id 63047fe3-9f7e-428d-9a75-dbc386640a01  name Роджер Ибаньес
-- id 631fecb9-64a0-4c23-9ecf-4971bda166b0  name Винченцо Монтелла
-- id 632c2a0b-e53a-41de-8623-e6387cf8964a  name Самуэль Жиго
-- id 634af90f-cdb9-4281-99d3-2a1a1cb8ff6d  name Матвей Кисляк
-- id 63b1ca06-7ccb-4412-a2bc-2de6bad01ebb  name Кристиан Пануччи
-- id 63fa0c16-497b-4f7a-b3e5-c4bfabb24202  name Келлвен
-- id 6428ccfa-2348-42ad-9ba9-d2ea31759ea7  name Лукаш Пишчек
-- id 64298cea-acf6-4737-8c82-de992fd60514  name Олег Шатов
-- id 64a6d061-eba2-432a-b9d9-bc34f59802b1  name Расмус Эльм
-- id 64a7d43b-41e2-4e4d-8ee6-0cbbaac911c4  name Калиду Кулибали
-- id 64a84588-47cc-4521-ac0b-e3ccf435990d  name Мартен Де Роон
-- id 64bdbc16-b591-4184-a0a7-1d01eecf7ae6  name Артем Карпукас
-- id 64ea4a97-e425-4c86-8136-5b8708ec2921  name Массимо Амброзини
-- id 64f548ad-d75c-43e8-98d5-cec125649770  name Оле Гуннар Сульшер
-- id 65384ba6-ad35-44cb-9643-8ccf2472b630  name Фабрицио Колоччини
-- id 654813cb-d6c0-409b-b378-034a18d70f96  name Франсишку Тринкау
-- id 654cc049-2051-4b49-a921-231d41c62c4c  name Алан Дзагоев
-- id 65702a3d-bd96-427f-9387-f7378bd2608a  name Марио Гаспар
-- id 65b22034-6705-4edd-bf27-526e086e934d  name Кенни Далглиш
-- id 66864412-2a8c-4714-988b-b11c58bb2210  name Ведад Ибишевич
-- id 668fd128-d0e1-4c4a-8452-145c3e8288f7  name Янн Мвила
-- id 66d481f8-a168-4122-aefd-03d1098d6acd  name Бобби Робсон
-- id 66fd4241-80c1-4990-832a-6c47eeeb0a00  name Люк Уилкшир
-- id 671aa740-b423-4794-b15f-3d9c796207fe  name Квинси Промес
-- id 67cdb7ea-4139-4ffb-99ba-d675c317b264  name Зоран Тошич
-- id 68167013-38ce-441f-8830-ccd57cef2a29  name Ваня Дркушич
-- id 681f0f69-644b-408e-91b9-8f8c352068f3  name Сенад Лулич
-- id 686feec4-37a7-4f10-8839-a8b2fa09f006  name Карл Хейн
-- id 68874855-2d93-4cab-89e3-de5093fe782e  name Такефуса Кубо
-- id 68a6081b-219b-4206-92f7-86f4602f2278  name Мирко Вучинич
-- id 68bc6aa9-779f-47d8-acc1-1d9910fa856b  name Симоне Индзаги
-- id 68c0d10b-9af6-424a-985f-f18375ad360c  name Дирк Кюйт
-- id 68d27d74-e7e9-4d04-880d-c0a6f586a563  name Игорь Дмитриев
-- id 68ecc96c-bfd9-4c03-a784-48e924386c74  name Матвей Лукин
-- id 68f4e42b-bab9-4eab-ac13-0a8a22c80335  name Яго Аспас
-- id 68fd3101-4bc7-4f6e-896d-2f2778c47450  name Александр Бородюк
-- id 69110022-1294-4924-836d-58ece733d376  name Питер Шилтон
-- id 694fee50-d909-43c5-b98a-0d8f61f3d219  name Томас Гравесен
-- id 69ca52ba-a7d2-4a62-b5cd-fdc73a27edb2  name Руй Патрисиу
-- id 69f45742-79d8-46a3-9fb1-93e7d037b9fa  name Даниэль Карвальо
-- id 6a5666d4-2e42-4cfa-8278-9eb4ca670133  name Арсен Захарян
-- id 6a574fcc-f29f-4af3-8b10-80f3742d6d61  name Нуралы Алип
-- id 6a655129-b7a8-4f57-999b-fa1dff19a8ac  name Джордж Веа
-- id 6a6a3f54-b8d5-48fe-98c0-8ed2d7589a83  name Луиш Фигу
-- id 6abb1589-6a37-4208-90b0-69e90be13645  name Йосси Бенаюн
-- id 6aea5383-21e2-4166-8502-5789a571c6f8  name Йохан Кройф
-- id 6b5d0d5c-e6dc-4981-a5d9-dc5b60e5e158  name Бора Костич
-- id 6b913028-fe84-4c63-91e2-9da767c00b0f  name Шамар Николсон
-- id 6b9fba7c-77dc-4cf3-8998-9733e585aaab  name Александр Глеб
-- id 6c6ed7fd-f98f-4b08-af26-b82fe54dd2cf  name Стэнли Мэтьюз
-- id 6d2ee37f-817e-4ec0-83ba-a4b4bb4dcfb6  name Даниил Денисов
-- id 6d3176d7-a794-48b4-8241-4c1e9ab50009  name Дмитрий Аленичев
-- id 6d530540-a9f8-4562-93c4-f20f49ade0ce  name Даррен Флетчер
-- id 6d979be0-29df-4bf1-b814-5553f2c3e2ae  name Джанлука Пальюка
-- id 6daf1f4b-3888-4a02-9c03-20ba9bcd11b4  name Федерико Фасио
-- id 6dc992d4-2d9d-4c67-a429-ef3df02a4cb5  name Пепе
-- id 6de95bd8-159d-43ce-8fc7-dad31ee4bd01  name Людовик Жюли
-- id 6ded83de-9079-468c-a3ce-bddb2e86bef3  name Мансини
-- id 6df6e862-cfc8-432a-90a4-5bc06b3f2fa9  name Джорджиньо Вийналдум
-- id 6dfe4760-d845-4d07-be5f-76ff011bc0b0  name Борха Валеро
-- id 6e3e240a-9a86-4e77-89ea-08dff7bd8a52  name Ираклий Квеквескири
-- id 6e5691fc-9bed-483d-9d0c-996dfead1a02  name Пауло Феррейра
-- id 6e7918aa-4659-4362-bff8-0d218a93f3bb  name Жуниньо
-- id 6e82ede7-e848-4794-b426-730f4ab5dc3a  name Кристофер Ольссон
-- id 6eff032c-b28d-4efc-a753-4e6ad35aa33b  name Кевин Ленини
-- id 6f074774-3beb-4528-91bc-9c2075dc8440  name Аббосбек Файзуллаев
-- id 6f2c76e7-3ff4-452e-a398-10f910f52355  name Хуан Мануэль Варгас
-- id 6f4579fb-4448-4b70-a193-52fc695b6c1f  name Руди Феллер
-- id 6f766038-32c9-464f-9133-af501b41f5e4  name Малхаз Асатиани
-- id 7031a87d-3522-49b8-924c-93530d85b440  name Рене Игита
-- id 70b23125-c680-4784-ab5f-ea932f1637c0  name Арон Винтер
-- id 70c164b5-ede8-4d3e-9430-a2d7e6ce8eda  name Габи Милито
-- id 712681a6-a197-45cd-b0df-d7c61f16bcb8  name Андрей Тихонов
-- id 713b9463-daed-4191-8005-a86eed133b05  name Страхинья Эракович
-- id 717567ec-30de-4832-8078-b56bc4958e9d  name Марсело
-- id 71862679-0fc1-45be-af77-cbf9b89c1121  name Николас Отаменди
-- id 7187ce4a-7dd7-46ee-9b65-0cb67020cf00  name Висенте Дель Боске
-- id 71ad3062-736a-4b1f-aea7-a6794246090d  name Антонио Кассано
-- id 71df46c4-51af-4a00-a194-f24a1ef20910  name Рамирес
-- id 724cfb3b-3a5b-4f8b-af74-9fc0f080ddb6  name Стивен Джеррард
-- id 7263d762-5444-46d4-9b21-e00c45a2631a  name Василий Баранов
-- id 7273eeda-7488-4a02-ab68-fe4b7478910f  name Иван Эльгера
-- id 72796774-9e38-440b-89e1-640dc07629a9  name Пицци
-- id 738beee4-a123-4f3a-9523-2e2341948968  name Евгений Луценко
-- id 739954d2-caa6-4edb-9dd9-4dac68c21aad  name Саломон Калу
-- id 73ae2e49-c5a8-4c81-9ea3-c641ff83f29d  name Чарли Крессуэлл
-- id 74161f9f-1ae5-4e42-a07c-bdeb635d4333  name Денис Глушаков
-- id 74311193-f071-4edc-be36-dc05c33f14f0  name Энтони Эланга
-- id 74a30fbb-da44-4e04-8e31-ad6a7c543822  name Никита Медведев
-- id 74df072e-ddc8-4fe6-afb0-ec0ca87c83b2  name Игорь Беланов
-- id 74e3bc43-2723-42b8-a4b1-e3ab12d71922  name Андреас Гранквист
-- id 753ba88a-8c60-4c7c-9ae3-fc1c1cf9bc0c  name Эйдур Гудьонсен
-- id 75d5ddc3-fc8e-4673-af71-15e6a81bdcb3  name Герд Мюллер
-- id 760b37ed-b8a8-47c9-b95f-91f5f1d9c088  name Стефан Раду
-- id 7633f610-27cc-476c-97c2-fec6b5876d16  name Константин Бесков
-- id 76712add-30c5-4c14-a3b7-f6230b951027  name Бернд Шустер
-- id 76abbecd-a6fa-4c01-addf-03735266005d  name Пол Гаскойн
-- id 76d1518a-c9ea-4020-9782-cfb50b4f5910  name Вадим Евсеев
-- id 76e06e3e-2822-43aa-bf54-552156f6c612  name Дензел Думфрис
-- id 76ece9cd-624b-4b49-bd05-23f991f54dc8  name Михаил Игнатов
-- id 76eff730-3877-4977-953f-61e0d5ae0f4c  name Эрнан Креспо
-- id 77c39faa-2b5c-4518-9373-01dc8f65813b  name Икер Муниаин
-- id 780b3aa7-aa7b-448d-a1b3-a73fe8fe7f9e  name Андре-Пьер Жиньяк
-- id 78a71c83-d1de-499c-81f5-802dba483309  name Даниил Хлусевич
-- id 78d46024-2b18-4fb6-8635-1440d091efac  name Сергей Песьяков
-- id 78fe04a3-61c2-4c9b-8703-2c9a2084cfbe  name Маркос Сенна
-- id 796999cd-beab-4cc2-a5f9-1b97dac8c669  name Пьер-Эмиль Хейбьерг
-- id 79d279ab-6efd-4661-9214-fc871f12a835  name Игнацио Абате
-- id 79f65a1f-825a-4266-ba8e-9668f459f426  name Лоренцо Мельгарехо
-- id 7a0ccb38-c0e2-4282-be5a-39fa3af87fb4  name Марко Баша
-- id 7a111aa6-b2d9-404e-a2dd-0687d5ea400f  name Альваро Рекоба
-- id 7a62371a-6322-4b50-b9cb-446925690b55  name Чиди Одиа
-- id 7a8e3985-1964-4dd0-afe9-0d03a4f0cfcd  name Хаби Алонсо
-- id 7af5aa52-d209-480f-ae49-913a36a65fe1  name Гиа Григалава
-- id 7b661a11-4e48-4ffb-b7f8-b4884c39f3f2  name Сергей Гуренко
-- id 7b69b945-a107-45e0-b70f-bbb042898214  name Питер Бонетти
-- id 7bae3a05-3ac9-41c6-8df4-89cb8809d04e  name Варела
-- id 7bb64f7a-d1f1-436f-af8e-a1f5753f1859  name Артем Дзюба
-- id 7be153fd-a264-4e88-a990-3e90099f27e2  name Симон Миньоле
-- id 7c6ed6d0-0d74-4ee1-8e77-f0ff5aaa0207  name Роберто Карлос
-- id 7cb3e683-7693-4e3d-9523-de7dcfb5667f  name Артуро Видаль
-- id 7d207fb0-2b4a-4d9a-b1d7-f1764af0dee7  name Джо Скалли
-- id 7d50f614-593f-442c-b360-16db845c4a14  name Маттео Политано
-- id 7d67182d-38ad-47eb-9fb6-b0a2104dccf7  name Давид Вилья
-- id 7db5d0a8-f672-4ec6-bf7a-c0787530b72b  name Динияр Билялетдинов
-- id 7db9d848-ec37-4649-b811-18c11c3dda9c  name Ролан Гусев
-- id 7e22296d-961d-46bc-b4aa-4d35135aa944  name Антонио Конте
-- id 7e6a0be9-2b13-4231-af9d-744edde31af1  name Павел Мамаев
-- id 7e871125-75da-4238-9303-feee32f7ce09  name Жоао Батчи
-- id 7e94f0a0-67ec-4821-80d3-8c68b449cba8  name Виллиан
-- id 7f29ea54-5afa-4381-a2fc-23b532851c88  name Давор Шукер
-- id 7f337f9b-e759-404f-8488-61dbcc9f3910  name Марек Гамшик
-- id 7f91aca1-e46b-4fea-82ba-3192fa91f147  name Ледли Кинг
-- id 7ffe39ba-4abc-4111-b20b-2bf4c0069fcd  name Флавио Рома
-- id 804a086a-9906-4920-a7bc-150effb678e2  name Алексис Мак Аллистер
-- id 8089f5b7-9ac5-45db-a459-bd7ee25dbe7b  name Фернандо Коуту
-- id 8180c92b-d84f-44c1-b0ef-25e324030c41  name Кирон Дайер
-- id 81860e75-4010-465c-9be5-82e2fccb9b87  name Иван Олейников
-- id 8199f6aa-5398-43a8-a6f5-cb6314f76fb2  name Мусса Сиссоко
-- id 81d1e61c-0ce4-4ca2-912a-0646de37c900  name Джон Кордоба
-- id 827019f0-fac6-4e50-81b8-e0a54f8d3e32  name Эсекиэль Лавесси
-- id 82ba6f13-fd2c-44b6-bc3b-afe0a76145fc  name Эдин Джеко
-- id 82ffe678-7c63-4160-aa68-3d15d84f63cb  name Кристиан Бистрович
-- id 8319def0-bfdb-4ad6-8987-b279161aaf96  name Илья Самошников
-- id 831b11fb-20d2-4e10-b9a6-5621a69ce8e3  name Франц Беккенбауэр
-- id 832a409a-b8e2-4d89-aa0f-da633fcae7f7  name Франческо Тотти
-- id 833f55ca-6b73-41ab-83b7-7e3095fa6655  name Александр Павленко
-- id 8342bdee-17bd-42f8-a75e-287b28316e50  name Йоан Кабай
-- id 837cf592-a455-4f58-81b0-f54fda69aff4  name Данил Круговой
-- id 83f02191-871c-46d0-9197-aef2615b46c6  name Андреа Бардзальи
-- id 8483443f-f741-4ae3-98f0-382e74a7806f  name Златан Ибрагимович
-- id 854584b1-dc9b-450c-a3f4-4bf618ac000d  name Ману Коне
-- id 856abc8f-e912-452b-8998-ceb6cb5d1bad  name Джо Гомез
-- id 856cce2f-eca0-43b5-99f4-c498228cf2e6  name Кларенс Зеедорф
-- id 85e244b4-cd7f-420b-bf1d-090ab01cf939  name Гансо
-- id 8641bd71-3b4b-4e23-8794-ae40f6d89ab9  name Хёрдур Магнуссон
-- id 86508c41-47c9-4ba2-9a67-63a321e068a4  name Максим Калиниченко
-- id 86600031-ab22-484f-8438-b073501e5e4a  name Висса Бен Йеддер
-- id 86829d34-39b8-4ceb-9a6f-2eacbdeed908  name Андрей Мостовой
-- id 868e80b3-232e-47ae-b7ff-70450e2012b8  name Найджел Де Йонг
-- id 86bd8bf4-ce89-4c9a-bfdf-73904da9c215  name Валерий Карпин
-- id 872772f2-c0a2-4153-a868-50c7003c083c  name Валерий Газзаев
-- id 877aa099-8164-4a03-8005-1de6ed80ec02  name Гордон Бэнкс
-- id 8800de0e-8b9f-404d-82bb-610bd5005262  name Гильерме
-- id 880a1204-5c62-49b5-95bb-f9ffad1ccae6  name Паписс Сиссе
-- id 88267aa2-d0a7-4832-b0d0-ec9d8fb0aada  name Александр Панов
-- id 88acd059-a1e4-44aa-b6f0-4ab0916af812  name Робсон
-- id 88c04d92-13e1-4924-82eb-6deba5a7a786  name Габриэль Батистута
-- id 88dc7664-04d4-443b-8ecf-d5dbc4ee19cf  name Лукас Вера
-- id 898250d7-c3de-432d-b621-408fb7880c67  name Хорен Байрамян
-- id 89bef299-394d-47d2-83c1-c17ca717fb0d  name Клаудио Маркизио
-- id 8a019c8d-ca75-483a-84f8-8d1aeb509292  name Роберто Баджо
-- id 8a19417f-81d8-450a-bf63-a7bfb1bca89e  name Джованни Трапаттони
-- id 8a441200-600c-4a6c-8633-e005b50c0fe4  name Куим
-- id 8a45641e-c133-448f-b409-068e3c164a8a  name Фредди Юнгберг
-- id 8a57825b-cdd1-494b-8754-c8cee55743d9  name Стив Макманаман
-- id 8a6200d3-9e7a-45e1-93c2-d794f640bc82  name Даниэль Аггер
-- id 8a869f21-e421-435a-b3e3-7e619f155b73  name Марио Гетце
-- id 8a898474-a805-4afc-b6d0-f0d14cd4bd99  name Шкодран Мустафи
-- id 8a914933-f2b5-4d36-a625-c4987016e1f0  name Федерико Инсуа
-- id 8aacf42d-9d5f-4a75-beb0-8f0dff0c14f2  name Андреа Раноккиа
-- id 8acb69f0-4e17-44d5-9525-9483a52f7a66  name Майкл Оуэн
-- id 8afdde6e-b8e6-4825-b15d-5532d28b01d3  name Тедди Шерингем
-- id 8b264ccc-99f4-4261-940a-a427c39470bd  name Федор Смолов
-- id 8b877277-50ab-40dc-a881-3ef435896aea  name Пеле
-- id 8ba5f805-b529-40e9-8d91-c2a5b025ec86  name Родриго Таддеи
-- id 8be5b502-179d-4da9-8964-a909bad81f7e  name Максимилиан Арнольд
-- id 8beee74e-74a8-407b-9dcf-4d0a8d9fda13  name Виллиан Роша
-- id 8c3ee942-701c-4dd9-92cb-23046b0feed7  name Данило
-- id 8c412a83-7669-4f9a-9215-4091a86538e6  name Витор Тормена
-- id 8c8bfc59-56a7-4430-87c8-fa56ff7e32fe  name Александр Анюков
-- id 8cf56d75-688c-4b11-a560-5334b61ce1e6  name Роже Милла
-- id 8d3137e3-88c9-4dec-a244-c45f182ec19f  name Кирилл Глебов
-- id 8d45629c-f53e-42c8-b79a-0f30e849b200  name Чиро Иммобиле
-- id 8d687f2d-ef98-4777-88bb-a2bf937374bc  name Ману Фернандеш
-- id 8de1ef91-d7ce-4835-a26c-7f3b3b606275  name Филлип Коку
-- id 8de2653e-ce78-4a3b-9d8a-da91dbf28622  name Кёртис Джонс
-- id 8ded91ee-ed8c-416b-a6cd-4630f4c88e4a  name Александр Сильянов
-- id 8e712952-f037-4f9f-ac8f-eaa4e3a17c5e  name Ференц Пушкаш
-- id 8eba0b0b-9e5b-47cd-a5c0-5b6465401c78  name Винисиус Джуниор
-- id 8eea928b-9b62-443f-8e24-bfe0ba3fb4cb  name Бенжамен Лекомт
-- id 8f3cd753-9db2-45d9-9295-2ff1facd3ed9  name Марсель Шмельцер
-- id 8f79850e-4e4f-4a28-9a01-8857d9b2e72b  name Давид Волк
-- id 8f910f00-86d3-4818-942f-145e14963260  name Виталий Денисов
-- id 8f99925d-5c37-47c3-b245-26e828944d04  name Игорь Смольников
-- id 901a735e-83c8-4ddc-82a0-3248a92dea5f  name Раджа Наингголан
-- id 9038f5b7-a276-490d-a587-10eb81b35ee5  name Оливер Кан
-- id 9051a53d-1fc8-4bba-8753-75a8feb17c9c  name Ильзат Ахметов
-- id 9082691c-a9fa-482f-9e44-e1ab6444f74e  name Дмитрий Хохлов
-- id 90adfe15-a764-484f-9d3f-8dc4de4f3bd4  name Анатолий Бышовец
-- id 90c56b55-d2e2-4b8c-b902-a665b6cb0221  name Алексей Сутормин
-- id 90d59978-50ed-4e61-a7c1-c5808c5393df  name Жереми Жано
-- id 90f10f94-8516-41cb-b013-1619add14746  name Пер Кролдруп
-- id 91204aec-d38e-489e-8c65-a8c33bdbbd32  name Николай Рассказов
-- id 9122016e-dc62-4f03-84c1-be558947d740  name Михаэль Баллак
-- id 918153e9-ce37-4553-b71a-2cf899915929  name Жоау Моутиньо
-- id 9194e405-6be0-4568-808b-a8d30e5f6857  name Станислав Черчесов
-- id 91e4c760-0665-48d7-8d4c-453d12b50ab9  name Джон О'Ши
-- id 91fbc672-39a1-4291-bfdc-1b9eb47e235d  name Дидье Дрогба
-- id 91fffe82-4858-46d6-b7c8-5894398865cc  name Ян Вертонген
-- id 921b1fac-06bc-43e0-a04e-172b3c0d5ea8  name Рагнар Сигурдссон
-- id 929181ef-9403-4f7e-9ad9-4f95c85f02d3  name Хосе Кальехон
-- id 92b788fd-bbea-489b-9f82-03835c9fc40c  name Санти Касорла
-- id 92f15963-9a40-4bf5-9ec2-8274d652b1c1  name Нури Шахин
-- id 9307736f-2070-4051-8031-428f4dafdfc0  name Кайо Панталеао
-- id 934fb158-7811-4a75-9e67-6e860269fcb2  name Жереми Тулалан
-- id 93a069c6-336a-4572-a3b3-78a96130ecf1  name Роман Еременко
-- id 93f11f34-8415-418a-86bc-81f69053e4a2  name Дида
-- id 93f820de-1d33-404e-ae53-782999603986  name Блез Матюиди
-- id 9423b254-18d2-440f-973e-dde890754a1a  name Александр Филимонов
-- id 942a91c4-9f98-41d1-bfbd-b56724121e62  name Бернард Бериша
-- id 94d77446-137e-47f7-be9b-2f52fd01ecb3  name Рой Кин
-- id 94fc0b10-f21d-4f1d-969a-ed08c889672f  name Бранислав Иванович
-- id 9519850c-c4d5-48df-a2ce-215854122ce7  name Фернандо Йерро
-- id 957f1c72-e420-4e5f-94bb-a63320a91671  name Джорджо Кьеллини
-- id 95b3d9f3-c32f-41b5-a8fc-373eaeb98786  name Марио Руи
-- id 96710c97-606e-43de-b2da-8cffe3b2bd29  name Ринат Дасаев
-- id 968f6699-09fd-4c97-a717-bef1e2a9dbc2  name Крис Вуд
-- id 973132b8-383e-4283-895c-f8529e57a9af  name Жуан
-- id 975a1c54-2e4b-4a04-95c7-7e9f22dfe6c0  name Данни Уэлбек
-- id 97649e02-e700-4cd9-8560-5de1b08088c2  name Эстебан Камбьяссо
-- id 976c72ee-86c8-42cd-9415-3fbdad0756fe  name Фредди Гуарин
-- id 979d3184-4278-4fcc-812c-7643fc8e1e98  name Кристиан Ледесма
-- id 97d09a54-5150-4649-a5fb-3f43abb6f74f  name Игорь Калинин
-- id 97f04f25-14e4-46b1-87df-626d35a1d8a1  name Аарон Рэмси
-- id 98b32c8f-89eb-4c03-a579-16c6f98212a2  name Сильвен Вильтор
-- id 98b48d41-c4c6-45d8-8c17-a458444f100c  name Владимир Хубулов
-- id 98d175e6-1aba-4c7f-aa85-08bd73488807  name Зико
-- id 993abbca-fb84-435c-96c1-0d54c33513ed  name Фил Невилл
-- id 993e2d82-ce11-4294-8f8b-04d4b6dff8c4  name Сергей Игнашевич
-- id 99e9ec02-f756-47bd-ad96-c4d9520ca838  name Алекс
-- id 99ed0a2c-7ac5-4289-ba2b-4563ec9f6301  name Евгений Алдонин
-- id 9a1ade67-e019-4b90-84c4-8dfb2ff60383  name Демба Ба
-- id 9a744cc2-7add-4985-9f28-70b07b19dedc  name Энтони Робинсон
-- id 9af96400-4c55-4b96-a214-6fca3564974a  name Армин Гигович
-- id 9b260106-251a-44dc-bf2b-cf9a479fc395  name Карл-Хайнц Румменигге
-- id 9b411da2-3ea0-4826-8a2e-ec841d22c021  name Зинедин Зидан
-- id 9b6eb241-4d42-420a-9890-de128f6442db  name Николай Писарев
-- id 9c073133-b007-41ff-8637-d5f0db99342d  name Уэсли Снейдер
-- id 9c0ff42f-e74e-4843-b544-83fb39a7580e  name Максим Осипенко
-- id 9c428dc6-8d88-49ea-b4ff-360ac88808ba  name Максим Глушенков
-- id 9c802a3d-1b84-4684-8d2b-29190242b711  name Диого Далот
-- id 9c932e2e-45f6-4bd7-92fd-f2f0d82af090  name Веллитон
-- id 9ca3a0a8-cfd5-475a-90c2-9cd8125a419c  name Габриэл Барбоза
-- id 9ca624c4-b3c1-41e7-af83-f178273cdc17  name Хосе Гайя
-- id 9ca73a5e-14f6-42ce-9cab-f4134bcf1bb8  name Руслан Безруков
-- id 9d9d712b-55f9-4d6e-b122-d28a01c1ec4d  name Николас Маричаль
-- id 9ddd0f1b-b657-47e7-ae8d-e7c65eb3677b  name Виктор Давила
-- id 9de916a5-d3c3-403a-af6a-8c5cb4cbe64d  name Гонсало Игуаин
-- id 9dea7c1f-9875-4cb9-8854-f763a410c6f5  name Карло Анчелотти
-- id 9e43eb5c-d05e-44d5-ae5f-6d9404b9f3c0  name Стефан Рюффье
-- id 9eb32c2d-5ff3-4a37-9d17-44c1ecf17bfb  name Антон Зиньковский
-- id 9ec15412-86a6-49a7-b69f-081c436c032d  name Клаудиньо
-- id 9f3b7e0b-5db9-4237-aa54-f164221d6ac1  name Сусо
-- id 9f5e2e5e-7ea6-401c-ad44-477ceb909d4c  name Сергей Горлукович
-- id a0187c87-b741-4830-a987-1a67c4f0b93d  name Срджан Бабич
-- id a09c68b6-288b-4baf-a837-1d21bc4ccd81  name Дмитрий Сенников
-- id a0e5725d-7f6e-432f-9b7a-ac66874c0aaf  name Эдгар Давидс
-- id a0f32be4-5d7d-41a0-8938-282df74b19b7  name Марко Ван Бастен
-- id a1a200e2-2d4a-4aad-b45c-dbe39f02a5ce  name Марио Балотелли
-- id a1f10206-07d1-47ef-9440-47b701b849e5  name Бителло
-- id a20c061e-0df5-4174-8689-9df1383b7690  name Николас Бурдиссо
-- id a286de98-258f-47b2-b9aa-2d78f3c060a1  name Игорь Нетто
-- id a28a3aa7-562e-4585-939a-d7b5a888b266  name Вангелис Павлидис
-- id a2a8a496-5238-4c23-9636-b2bf4975b77f  name Фернандо Льоренте
-- id a2b555eb-c41b-4d67-a636-8374a1f4e62b  name Савин
-- id a2e9edbf-b1d1-408a-97ec-58bb325b15c6  name Квадво Асамоа
-- id a2fb38be-49fc-4c16-83a8-48341a273df5  name Роман Евгеньев
-- id a3272f92-e7b8-4f77-8982-062a7ce7f1c8  name Маттиа Де Шильо
-- id a3424a47-11fe-4564-803c-7c1adefac0d9  name Данни Симпсон
-- id a34ba3c6-6174-4210-863f-514ade592f13  name Паулиньо
-- id a352aa42-6f3b-4df5-989c-12d071ea2d51  name Никита Кокарев
-- id a3549d5f-2b03-4c76-9e19-8ab838455998  name Андрей Панюков
-- id a3832781-d18a-46ae-b0cf-80cfdbaad50f  name Фредерик Кануте
-- id a3b9409b-3cdc-4e85-aaca-21bfc45071da  name Кун Кастелс
-- id a4070dfa-fe19-4ec9-84a8-e2453cbc4b7f  name Сол Кэмпбелл
-- id a467742c-8918-4755-82fe-b6809ded1bf7  name Габи
-- id a48bd09a-41e2-4e60-86f5-0002bbd6d06f  name Симоне Перротта
-- id a4b824dd-a601-497e-8a7e-d2f30d580b86  name Матьё Дебюши
-- id a4d9c6d4-6b7a-4df4-9a94-651a4f01f502  name Коди Гакпо
-- id a508da29-b5bc-490e-bf6f-944df8ec25f1  name Кристиан Дзанетти
-- id a5b58af6-7ba0-47c3-be3d-eeecc7384a95  name Эмилиано Инсуа
-- id a5e97b63-8e3b-496d-886f-7e629b12edf9  name Хуанфран
-- id a5f3b5b2-f95c-4185-a0aa-cac8b03ab901  name Глен Джонсон
-- id a638c8df-5ee8-47e3-af02-7de2684419f6  name Эммануэль Пети
-- id a6b1c60c-948b-4dee-b60a-721a7ca2530f  name Фабио Каннаваро
-- id a749f284-e6ca-48a6-b268-53f4c784fc16  name Альфредо Ди Стефано
-- id a74ff610-cca0-42b0-8c27-8c2479c20d52  name Адриен Трюффер
-- id a771e421-137e-4931-b233-ab138f12aeb3  name Владимир Федотов
-- id a826f9ae-a0a1-4f11-afae-887f9df1a920  name Ежи Дудек
-- id a85e63b4-aa05-4a2c-b73c-aadff38160a3  name Стефан Лихтштайнер
-- id a8cc820d-d8dd-4028-b057-ee4a6558d2d2  name Фёдор Чалов
-- id a8ef10cd-1326-4cea-8ec4-16a0bd3cbf24  name Карлос Бакка
-- id a940a8ec-454e-44a1-9d18-9d00fcc92a04  name Джузеппе Росси
-- id a967349c-b374-494e-86d4-cef7804321b8  name Орельен Тчуамени
-- id a9c633d8-d741-4e65-bf16-d2df9c654726  name Брайан Мбеумо
-- id a9f2011b-c193-45c1-a59d-96a60f2a4251  name Джонатан Иконе
-- id a9f5fd3e-3415-400f-8aea-7993236f43c9  name Кристиан Рамирес
-- id aa056052-bb02-4941-829e-d110b4d0f0db  name Фикайо Томори
-- id aa629ed0-4fb0-4dc2-a4a4-37d38b1d7e13  name Кирилл Гоцук
-- id aaa8c9f3-6811-430b-af78-4c065761d572  name Федор Чалов
-- id aaada999-4eaa-4d54-8094-a48088662073  name Джордан Ларссон
-- id ab13bcf7-e058-409f-b5fa-1c865323704c  name Марио Гомес
-- id ab1f0505-fd1f-4102-86a2-8b7b98147704  name Йоррел Хато
-- id ab83d7c5-15b6-4266-87b9-363721564a2d  name Дмитрий Полоз
-- id ac16c80d-70e7-4e1a-b61e-c375ec276140  name Фабиньо
-- id ac90021b-d7dd-40b5-9d3a-a6a64ec4e7d4  name Мартин Штранцль
-- id acc3dfa9-13e6-496c-823a-6a2241f81aee  name Патрик Виейра
-- id ad192b60-a886-465b-905e-ff1c2f05370a  name Икер Касильяс
-- id ad40ce52-ae6f-4a10-82ed-40c710e154f8  name Томаш Нецид
-- id ad42ccb5-e1f1-4261-949b-c0e92144113a  name Эден Азар
-- id ad7338e5-691c-4406-9ba7-b40227cbe585  name Деян Станкович
-- id ae012c74-c06c-4bb9-8b8f-271c1e61e522  name Саломон Рондон
-- id ae0d4fa3-0a4d-4db4-8b4b-90c8dd8be074  name Мирослав Клозе
-- id ae1941d9-c2f2-4cdd-948f-4ac6b85844fd  name Уго Санчес
-- id ae7cb51b-1879-41de-840d-558be2ecbca0  name Лука Гагнидзе
-- id aefe55f5-6065-408e-890c-cd6590937ce1  name Георгий Щенников
-- id af3f7aba-0c8c-43e2-ba80-030129209ddf  name Виктор Файзулин
-- id af9f910b-8980-499d-8116-1deb968dfadf  name Денис Бояринцев
-- id afb71cb2-2d5d-42cc-bc75-435818a10c69  name Кефрен Тюрам
-- id afb75544-0ded-4f44-8286-b7777a111215  name Леви Колвилл
-- id afbbacea-1885-4621-b4a2-a866a919d9aa  name Дмитрий Скопинцев
-- id afd71c0f-16b2-4e71-a8a8-1e0a45fe18c4  name Родриго
-- id aff6dcd8-f5bc-48ff-a304-f89254927002  name Анатолий Тимощук
-- id b00a0f07-3798-48c1-a4f8-06afd57f8d7a  name Стив Финнан
-- id b086f580-f8c0-4b38-acf1-c11e30149461  name Дидье Зокора
-- id b09a1750-aa63-419b-b462-577700fa5d58  name Давид Луиз
-- id b0a4f6fa-1c5a-434e-be54-e01b8938392a  name Луис Густаво
-- id b0b69103-69ab-4a90-b6a3-7e92b7c6294a  name Кевин Кураньи
-- id b0c0b2a6-d1a3-4780-9311-25c15ac311bc  name Деннис Бергкамп
-- id b0f131d6-2caa-495c-a5a9-96309a80ca95  name Муми Нгамалё
-- id b11f680f-dcb7-4c85-aec2-d70258e79ec9  name Альберто Аквилани
-- id b127818d-5d43-41be-8503-3c4ba6de3047  name Фреди Гуарин
-- id b143a7ae-f206-4299-a92b-1fb3c9d15f46  name Дани Вивиан
-- id b17e4849-8f66-4afa-958f-559e931a52c8  name Мишель Платини
-- id b1af18cb-adb9-4fdb-b216-9b04ad59a741  name Артур Бока
-- id b1cd6428-2b99-41ae-b045-a4f76fab1ac6  name Муса Дембеле
-- id b1eacd97-3cb4-4945-86b5-3220fb5d5450  name Арис Адурис
-- id b1edd331-da32-4737-8747-33b5d378b565  name Вальтер Самуэль
-- id b245a6b8-6a8d-47f0-a3e5-40bf3216f9de  name Гарри Кэхилл
-- id b2893aeb-210a-430c-9bbe-24a8edbc040c  name Георгий Мелкадзе
-- id b2e3312b-21fb-47bb-bcee-87c7a01cf2ff  name Клеман Шантом
-- id b32f00d5-f41b-45b6-9fee-277509ba2045  name Кшиштоф Пёнтек
-- id b3795374-010b-42f5-9bc7-4663e3063f1c  name Лусио
-- id b37efc34-41e5-4d47-b9cf-9d60a1e49789  name Денис Колодин
-- id b3b3dbc1-387c-4c9c-b788-fbcfd43a1038  name Милан Вьештица
-- id b3b4a351-67e6-48e6-abb3-8ff7b6a58d66  name Алессандро Гамберини
-- id b410bde1-874d-4e82-b1ad-a44bf1f1b7a2  name Невен Суботич
-- id b41f2aeb-7459-45fb-87ad-2873f6164b2e  name Марат Измайлов
-- id b45f2556-e0d6-4169-8e2f-e40292ed1167  name Юпп Хайнкес
-- id b4755be0-ec38-4cb1-8d70-4c17982e0f4f  name Гути
-- id b49e606a-6312-4d8b-9254-ae9c9644ca8f  name Майкл Каррик
-- id b4e312ed-a26d-446e-b131-cf59eea264ff  name Клаудио Каниджа
-- id b4e93545-8055-46fa-92c1-309291cd252e  name Данни Мёрфи
-- id b55959a9-5d80-4324-9026-8be3141da28d  name Халк
-- id b5a06f62-5db1-4a4e-985c-e4eafa2cec56  name Даниэль Старридж
-- id b6337943-1f19-474a-89d9-2eed0837d581  name Тиаго Мотта
-- id b6628bed-b49f-4942-8151-3c1838e9f193  name Евгений Ставер
-- id b66853b4-6a48-4ef3-a7aa-f87bf13c807c  name Торстен Фрингс
-- id b6acee85-7acc-4ea6-b789-1accea99dfda  name Джанлука Виалли
-- id b6df9db4-f0c5-44b4-8799-00fc2c81b8dd  name Игорь Семшов
-- id b70b2b8c-09bd-4ed6-ad21-44e7079240c1  name Лукас Бельтран
-- id b735b833-52ec-4d09-acec-3b2981a5b9b3  name Андреа Раджи
-- id b741a07d-0249-4b11-a14d-321a0e4296c2  name Ахмед Мидо
-- id b7d6dfd1-48fb-41f8-b1e2-22831185df3e  name Александр Горшков
-- id b7e0cf37-d82a-4d99-9fa5-b862ec5b9b4a  name Рикардо Родригес
-- id b852264e-581c-42fa-9e3c-791172bc0863  name Томаш Губочан
-- id b852dff1-2e4b-4b7c-8fbc-dfd1e7845453  name Рикарду Куарежма
-- id b86be3e2-b1aa-422c-8bcb-b7a6b691c593  name Адриен Рабьо
-- id b8a9a7c8-d5d9-44a9-9950-d4e92efdf203  name Джонатан Дэвид
-- id b8ac2c21-b703-44de-9058-fae2e2086d16  name Алексей Батраков
-- id b8ad2b50-cb55-4e5e-83ac-49e152ff3ac4  name Тео Бонгонда
-- id b8bf1cb2-9007-4f04-b66e-686157a3ac23  name Асьер Ильярраменди
-- id b8d6ac88-632f-4966-bf02-e2f9f3adb68f  name Риккардо Соттиль
-- id b8d6b610-d1f4-4b1c-b7ca-f4baf71318d8  name Нельсон Семеду
-- id b92bb4c9-79fc-4e7a-b72e-9ad084c38579  name Пер Мертезакер
-- id b934f3a9-54ad-4a87-a597-2b48a13d4f50  name Омер Топрак
-- id b947aae8-8cb8-4ebf-9e82-670f5da890e3  name Владимир Рыков
-- id b9b76649-ff94-44cc-9a7d-438b3097b292  name Альберто Джилардино
-- id b9ce4e44-d5c6-40a5-957c-91ad14d74893  name Андрес Д'Алессандро
-- id ba247a83-fca2-43bc-b523-1d51f4a848cc  name Габриэль Мартинелли
-- id ba5a4416-2aaf-467f-bf7c-edd5e648f111  name Андрес Иньеста
-- id ba659b28-c88b-4daf-94fa-9f453d74c5ae  name Флоран Малуда
-- id babd5ec0-4db5-4d0d-9ddb-2778460cc969  name Луис Муриэль
-- id bad1eb0a-d8c8-4c82-bd0f-671dcd193681  name Эмерсон
-- id baf60c58-a93d-40e5-a938-94c6dd654d7c  name Бибрас Натхо
-- id bb2b8a50-d596-4993-85e6-b0264b13ef51  name Магомед Оздоев
-- id bb5369f2-19cf-4a2b-8b5c-38eca9c4e957  name Марио Манджукич
-- id bba4bb22-04a3-4903-8ce0-fdab65b8f8bd  name Майкл Доусон
-- id bc922b91-95ad-4167-97c2-df6b6b484a0f  name Массимо Оддо
-- id bca15887-6746-480d-bc22-d9f601b50905  name Брайан Робсон
-- id bcbbaeb1-6778-4461-9d2f-5ac546e94092  name Ники Батт
-- id bd246ebe-73f2-4c7f-8227-586e0be28e35  name Гиорги Мамардашвили
-- id bd424972-30c0-4ab4-8f57-50a23c1123f4  name Джонатан Зебина
-- id bd59c330-71fe-451b-8c5c-7978ac490a1b  name Дезире Дуэ
-- id bd702460-4d40-4509-9048-df317f8dd95e  name Матиас Норманн
-- id bd76a961-e8bf-404c-a538-606a75d3cf8c  name Себастьян Коатес
-- id bdbe1c7e-b80e-4a49-9023-6b5ca6624b53  name Франческо Тольдо
-- id bde20e95-2eac-4266-a303-464c3d7f8eb5  name Алекс Крал
-- id be1f6386-68ad-4a51-af89-9717992973ab  name Элдор Шомуродов
-- id be4c2141-6a55-4bd7-bda4-5edf0485b381  name Марек Янкуловски
-- id be8ddd1a-e12b-4a7d-9855-9d05a7844149  name Руслан Литвинов
-- id becd16b8-501c-43d0-a282-7a49f1077a2f  name Андрес Палоп
-- id bed43db1-40f5-4b1c-882b-3f59388303b6  name Сами Хююпия
-- id beeb76bc-950d-44c8-9007-a25277b7ae04  name Сергей Паршивлюк
-- id bf0f6c1b-8e4f-4be3-8534-2928b591b33f  name Питер Осгуд
-- id bf467905-3a49-4745-82b2-4549e095f29a  name Лэндон Донован
-- id bf842376-f68d-4d4c-a429-850a7ef545fd  name Максим Самородов
-- id bfa6df26-af9b-492b-8a3b-99249fad7b17  name Хуан Мануэль Боселли
-- id bfb729bd-75ae-4156-badf-f89e4a14d2fd  name Карлос Вела
-- id bfcee9ff-671a-4e0b-a772-b74f40c1fc84  name Хасан Салихамиджич
-- id bffab041-573e-40ae-93ab-54da95e0cf85  name Хуан Капдевила
-- id c0003d49-9997-4b35-aaec-9567f7c3eb45  name Хироки Сакаи
-- id c002c739-f6bf-4e52-bf77-fca401971188  name Элвер Рахимич
-- id c02c507e-527a-43f4-b460-a6db3d84fd6b  name Себастьян Руди
-- id c0969c52-d8ac-4b55-9077-27c8d3013f0e  name Себастьен Фрей
-- id c1501590-9159-4e6d-a8eb-a7960346b2e0  name Жорж Микаутадзе
-- id c1fdda41-17f2-41a5-bc00-5d8a51188fd6  name Никита Симонян
-- id c235a5dd-3c29-41fc-be9c-035c5338b992  name Транквилло Барнетта
-- id c2442749-74fa-464d-beea-c78c856e6abb  name Валентин Пальцев
-- id c2853024-f447-45da-859a-7cede8f3173e  name Рожерио Сени
-- id c36f983b-3a31-48a9-9467-3e67593a18e5  name Милош Красич
-- id c381a506-b885-4816-b6c6-f2a369e9a9f6  name Фабио Капелло
-- id c4a07949-9daf-4b18-9e27-ccf7aa127cc9  name Дэвид Бэкхэм
-- id c4dc89ac-5a47-4cf8-8290-8a83af6a2f0a  name Александр Солдатенков
-- id c579f8c4-74ea-4d4f-9e34-82b773166bcb  name Даниэле Де Росси
-- id c5b4edb1-633c-4c29-92b1-0b50889de453  name Марко Матерацци
-- id c5da3913-1205-4915-a96f-f65f65b76bbd  name Сами Хююпя
-- id c63486cc-d6e0-43ca-87ef-58dcd918ed89  name Крис
-- id c71b5ff0-fc24-4a2a-b5f8-c1bb916ec286  name Анте Будимир
-- id c72942c7-de00-4d60-bcea-b240f16a86d6  name Мануэль Угарте
-- id c7674201-7346-482d-b47e-e96a5a89337a  name Иван Ломаев
-- id c77102be-a888-4846-a226-3e9593742bc8  name Арьен Роббен
-- id c7c556b5-c530-44ea-812a-7b6bf688508b  name Жано Ананидзе
-- id c7eabef7-d77f-4eb3-8dc4-be9c2f091203  name Даниил Уткин
-- id c804bbc1-dd64-4fc4-babb-593ad64d2287  name Патрик Габбарон
-- id c809e397-0332-47a8-98c1-5e4c29383cfc  name Стеван Йоветич
-- id c80b02e1-6d1a-4469-bc88-b7bb31f699b4  name Раймон Копа
-- id c8116b9f-d6b7-4709-accd-0e68b940350c  name Микаэль Лаудруп
-- id c831f307-362f-4ec2-b825-bb447e66c45e  name Ненад Томович
-- id c86b5c2c-1118-4976-88c1-1ac21d5b8854  name Мануэль Паскуаль
-- id c8abcbbd-4c78-4708-a5c2-ded2818f0f01  name Радослав Ковач
-- id c93d59e6-a563-40c3-952c-e18a613ecb6b  name Аксель Витцель
-- id c9451609-e303-48fb-bed5-2f8fb035acb4  name Максим Гоналон
-- id c99908af-1479-4fc3-a610-62f855e41103  name Кристоф Жалле
-- id c9c984f9-6683-4437-9240-82af45ac6d2f  name Фред
-- id ca19c170-27e8-44ec-84b3-5b62965d8d8b  name Бенуа Шейру
-- id ca95659c-4468-4970-a349-37a4f166215b  name Родолфо
-- id cacf7eac-d9c4-4e91-8611-5ac03be49e17  name Радек Ширл
-- id cad012c1-94b1-476a-a65b-94072c5aff76  name Джи Сун Пак
-- id cb06452a-b955-42b5-978f-215798c5ad80  name Робби Кин
-- id cb308799-de77-4ad0-b5b0-b111b604c101  name Роберто Манчини
-- id cb3c2bc7-1d6d-4175-8d1e-acb24918caa3  name Роман Зобнин
-- id cb464e19-3de4-412f-be79-f8afea3cd0bc  name Санти Мина
-- id cb8424e7-2469-4795-b9a7-35395aa594ee  name Александр Ерохин
-- id cba1307a-ab66-48fc-a3f3-b7d4ca0d4612  name Бобби Чарльтон
-- id cbb33123-ec65-474e-aa01-19641f832151  name Дмитрий Торбинский
-- id cbb7d9cc-953c-4ace-916e-79d4fe03b878  name Рио Мавуба
-- id cbc673cd-4476-4840-a6c7-89bc7ed1ae88  name Хави
-- id cc2274aa-6abd-479d-b080-f8d1e76b5309  name Жан Макун
-- id cc657831-44b3-4aef-9d13-abadd3473804  name Гари Линекер
-- id ccd2ac7f-7082-437b-ac37-fffd79a94f78  name Лоран Косьельни
-- id cd5a157b-4af8-4546-87ab-f1f883300fbc  name Хосе Хименес
-- id cd6e0b88-ef37-4533-8ca3-a16ee0fd2f8f  name Диего Бенальо
-- id cd91be61-b0c4-4a99-b9b8-8aaceb2dd99b  name Сергей Пиняев
-- id cda14ee8-1f4d-4f41-889b-aaa6316cda71  name Марко Донадель
-- id cdb55200-4946-419f-b41c-1ec94d0c87f1  name Александр Ширко
-- id ce4e0d29-2190-4212-b0b7-a8f1f1e1fa89  name Эрлинг Холанд
-- id ce569ac6-e9ec-416e-abf4-9d9193e0a5a4  name Титус Брамбл
-- id ce6903f3-e1de-4778-8b76-de51196b8bce  name Месут Озил
-- id ceb10895-7fa0-4d0d-9a84-c2f7fa6fbe8a  name Франсиско Хенто
-- id cf160dc1-0a28-42fa-82b3-43cb08891684  name Ян Пол Ван Хекке
-- id cf182c8e-c6a2-4056-a839-a904505fc55c  name Эдвин Ван Дер Сар
-- id cf46662c-2e0f-4c90-b6db-b08f85fabc3c  name Гленн Ходдл
-- id cf58ba39-3231-4935-b416-c534d1cbd0bb  name Даниэль Карвахаль
-- id cf5fcfbc-2d68-41e5-914e-200fce082cd5  name Николя Н’Кулу
-- id cf601f82-632f-4e46-98d6-e01babc82487  name Збигнев Бонек
-- id cf7a55c9-2ee4-4026-88cb-11d265f075a6  name Янник Карраско
-- id cf96334e-06d1-4b36-b969-69f2f6e18729  name Зелимхан Бакаев
-- id cfa5dc15-a94c-452c-be75-baf6030ab1f0  name Олег Романцев
-- id cfcb4217-6541-4e86-ba88-17571f633f78  name Шарль Каборе
-- id cfeb84fb-8a16-420d-9c62-38271a7d82d9  name Висенте
-- id d00fe68b-301d-4b41-8c69-3791e69cee22  name Эдгар Севикян
-- id d0e63416-f42c-46c9-aa0a-e8cdeba154e2  name Флоран Бальмон
-- id d137feef-c19b-45d4-b2d3-5c82aaac5647  name Данил Глебов
-- id d161e979-6aed-432b-acee-adff00755c74  name Хорхе Карраскаль
-- id d176e0ac-964f-440d-a129-9290e85f5483  name Ахрик Цвейба
-- id d26511dd-571b-4485-947f-d2e27b3e1df0  name Неманья Видич
-- id d26d9838-1285-42bc-a1c8-d7bb1e7834e4  name Оливер Бауманн
-- id d27cd094-95ae-4707-a304-48968c12fb1f  name Кевин Гросскройц
-- id d2c38ea6-4c5a-482c-aa30-4b55c9389483  name Джулиано Симеоне
-- id d3399916-6f98-443d-8def-36bd87139a5c  name Кристиан Нёргор
-- id d34568da-2512-486b-9e52-a9b3b927f7c3  name Александр Максименко
-- id d35ccbe2-cb80-4092-ba17-a1b7393d4f2f  name Энди Коул
-- id d360a101-f121-4dec-b354-9510fdb9074a  name Криштиану Роналду
-- id d39d6e60-f84f-420f-8340-b8504cebdae8  name Евгений Ловчев
-- id d3c5c79a-4368-4288-9cea-a44ee2cffae1  name Рууд Гуллит
-- id d41c5aec-155b-42c4-bab2-4fbc53e1e948  name Давиде Дзаппакоста
-- id d4633c34-5d51-4ba5-9ed7-7a0a89ba820a  name Эльсеид Хюсай
-- id d47f6c31-30bb-4453-b506-0ff1f9112300  name Федерико Бернардески
-- id d490479d-4c8c-4ab0-b6af-cc03def5e154  name Иван Игнатьев
-- id d49a7bab-6a82-446a-b125-6a5d0f942541  name Дунга
-- id d4a69f5e-91c4-4528-adac-2545e7aa7899  name Луис Фабиано
-- id d5004560-f0d5-4e4e-a893-76f1e4e148fd  name Франк Рибери
-- id d50b7de3-f98f-49e8-aa4e-15ad4577b4b3  name Джимми Бриан
-- id d5b64ca7-9541-4669-8ccc-34dd3546a090  name Юрий Джоркаефф
-- id d5bb0cd3-1203-4761-b761-85694cac95eb  name Егор Сорокин
-- id d5d1ef88-32f3-4ee3-9f45-fc81937057fb  name Осман Дабо
-- id d66614f0-766e-499e-b394-ffcc2f36daca  name Себастиан Шиманьский
-- id d67fb57a-ab76-480e-b739-86cd3d6c5e77  name Мамаду Сако
-- id d6f52352-3631-47c1-9184-f277e0f9f687  name Дмитрий Парфенов
-- id d6f775a9-7ec2-47f3-bbc0-8166c03296ba  name Мирча Луческу
-- id d759eb5e-6b02-4d85-98ef-d57ef1e821c1  name Кристиан Куаме
-- id d75e2422-b695-46e3-815d-977618d86332  name Зион Судзуки
-- id d7b172cc-bb90-4c47-b476-a4d2a6654440  name Эрик Бикфалви
-- id d7da0a58-636e-4919-a179-8cbd65f8a46b  name Томаш Росицки
-- id d802508f-be52-4572-9bc5-ee48e0e65cf1  name Джанфранко Дзола
-- id d81d1ccd-af53-473e-8f89-57b47856cb15  name Луизао
-- id d860d7d9-d275-4a34-a7ba-cc1e373fcb07  name Матвей Сафонов
-- id d89c00b3-c762-4ac1-a7f5-3d6a79a2d8a5  name Рикардо Монтоливо
-- id d8b51a62-805d-44dc-ad3f-d0630eac905a  name Илья Лантратов
-- id d932c5ec-cb45-4418-8231-948c839e1f0f  name Франк Веркаутерен
-- id d9581133-c558-4d2c-b722-70e39bb37b26  name Вильмар Барриос
-- id d995e840-595a-4ba4-81a7-0649c15b8c3e  name Эктор Беллерин
-- id d9cd30d5-1570-4258-914f-7eff40991513  name Роман Вайденфеллер
-- id da4c511b-67f7-41fc-a3bc-08b9e9b0b674  name Аллан
-- id da836db3-219e-4985-9b3b-d8ceeed7a25c  name Джоуи Бартон
-- id db301b6c-eba4-4863-a0a2-a5c059c14e49  name Нино
-- id db3d11ff-1948-4909-af54-fe874720ea33  name Адриан Муту
-- id db3d2b13-46c3-4489-beae-2c7a1d485f94  name Джошуа Зиркзее
-- id dbc3eed1-c02e-417e-9cb8-03ba827c1bd4  name Шей Гивен
-- id dbcd8a3c-105e-42f1-9a8a-cfd633c8bf38  name Хулио Крус
-- id dc209b67-a3ca-4e79-a318-66d9ec6bf90b  name Томмазо Рокки
-- id dc82121c-fc5d-4f7f-84b1-9f1f86bef855  name Илья Вахания
-- id dcd801ca-7125-478b-9c5a-2ab91d60727d  name Адриано
-- id dd0452f4-0038-4a9f-ad64-630e75f3a901  name Андрей Кобелев
-- id dd209fe0-5fcb-40dd-9c72-01dd3b7cf9b5  name Филиппе Коутиньо
-- id dd35fa2c-24f3-46b0-9ead-e5837c30f00f  name Марио Кемпес
-- id ddb184ef-346e-4ce1-9313-472758180431  name Бас Дост
-- id dddee0e7-c673-4536-a4ee-e71ef933bb73  name Эван Ндика
-- id de0a4634-02cd-4163-b292-b945c105b17f  name Данни Блинд
-- id de4d7d91-7ae6-49cb-8bf4-2889ee185576  name Кристиан Вьери
-- id de9739b3-463b-491c-b659-9c1c080e1288  name Роберт Левандовски
-- id de9e4c5b-b501-4baf-a05f-b9d04814c15e  name Жоао Гомес
-- id dedc959a-91fa-44e8-a681-f033a042cd22  name Димитри Пайе
-- id dee13fb1-5100-40ec-99f6-c38593653366  name Серхио Асенхо
-- id df611173-5ff2-41fe-806b-c977572a22e7  name Руслан Пименов
-- id df6ab9e2-b9b6-481e-b153-41c0bb919a57  name Андрей Аршавин
-- id dff33f6d-ced6-4222-bf7b-d4f142e92eff  name Антони Ревейер
-- id dff9c997-b805-4944-bc2e-3fb8821b16f2  name Зурико Давиташвили
-- id e04c3b57-a696-4033-be73-2250e665fc49  name Джордж Бест
-- id e04fc92c-830d-4427-a080-93ce705f42b7  name Руслан Нигматуллин
-- id e0574964-6d02-4cc7-9439-ddc127936534  name Дмитрий Сычев
-- id e07bc2c3-e23b-4307-8db4-1b2383d6914c  name Кейто Накамура
-- id e0c4d71f-9d81-49e6-8e0c-2ed7833c514c  name Альваро Негредо
-- id e12e5651-1792-41d4-a8fd-73de23f09aa3  name Микель Оярсабаль
-- id e149ab89-682c-4dc6-9ccf-f58a77406241  name Валер Жермен
-- id e184fb80-d3fd-49e1-9b4b-c278b92df308  name Юрий Жирков
-- id e1dfcfa6-7d0e-4bf4-afb8-a082b6af2cf6  name Эзекьель Барко
-- id e201faf3-97d7-476e-a1d4-297f2088450d  name Кака
-- id e249f5e4-0c80-4207-9f29-2fdbeb06be71  name Сергей Овчинников
-- id e24e14ee-0339-4c75-89b3-5f56ec05d267  name Антон Миранчук
-- id e270dacf-a2fc-42b5-9be5-f7a382fb6f60  name Обафеми Мартинс
-- id e2a275af-4d51-4b91-8b35-2e38950bbf5d  name Матео Кассьерра
-- id e2b74972-9b75-4ee2-a387-b6c6acabb901  name Ноа Садики
-- id e3a11a82-f358-406d-ac4c-675feea027aa  name Рауль Хименес
-- id e42a079f-bc48-47dd-8966-e047eca05af9  name Луис Диаз
-- id e42a1e77-ae27-415b-b3d4-dee743d96fae  name Чичарито
-- id e4a25141-d508-4355-93da-b4f0fdd45360  name Оливье Дакур
-- id e4b3e7b1-79b4-49d6-af56-759a7b1ddcf1  name Симон Рольфес
-- id e4bc3ae3-d9e8-41b0-8987-3f4d1e6b3d3b  name Джанлуиджи Буффон
-- id e4c3c9e4-8c9d-4e9a-8c16-749aa7fcee8c  name Диего Милито
-- id e4c808c8-98cb-4fb0-b14c-747fe5efb251  name Иан Раш
-- id e4f61f08-1ec8-42e8-b667-dfb475d74007  name Кирилл Панченко
-- id e50e00df-3208-4995-a156-6e86642c7c7b  name Диогу Далот
-- id e5c507c9-7486-4e14-b9a6-1aedc344d516  name Мацей Рыбус
-- id e5d78e77-c7fe-4093-9bfb-ea2d2c461dde  name Далер Кузяев
-- id e5f7fd3f-518e-44b6-ae9f-2587a5078756  name Франк Ангисса
-- id e6b283d8-e24e-49ec-992d-46d714e128fc  name Дуглас Сантос
-- id e6e615cc-b662-4608-88c5-7f73531a43b7  name Хетаг Хосонов
-- id e6f3cefa-3171-4962-89f1-d72f36e6372b  name Дмитрий Баринов
-- id e742d7e9-0b04-4bd6-b804-fb1193da20e0  name Шарль Де Кетеларе
-- id e74e685f-1895-4566-8d14-a8c6b0ed4a12  name Сейду Думбия
-- id e7b24583-36ec-4409-9d93-7a7f3d960015  name Иван Обляков
-- id e7d48fa3-4aa4-405a-9c3f-9c1b8a2b669b  name Якуб Блащиковски
-- id e7fa6ef2-83e6-45f0-b2c3-f45c1ff27c61  name Гёкхан Инлер
-- id e815bcb4-e6b0-4b12-aa86-09b6c95be9cf  name Лукас Лейва
-- id e83475da-70ec-490d-971c-fe8d87588190  name Педро
-- id e8653a2e-17a4-4f0d-8109-9c54bf6c1afb  name Пеп Гвардиола
-- id e871155e-5531-4044-bb56-55b272cf0a8c  name Паулета
-- id e896277e-0780-4dbd-b89f-f881cb09da7a  name Алексей Миранчук
-- id e9384bfe-848f-4164-b086-245249a0f4ce  name Мойзе Кин
-- id e9443c75-3729-4c87-aa5d-f66e72ab4dab  name Марко Пароло
-- id e964ccef-51e2-49bb-a2c3-08670e603f6f  name Эмре Белезоглу
-- id e9a1b41c-4792-4738-806a-355307551384  name Диего Годин
-- id e9f3dea3-16c3-405a-930b-a11c5170e164  name Вальтер Гаргано
-- id e9fee0c6-3222-431e-aeff-df8cbc9502a0  name Бакари Санья
-- id ea0cfcc8-29f2-4d76-a5ab-eb62959112bf  name Ханс-Йорг Бутт
-- id ea1da5be-7365-4452-8d58-c2225ddf67b6  name Чезаре Мальдини
-- id ea45d822-73fb-416d-bcf6-929ba93bce74  name Урош Спайич
-- id eaf9ca1b-6f4a-44d3-85c3-f03febb373b5  name Луис Суарес
-- id eb28517b-d214-43e1-af9b-fbedc76fbb00  name Дуду
-- id eb2ec674-6d2b-4420-b590-dce1b967c639  name Кристиан Рамирез
-- id eb8eb329-80bf-499d-81dd-d8df7f815f38  name Гёкдениз Карадениз
-- id ebe12d0b-bcd8-4ca4-b504-2ddd891e6aa5  name Лусиано Гонду
-- id ec0a5438-cbb1-450e-b005-9891db4617eb  name Виктор Классон
-- id ec310851-e7f5-4851-a828-50300322a40e  name Райан Гиггз
-- id ec5ed27f-fbb4-4dc4-8bd0-c9dd991d5361  name Нуну Гомеш
-- id ec762158-1051-4b45-bfb7-cb4a6570da00  name Никола Залевски
-- id ec8efc43-956b-4298-8bf2-2ea2c08de51e  name Олакунле Олусегун
-- id ecc85d27-72e2-4eee-901c-0195df480dc9  name Стивен Цубер
-- id ecda8563-9468-4b24-8f3e-8abf0c6fceda  name Рикардо Карвалью
-- id ed49b07b-075b-4521-b0a8-a56d3242afc5  name Рафаэл Леау
-- id ed62a2b6-fa0b-493a-8ea8-b214e9a01e61  name Никита Баженов
-- id ee0ff146-b331-42b8-85e4-9a819b309543  name Гарринча
-- id ee8bbb52-05ef-4e13-9bde-561f665ddd56  name Мартин Шкртел
-- id ee9d0c79-3ada-4c9e-b71b-85e48f9789df  name Адель Таарабт
-- id eef9dd1a-b372-4f24-a781-d12b578068b3  name Мануэль Ладзари
-- id ef173da8-b75c-487a-a599-6860923e2243  name Роландо
-- id ef2b6ba2-a701-474f-9734-4b83e9799d60  name Нето
-- id ef62c67d-cb81-412a-bef5-c3e9068fe48a  name Дитмар Хаманн
-- id ef72f0c6-fd49-459e-9025-75d4b1c4bea5  name Тони Вильена
-- id ef85ba36-9582-4dec-b356-95590e4e5282  name Марк-Андре Тер Штеген
-- id ef8d78ac-26c4-4bbd-8d1d-4f08cfafbd9b  name Роман Широков
-- id efd2b5d5-f857-4376-a64b-e4bc05f309cd  name Рис Джеймс
-- id efede1b1-de9f-4d0d-b771-b1f2485439d5  name Деян Кулусевски
-- id f01a0089-42f1-4581-9c2f-d264ff273a29  name Франсуа Камано
-- id f03d297a-ce1b-44ba-907b-466923592cf4  name Джермейн Дженас
-- id f06160ad-6f51-47fd-8565-8a7741e51e3d  name Ахмед Муса
-- id f0fcce4b-b5fd-487f-b2e6-18aac7c6b611  name Зе Роберто
-- id f0fe8a9a-9d72-4118-b29e-26fb9910fc0b  name Стид Мальбранк
-- id f0fe9016-9a5d-4cc5-be68-7a736ef585a0  name Гонсало Родригес
-- id f173a2c1-a34f-4126-a14a-9d92318c2b24  name Константин Кучаев
-- id f19f9376-133b-419f-9d2a-4bc955e33d24  name Виктор Вальдес
-- id f208e6bf-2f5c-4779-91ae-3df54cae5268  name Адессойе Ойеволе
-- id f28ef5bf-54c2-47a4-90b3-eb1a54c86861  name Владимир Гранат
-- id f2b46655-8e0f-473c-990e-5063861ceee9  name Эрик Кантона
-- id f2ba6039-c30e-48be-9f09-a19a96e2f098  name Гжегож Крыховяк
-- id f2cd130b-adbc-4af1-ad3c-14889000f0ad  name Валентин Иванов
-- id f2eb2b46-2013-4a03-a960-5526dfd0ff91  name Кристиан Маджо
-- id f2f673f9-efe2-48e8-96bc-1c6d822e07b3  name Николай Комличенко
-- id f2fe1cbe-32d8-4fdb-bda3-7a9d4e461dcf  name Карим Бельараби
-- id f3596bda-eed4-4b6d-81cf-7b6c69d807f4  name Вячеслав Малафеев
-- id f35f0b3d-f159-4116-a3ee-56a631e1e71e  name Эурелио Гомес
-- id f3c6afb4-0157-480e-a081-8dfb64f913d3  name Лукас Мартинес Куатра
-- id f40ccedd-a708-4a15-b69c-c2cb4615b845  name Пол Скоулз
-- id f41056c3-86fb-402d-a1e2-f9696be96e01  name Начо Фернандес
-- id f427e696-3f7b-4c5b-ae28-8cc649a47455  name Кейсуке Хонда
-- id f4a465fb-1cc5-4497-bcbd-122a92c65758  name Дмитрий Рыбчинский
-- id f50533ec-54c8-4719-9622-6b518b18ebd3  name Алекс Мерет
-- id f587c657-608c-4ed1-8ede-b62c0fb13ed7  name Тим Визе
-- id f681446a-01a6-4144-ad9e-44acf712a162  name Тимо Хильдебрандт
-- id f6932dd7-5b57-46da-a735-9623db17e2ff  name Хулио Круз
-- id f6b804aa-f9a4-4b73-8af3-be27d460f30b  name Сесар Монтес
-- id f6be988e-5b95-4a64-b81c-07178f9b6706  name Густаво Мантуан
-- id f6d8f7db-a21f-4a6c-9510-b74b93343615  name Эйсебио
-- id f6dfc3e7-a15a-4dce-9c89-eb1509407b55  name Петер Шмейхель
-- id f7157194-558e-47a7-8a4c-2c54593c0571  name Ивица Олич
-- id f7429ee8-4b64-4628-9d56-46e353281646  name Георгий Джикия
-- id f770a41b-e23a-443f-b479-251235700ce5  name Самир Насри
-- id f7b6c725-419c-4bd8-b56f-a9f72181293f  name Йежи Дудек
-- id f7ea12f1-7f4e-4829-acd3-0d10c262d8a2  name Дэвид Джеймс
-- id f805cea6-730e-48fe-b224-c57a3a594881  name Никита Каккоев
-- id f82e88a7-3f01-44cd-8a65-533c36145566  name Александр Филин
-- id f85bd6e8-43e0-4ab6-bef6-7f1bcacefa04  name Расмус Хёйлунд
-- id f85e4106-1587-46f3-a943-e83012812579  name Мапу Янга-Мбива
-- id f8da20f6-1d4c-4431-9ac6-3c613cd487a4  name Фабио Ливерани
-- id f8da8b19-01fc-40b7-9bbc-784154daa25f  name Игорь Акинфеев
-- id f95d6ded-1947-4975-94e3-1f6d4927dd28  name Садьо Мане
-- id f9c1780b-da09-4f49-9211-ae37913321e5  name Паоло Росси
-- id f9fb62b7-d42e-49ea-a7c3-dc23f14fd10d  name Петр Зелински
-- id fa394073-3ce2-471c-9a05-946330475d6e  name Наиль Умяров
-- id fa687d29-7c23-4ddd-a94f-3012a5b34665  name Микел Мерино
-- id fa7fcb88-9c50-4f71-bdf7-aaa40485cc8f  name Лукас Оласа
-- id faaa6f96-74a8-4058-8aa0-9e36eae78ffb  name Дженнаро Гаттузо
-- id fb9cea01-af8c-4be3-8107-f48ec4722581  name Антонио Кандрева
-- id fbdc1000-85ed-4ec1-9191-9c1bf7cda1c1  name Павел Яковлев
-- id fbf0057e-327f-401c-b575-0f71403ecd76  name Георге Хаджи
-- id fc0feebd-2bed-4127-9700-330e8e369b32  name Кристофер Мартинс
-- id fc2c3ed4-38c5-4050-8c01-db339f4b59cd  name Лотар Маттеус
-- id fc414ae6-f71b-44fd-9a73-146fdb9acdde  name Виталий Дьяков
-- id fc79c5fc-acd9-4260-86e7-583c0faa54d1  name Роландо Мандрагора
-- id fca59954-84b3-44aa-8b49-5af95e5d53ae  name Владимир Бесчастных
-- id fcb103df-7312-4532-9b81-051a58ad9112  name Паоло Мальдини
-- id fdbe790a-146b-4b1c-884f-549e500cc3ef  name Шарль Н'Зогбиа
-- id fdc3e34d-0909-47c0-b2a6-bba3dd8dfb6d  name Хосе Рейес
-- id fddcecff-163d-4ed7-9368-6e5743b7a8b3  name Антон Митрюшкин
-- id fe0ddd40-b0e1-4c4a-9b3a-1489330aaf87  name Андрей Лунев
-- id fe6eba9c-0abf-44b3-a212-1dfdb813d241  name Алессио Таккинарди
-- id ff04b4d3-676e-46e6-ac64-2860527c624f  name Александр Мостовой
-- id ff1586f8-8ff8-42ee-a173-3c149466d5f9  name Вальтер Бенитес
-- id ff2291be-0ca6-416a-b8b5-f725f66b3ba4  name Алексей Березуцкий
-- id ff6cac4b-f68a-4a98-9cc4-3d51bf286ac9  name Сеск Фабрегас
-- id ffc60b09-cfc3-4bee-8588-0ccad3b064f5  name Сальваторе Боккетти

ROLLBACK;  -- change to COMMIT only after manual review
