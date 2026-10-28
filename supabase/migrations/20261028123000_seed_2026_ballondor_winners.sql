-- Record the full, source-verified 2026 Ballon d'Or ceremony award set.
-- Candidate rankings remain separate; no probabilities are fabricated for categories
-- that do not yet have a dedicated scoring model.
ALTER TABLE public.award_outcome
    DROP CONSTRAINT IF EXISTS award_outcome_award_key_check;
ALTER TABLE public.award_outcome
    ADD CONSTRAINT award_outcome_award_key_check
    CHECK (award_key IN (
        'ballon_dor', 'ballon_dor_feminin', 'the_best', 'the_best_female',
        'golden_boy', 'golden_boot', 'kopa_trophy', 'kopa_trophy_feminin',
        'yashin_trophy', 'yashin_trophy_feminin', 'gerd_muller_trophy',
        'gerd_muller_trophy_feminin', 'socrates_award', 'club_of_the_year',
        'club_of_the_year_feminin', 'johan_cruyff_trophy',
        'johan_cruyff_trophy_feminin'
    ));

ALTER TABLE public.award_candidate_snapshot
    DROP CONSTRAINT IF EXISTS award_candidate_snapshot_award_key_check;
ALTER TABLE public.award_candidate_snapshot
    ADD CONSTRAINT award_candidate_snapshot_award_key_check
    CHECK (award_key IN (
        'ballon_dor', 'ballon_dor_feminin', 'the_best', 'the_best_female',
        'golden_boy', 'golden_boot', 'kopa_trophy', 'kopa_trophy_feminin',
        'yashin_trophy', 'yashin_trophy_feminin', 'gerd_muller_trophy',
        'gerd_muller_trophy_feminin', 'socrates_award', 'club_of_the_year',
        'club_of_the_year_feminin', 'johan_cruyff_trophy',
        'johan_cruyff_trophy_feminin'
    ));

INSERT INTO public.cards (
    name, name_en, category, category_ru, difficulty, active, photo_url,
    photo_source, top_club, country, position_ru, born_on, external_source_key,
    tier, facts
)
SELECT
    seed.name, seed.name_en, 'woman', 'Женщины', 'medium', true, seed.photo_url,
    'official_club', seed.top_club, seed.country, seed.position_ru, seed.born_on,
    seed.external_source_key, 'common', seed.facts
FROM (VALUES
    (
        'Вики Лопес', 'Vicky López',
        'https://www.fcbarcelona.com/photo-resources/2025/09/10/36ade141-6b7b-4b11-8468-c32c253d7031/19-vicky.jpg?height=750&width=1200',
        'FC Barcelona Femení', 'ES', 'Полузащитник', DATE '2006-07-26',
        'official-awards-2026:vicky-lopez',
        jsonb_build_object(
            'position', 'Полузащитник', 'birth_year', 2006,
            'national_team', 'Испании',
            'official_profile_source', 'https://www.fcbarcelona.com/',
            'market_value_status', 'No verified Transfermarkt valuation; canonical market_value_eur remains NULL.'
        )
    ),
    (
        'Ката Коль', 'Cata Coll',
        'https://www.fcbarcelona.com/photo-resources/2025/09/10/076708ca-0549-4c25-847f-6b5e290b4b20/13-Cata_coll.jpg?height=750&width=1200',
        'FC Barcelona Femení', 'ES', 'Вратарь', DATE '2001-04-23',
        'official-awards-2026:cata-coll',
        jsonb_build_object(
            'position', 'Вратарь', 'height_cm', 170, 'birth_year', 2001,
            'national_team', 'Испании',
            'official_profile_source', 'https://www.fcbarcelona.com/en/football/womens-football/news/4599035/cata-coll-goalkeeper-of-the-year',
            'award_season_stats_2025_26', jsonb_build_object(
                'apps', 32, 'minutes', 2880, 'goals_conceded', 16,
                'source_url', 'https://www.fcbarcelona.com/en/football/womens-football/news/4599035/cata-coll-goalkeeper-of-the-year'
            ),
            'market_value_status', 'No verified Transfermarkt valuation; canonical market_value_eur remains NULL.'
        )
    ),
    (
        'Чарлин Корраль', 'Charlyn Corral',
        'https://tuzos.com.mx/wp-content/uploads/2026/01/9-charlyn-corral-868x1024.webp',
        'Pachuca Femenil', 'MX', 'Нападающий', DATE '1991-09-11',
        'official-awards-2026:charlyn-corral',
        jsonb_build_object(
            'position', 'Нападающий', 'birth_year', 1991,
            'national_team', 'Мексики',
            'official_profile_source', 'https://tuzos.com.mx/jugadores/charlyn-corral/',
            'market_value_status', 'No verified Transfermarkt valuation; canonical market_value_eur remains NULL.'
        )
    )
) AS seed(name, name_en, photo_url, top_club, country, position_ru, born_on, external_source_key, facts)
WHERE NOT EXISTS (
    SELECT 1 FROM public.cards existing
    WHERE existing.category = 'woman'
      AND lower(coalesce(existing.name_en, '')) = lower(seed.name_en)
)
ON CONFLICT (external_source_key) DO NOTHING;

