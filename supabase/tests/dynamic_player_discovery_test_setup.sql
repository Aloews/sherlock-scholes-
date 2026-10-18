CREATE EXTENSION IF NOT EXISTS pgcrypto;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;
CREATE TABLE public.cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  name_en text,
  category text NOT NULL,
  active boolean DEFAULT true,
  difficulty text DEFAULT 'medium',
  country text,
  position_ru text,
  born_on date,
  photo_url text,
  photo_source text,
  wikidata_qid text,
  tags text[],
  langs text[],
  fame smallint,
  facts jsonb,
  created_at timestamptz DEFAULT now()
);
