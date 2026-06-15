-- INSERT new player cards (checked against the deck by canonical_key on 2901 cards; duplicates skipped)
INSERT INTO cards (name, name_en, category, category_ru, forbidden_words) VALUES
  ('Хвича Кварацхелия', 'Khvicha Kvaratskhelia', 'player', 'игроки', ARRAY['Хвича Кварацхелия','Хвича','Кварацхелия']::text[]),
  ('Гиорги Кочорашвили', 'Giorgi Kochorashvili', 'player', 'игроки', ARRAY['Гиорги Кочорашвили','Гиорги','Кочорашвили']::text[]),
  ('Жалолиддин Машарипов', 'Jaloliddin Masharipov', 'player', 'игроки', ARRAY['Жалолиддин Машарипов','Жалолиддин','Машарипов']::text[]),
  ('Дастан Сатпаев', 'Dastan Satpaev', 'player', 'игроки', ARRAY['Дастан Сатпаев','Дастан','Сатпаев']::text[]),
  ('Бахтиёр Зайнутдинов', 'Bakhtiyor Zaynutdinov', 'player', 'игроки', ARRAY['Бахтиёр Зайнутдинов','Бахтиёр','Зайнутдинов']::text[]),
  ('Галымжан Кенжебек', 'Galymzhan Kenzhebek', 'player', 'игроки', ARRAY['Галымжан Кенжебек','Галымжан','Кенжебек']::text[]),
  ('Валерий Громыко', 'Valery Gromyko', 'player', 'игроки', ARRAY['Валерий Громыко','Валерий','Громыко']::text[]),
  ('Эхсони Панджшанбе', 'Ehsoni Panjshanbe', 'player', 'игроки', ARRAY['Эхсони Панджшанбе','Эхсони','Панджшанбе']::text[]),
  ('Парвизджон Умарбоев', 'Parvizjon Umarboev', 'player', 'игроки', ARRAY['Парвизджон Умарбоев','Парвизджон','Умарбоев']::text[]),
  ('Алишер Джалилов', 'Alisher Dzhalilov', 'player', 'игроки', ARRAY['Алишер Джалилов','Алишер','Джалилов']::text[]),
  ('Гулжигит Алыкулов', 'Gulzhigit Alykulov', 'player', 'игроки', ARRAY['Гулжигит Алыкулов','Гулжигит','Алыкулов']::text[]),
  ('Валерий Кичин', 'Valery Kichin', 'player', 'игроки', ARRAY['Валерий Кичин','Валерий','Кичин']::text[]),
  ('Жоэль Кожо', 'Joel Kojo', 'player', 'игроки', ARRAY['Жоэль Кожо','Жоэль','Кожо']::text[]);