DROP FUNCTION IF EXISTS public._append_verified_award_fact(
    uuid, text, integer, text, text, integer, text, integer, text, timestamptz
);

CREATE FUNCTION public._append_verified_award_fact(
    p_card_id uuid,
    p_award_key text,
    p_event_year integer,
    p_title text,
    p_honour_title text,
    p_honour_count integer,
    p_kind text,
    p_record_year integer,
    p_source_url text,
    p_announced_at timestamptz
) RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
    v_facts jsonb;
    v_titles jsonb;
    v_honours jsonb;
    v_record jsonb;
    v_event_key text;
BEGIN
    SELECT coalesce(facts, '{}'::jsonb)
    INTO v_facts
    FROM public.cards
    WHERE id = p_card_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Cannot seed award %, card % not found', p_award_key, p_card_id;
    END IF;

    v_titles := coalesce(v_facts->'titles', '[]'::jsonb);
    IF jsonb_typeof(v_titles) <> 'array' THEN
        v_titles := '[]'::jsonb;
    END IF;
    IF NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(v_titles) AS title(value)
        WHERE title.value = p_title
    ) THEN
        v_titles := v_titles || jsonb_build_array(p_title);
    END IF;
    v_facts := jsonb_set(v_facts, '{titles}', v_titles, true);

    v_honours := coalesce(v_facts->'honours', '[]'::jsonb);
    IF jsonb_typeof(v_honours) <> 'array' THEN
        v_honours := '[]'::jsonb;
    END IF;
    IF p_honour_title IS NOT NULL THEN
        IF EXISTS (
            SELECT 1
            FROM jsonb_array_elements(v_honours) AS honour(value)
            WHERE honour.value->>'title' = p_honour_title
        ) THEN
            SELECT coalesce(
                jsonb_agg(
                    CASE
                        WHEN honour.value->>'title' = p_honour_title THEN
                            (
                                honour.value ||
                                jsonb_build_object(
                                    'count',
                                    greatest(
                                        coalesce(nullif(honour.value->>'count', '')::integer, 1),
                                        p_honour_count
                                    ),
                                    'kind', p_kind,
                                    'source_url', p_source_url
                                )
                            ) ||
                            CASE
                                WHEN p_record_year IS NOT NULL
                                THEN jsonb_build_object('award_year', p_record_year)
                                ELSE '{}'::jsonb
                            END
                        ELSE honour.value
                    END
                    ORDER BY honour.ordinality
                ),
                '[]'::jsonb
            )
            INTO v_honours
            FROM jsonb_array_elements(v_honours) WITH ORDINALITY AS honour(value, ordinality);
        ELSE
            v_record := jsonb_build_object(
                'title', p_honour_title,
                'count', greatest(1, p_honour_count),
                'kind', p_kind,
                'source_url', p_source_url
            );
            IF p_record_year IS NOT NULL THEN
                v_record := v_record || jsonb_build_object('award_year', p_record_year);
            END IF;
            v_honours := v_honours || jsonb_build_array(v_record);
        END IF;
        v_facts := jsonb_set(v_facts, '{honours}', v_honours, true);
    END IF;

    v_event_key := p_award_key || ':' || p_event_year::text;
    v_facts := jsonb_set(
        v_facts,
        '{award_sources}',
        coalesce(v_facts->'award_sources', '{}'::jsonb) ||
            jsonb_build_object(v_event_key, p_source_url),
        true
    );
    IF p_announced_at IS NOT NULL THEN
        v_facts := jsonb_set(
            v_facts,
            '{award_announcement_dates}',
            coalesce(v_facts->'award_announcement_dates', '{}'::jsonb) ||
                jsonb_build_object(v_event_key, p_announced_at),
            true
        );
    END IF;
    v_facts := jsonb_set(
        v_facts,
        '{award_title_keys}',
        coalesce(v_facts->'award_title_keys', '{}'::jsonb) ||
            jsonb_build_object(p_title, v_event_key),
        true
    );
    IF coalesce(v_facts->>'honours_source', '') = '' THEN
        v_facts := jsonb_set(v_facts, '{honours_source}', to_jsonb(p_source_url), true);
    END IF;
    v_facts := jsonb_set(v_facts, '{honours_synced_at}', to_jsonb(now()::text), true);

    UPDATE public.cards SET facts = v_facts WHERE id = p_card_id;
END;
$$;

DO $$
DECLARE
    v_card_id uuid;
    v_uefa_2026 constant text :=
        'https://www.uefa.com/news-media/news/02aa-21ec75ddadcd-43023dfa1670-1000--alexia-putellas-and-harry-kane-win-2026-ballon-d-ortm-awards/';
    v_uefa_history constant text :=
        'https://www.uefa.com/ballondor/news/0292-1c27056169a7-bc88d1fdba43-1000--ballon-d-or-laureates-who-has-won-football-s-most-prestig/';
    v_event_date constant timestamptz := '2026-10-26T20:00:00+00:00';
BEGIN
    -- Harry Kane: Ballon d'Or and men's Striker of the Year.
    SELECT id INTO v_card_id FROM public.cards
    WHERE category = 'player' AND active AND lower(coalesce(name_en,'')) = lower('Harry Kane')
    ORDER BY (facts->'honours' IS NOT NULL) DESC LIMIT 1;
    PERFORM public._append_verified_award_fact(v_card_id, 'ballon_dor', 2026,
        'Золотой мяч 2026', 'Обладатель «Золотого мяча» по версии France Football',
        1, 'personal', NULL, v_uefa_2026, v_event_date);
    PERFORM public._append_verified_award_fact(v_card_id, 'gerd_muller_trophy', 2024,
        'Трофей Герда Мюллера 2024', 'Обладатель Трофея Герда Мюллера',
        2, 'personal', NULL, v_uefa_history, NULL);
    PERFORM public._append_verified_award_fact(v_card_id, 'gerd_muller_trophy', 2024,
        'Трофей Герда Мюллера 2024', 'Трофей Герда Мюллера 2024',
        1, 'personal', 2024, v_uefa_history, NULL);
    PERFORM public._append_verified_award_fact(v_card_id, 'gerd_muller_trophy', 2026,
        'Трофей Герда Мюллера 2026', 'Обладатель Трофея Герда Мюллера',
        2, 'personal', NULL, v_uefa_2026, v_event_date);
    PERFORM public._append_verified_award_fact(v_card_id, 'gerd_muller_trophy', 2026,
        'Трофей Герда Мюллера 2026', 'Трофей Герда Мюллера 2026',
        1, 'personal', 2026, v_uefa_2026, v_event_date);

    -- Alexia Putellas: women's Ballon d'Or, her third win.
    SELECT id INTO v_card_id FROM public.cards
    WHERE category = 'woman' AND active AND lower(coalesce(name_en,'')) = lower('Alexia Putellas')
    ORDER BY (facts->'honours' IS NOT NULL) DESC LIMIT 1;
    PERFORM public._append_verified_award_fact(v_card_id, 'ballon_dor_feminin', 2026,
        'Золотой мяч 2026', 'Обладательница «Золотого мяча» по версии France Football',
        3, 'personal', NULL, v_uefa_2026, v_event_date);
    PERFORM public._append_verified_award_fact(v_card_id, 'ballon_dor_feminin', 2026,
        'Золотой мяч 2026', 'Золотой мяч 2026',
        1, 'personal', 2026, v_uefa_2026, v_event_date);

    -- Lamine Yamal: three Kopa / Young Talent awards.
    SELECT id INTO v_card_id FROM public.cards
    WHERE category = 'player' AND active AND lower(coalesce(name_en,'')) = lower('Lamine Yamal')
    ORDER BY (facts->'honours' IS NOT NULL) DESC LIMIT 1;
    PERFORM public._append_verified_award_fact(v_card_id, 'kopa_trophy', 2024,
        'Трофей Копа 2024', 'Обладатель Трофея Копа', 3, 'personal', NULL, v_uefa_history, NULL);
    PERFORM public._append_verified_award_fact(v_card_id, 'kopa_trophy', 2024,
        'Трофей Копа 2024', 'Трофей Копа 2024', 1, 'personal', 2024, v_uefa_history, NULL);
    PERFORM public._append_verified_award_fact(v_card_id, 'kopa_trophy', 2025,
        'Трофей Копа 2025', 'Обладатель Трофея Копа', 3, 'personal', NULL, v_uefa_history, NULL);
    PERFORM public._append_verified_award_fact(v_card_id, 'kopa_trophy', 2025,
        'Трофей Копа 2025', 'Трофей Копа 2025', 1, 'personal', 2025, v_uefa_history, NULL);
    PERFORM public._append_verified_award_fact(v_card_id, 'kopa_trophy', 2026,
        'Трофей Копа 2026', 'Обладатель Трофея Копа', 3, 'personal', NULL, v_uefa_2026, v_event_date);
    PERFORM public._append_verified_award_fact(v_card_id, 'kopa_trophy', 2026,
        'Трофей Копа 2026', 'Трофей Копа 2026', 1, 'personal', 2026, v_uefa_2026, v_event_date);

    -- Vicky López: women's Young Talent / Kopa awards in 2025 and 2026.
    SELECT id INTO v_card_id FROM public.cards
    WHERE external_source_key = 'official-awards-2026:vicky-lopez';
    PERFORM public._append_verified_award_fact(v_card_id, 'kopa_trophy_feminin', 2025,
        'Трофей Копа 2025', 'Обладательница Трофея Копа', 2, 'personal', NULL, v_uefa_history, NULL);
    PERFORM public._append_verified_award_fact(v_card_id, 'kopa_trophy_feminin', 2025,
        'Трофей Копа 2025', 'Трофей Копа 2025', 1, 'personal', 2025, v_uefa_history, NULL);
    PERFORM public._append_verified_award_fact(v_card_id, 'kopa_trophy_feminin', 2026,
        'Трофей Копа 2026', 'Обладательница Трофея Копа', 2, 'personal', NULL, v_uefa_2026, v_event_date);
    PERFORM public._append_verified_award_fact(v_card_id, 'kopa_trophy_feminin', 2026,
        'Трофей Копа 2026', 'Трофей Копа 2026', 1, 'personal', 2026, v_uefa_2026, v_event_date);

    -- Men's and women's goalkeeper of the year.
    SELECT id INTO v_card_id FROM public.cards
    WHERE category = 'player' AND active AND lower(coalesce(name_en,'')) like 'unai sim%'
    ORDER BY (facts->'honours' IS NOT NULL) DESC LIMIT 1;
    PERFORM public._append_verified_award_fact(v_card_id, 'yashin_trophy', 2026,
        'Трофей Яшина 2026', 'Обладатель премии Льва Яшина', 1, 'personal', NULL, v_uefa_2026, v_event_date);
    PERFORM public._append_verified_award_fact(v_card_id, 'yashin_trophy', 2026,
        'Трофей Яшина 2026', 'Трофей Яшина 2026', 1, 'personal', 2026, v_uefa_2026, v_event_date);

    SELECT id INTO v_card_id FROM public.cards
    WHERE external_source_key = 'official-awards-2026:cata-coll';
    PERFORM public._append_verified_award_fact(v_card_id, 'yashin_trophy_feminin', 2026,
        'Трофей Яшина 2026', 'Обладательница Трофея Яшина', 1, 'personal', NULL, v_uefa_2026, v_event_date);
    PERFORM public._append_verified_award_fact(v_card_id, 'yashin_trophy_feminin', 2026,
        'Трофей Яшина 2026', 'Трофей Яшина 2026', 1, 'personal', 2026, v_uefa_2026, v_event_date);

    -- Women's Striker of the Year / Gerd Müller Trophy.
    SELECT id INTO v_card_id FROM public.cards
    WHERE external_source_key = 'official-awards-2026:charlyn-corral';
    PERFORM public._append_verified_award_fact(v_card_id, 'gerd_muller_trophy_feminin', 2026,
        'Трофей Герда Мюллера 2026', 'Обладательница Трофея Герда Мюллера',
        1, 'personal', NULL, v_uefa_2026, v_event_date);
    PERFORM public._append_verified_award_fact(v_card_id, 'gerd_muller_trophy_feminin', 2026,
        'Трофей Герда Мюллера 2026', 'Трофей Герда Мюллера 2026',
        1, 'personal', 2026, v_uefa_2026, v_event_date);

    -- Socrates Award.
    SELECT id INTO v_card_id FROM public.cards
    WHERE category = 'player' AND active AND lower(coalesce(name_en,'')) = lower('Bukayo Saka')
    ORDER BY (facts->'honours' IS NOT NULL) DESC LIMIT 1;
    PERFORM public._append_verified_award_fact(v_card_id, 'socrates_award', 2026,
        'Приз Сократеса 2026', 'Обладатель Приза Сократеса', 1, 'personal', NULL, v_uefa_2026, v_event_date);
    PERFORM public._append_verified_award_fact(v_card_id, 'socrates_award', 2026,
        'Приз Сократеса 2026', 'Приз Сократеса 2026', 1, 'personal', 2026, v_uefa_2026, v_event_date);

    -- Club of the Year awards.
    SELECT id INTO v_card_id FROM public.cards
    WHERE category = 'club' AND active AND lower(coalesce(name_en,'')) like 'paris saint-germain%'
    ORDER BY id LIMIT 1;
    PERFORM public._append_verified_award_fact(v_card_id, 'club_of_the_year', 2026,
        'Мужской клуб года 2026', 'Мужской клуб года', 1, 'team', NULL, v_uefa_2026, v_event_date);
    PERFORM public._append_verified_award_fact(v_card_id, 'club_of_the_year', 2026,
        'Мужской клуб года 2026', 'Мужской клуб года 2026', 1, 'team', 2026, v_uefa_2026, v_event_date);

    SELECT id INTO v_card_id FROM public.cards
    WHERE category = 'club' AND active AND lower(coalesce(name_en,'')) = lower('FC Barcelona')
    ORDER BY id LIMIT 1;
    PERFORM public._append_verified_award_fact(v_card_id, 'club_of_the_year_feminin', 2026,
        'Женский клуб года 2026', 'Женский клуб года', 1, 'team', NULL, v_uefa_2026, v_event_date);
    PERFORM public._append_verified_award_fact(v_card_id, 'club_of_the_year_feminin', 2026,
        'Женский клуб года 2026', 'Женский клуб года 2026', 1, 'team', 2026, v_uefa_2026, v_event_date);
END;
$$;

DROP FUNCTION public._append_verified_award_fact(
    uuid, text, integer, text, text, integer, text, integer, text, timestamptz
);

-- Outcomes are source-backed facts. Evaluation is only possible when a pre-award
-- snapshot exists for the same award and season; no historical scores are invented.
INSERT INTO public.award_outcome (
    award_key, award_year, card_id, competition_id, result,
    source_url, announced_at, verified_at, verified_by
)
SELECT winners.award_key, winners.award_year, cards.id, '*', 'winner',
       winners.source_url, winners.announced_at, now(), 'UEFA official 2026 award results'
FROM (VALUES
    ('ballon_dor', 2026, 'player', 'Harry Kane', 'https://www.uefa.com/news-media/news/02aa-21ec75ddadcd-43023dfa1670-1000--alexia-putellas-and-harry-kane-win-2026-ballon-d-ortm-awards/', '2026-10-26T20:00:00+00:00'::timestamptz),
    ('ballon_dor_feminin', 2026, 'woman', 'Alexia Putellas', 'https://www.uefa.com/news-media/news/02aa-21ec75ddadcd-43023dfa1670-1000--alexia-putellas-and-harry-kane-win-2026-ballon-d-ortm-awards/', '2026-10-26T20:00:00+00:00'::timestamptz),
    ('kopa_trophy', 2024, 'player', 'Lamine Yamal', 'https://www.uefa.com/ballondor/news/0292-1c27056169a7-bc88d1fdba43-1000--ballon-d-or-laureates-who-has-won-football-s-most-prestig/', NULL::timestamptz),
    ('kopa_trophy', 2025, 'player', 'Lamine Yamal', 'https://www.uefa.com/ballondor/news/0292-1c27056169a7-bc88d1fdba43-1000--ballon-d-or-laureates-who-has-won-football-s-most-prestig/', NULL::timestamptz),
    ('kopa_trophy', 2026, 'player', 'Lamine Yamal', 'https://www.uefa.com/news-media/news/02aa-21ec75ddadcd-43023dfa1670-1000--alexia-putellas-and-harry-kane-win-2026-ballon-d-ortm-awards/', '2026-10-26T20:00:00+00:00'::timestamptz),
    ('kopa_trophy_feminin', 2025, 'woman', 'Vicky López', 'https://www.uefa.com/ballondor/news/0292-1c27056169a7-bc88d1fdba43-1000--ballon-d-or-laureates-who-has-won-football-s-most-prestig/', NULL::timestamptz),
    ('kopa_trophy_feminin', 2026, 'woman', 'Vicky López', 'https://www.uefa.com/news-media/news/02aa-21ec75ddadcd-43023dfa1670-1000--alexia-putellas-and-harry-kane-win-2026-ballon-d-ortm-awards/', '2026-10-26T20:00:00+00:00'::timestamptz),
    ('yashin_trophy', 2026, 'player', 'Unai Simón', 'https://www.uefa.com/news-media/news/02aa-21ec75ddadcd-43023dfa1670-1000--alexia-putellas-and-harry-kane-win-2026-ballon-d-ortm-awards/', '2026-10-26T20:00:00+00:00'::timestamptz),
    ('yashin_trophy_feminin', 2026, 'woman', 'Cata Coll', 'https://www.uefa.com/news-media/news/02aa-21ec75ddadcd-43023dfa1670-1000--alexia-putellas-and-harry-kane-win-2026-ballon-d-ortm-awards/', '2026-10-26T20:00:00+00:00'::timestamptz),
    ('gerd_muller_trophy', 2024, 'player', 'Harry Kane', 'https://www.uefa.com/ballondor/news/0292-1c27056169a7-bc88d1fdba43-1000--ballon-d-or-laureates-who-has-won-football-s-most-prestig/', NULL::timestamptz),
    ('gerd_muller_trophy', 2026, 'player', 'Harry Kane', 'https://www.uefa.com/news-media/news/02aa-21ec75ddadcd-43023dfa1670-1000--alexia-putellas-and-harry-kane-win-2026-ballon-d-ortm-awards/', '2026-10-26T20:00:00+00:00'::timestamptz),
    ('gerd_muller_trophy_feminin', 2026, 'woman', 'Charlyn Corral', 'https://www.uefa.com/news-media/news/02aa-21ec75ddadcd-43023dfa1670-1000--alexia-putellas-and-harry-kane-win-2026-ballon-d-ortm-awards/', '2026-10-26T20:00:00+00:00'::timestamptz),
    ('socrates_award', 2026, 'player', 'Bukayo Saka', 'https://www.uefa.com/news-media/news/02aa-21ec75ddadcd-43023dfa1670-1000--alexia-putellas-and-harry-kane-win-2026-ballon-d-ortm-awards/', '2026-10-26T20:00:00+00:00'::timestamptz),
    ('club_of_the_year', 2026, 'club', 'Paris Saint-Germain FC', 'https://www.uefa.com/news-media/news/02aa-21ec75ddadcd-43023dfa1670-1000--alexia-putellas-and-harry-kane-win-2026-ballon-d-ortm-awards/', '2026-10-26T20:00:00+00:00'::timestamptz),
    ('club_of_the_year_feminin', 2026, 'club', 'FC Barcelona', 'https://www.uefa.com/news-media/news/02aa-21ec75ddadcd-43023dfa1670-1000--alexia-putellas-and-harry-kane-win-2026-ballon-d-ortm-awards/', '2026-10-26T20:00:00+00:00'::timestamptz)
) AS winners(award_key, award_year, category, name_en, source_url, announced_at)
JOIN public.cards cards
  ON cards.category = winners.category
 AND lower(coalesce(cards.name_en, '')) = lower(winners.name_en)
 AND cards.active
ON CONFLICT (award_key, award_year, card_id, result, competition_id)
DO UPDATE SET
    source_url = EXCLUDED.source_url,
    announced_at = coalesce(EXCLUDED.announced_at, public.award_outcome.announced_at),
    verified_at = now(),
    verified_by = EXCLUDED.verified_by;
