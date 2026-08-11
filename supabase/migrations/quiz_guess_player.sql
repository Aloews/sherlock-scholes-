-- ============================================================================
-- Мини-игра «угадай игрока по фактам».
--
-- НОВОГО ИСТОЧНИКА НЕ ПОНАДОБИЛОСЬ, и это стоит записать, потому что я сам
-- утверждал обратное. Я проверил `cards.facts` как массив — а это объект, — и
-- получил ноль по типу, а не по содержимому. На самом деле факты собраны у
-- 2750 активных карточек, а конвейер (docs/cards_facts_build.py) существовал
-- всё это время. 2293 карточки проходят порог угадываемости.
--
-- ПОРОГ УГАДЫВАЕМОСТИ. Одной позиции мало: «нападающий, 180 см» не отличается
-- от сотни других, и вопрос выходит нечестным, а не сложным. Нужен хотя бы
-- ещё один различающий факт — сборная, число клубов или год рождения.
--
-- ОТВЛЕКАЮЩИЕ БЕРУТСЯ ИЗ ТОЙ ЖЕ ПОЛОСЫ ИЗВЕСТНОСТИ. Если ответ — Месси, а
-- рядом стоят игроки третьего дивизиона, вопрос решается вообще без фактов.
-- Соседи по `pageviews` делают выбор содержательным.
--
-- Чего здесь НЕТ и без нового источника не будет: голов, ударов, эпизодов
-- матчей. Это факты об игроке, а не моменты в игре.
-- ============================================================================

create or replace function public.quiz_guessable_cards()
returns table (id uuid, name text, facts jsonb, photo_url text, pageviews integer)
language sql stable
security definer
set search_path = public
as $$
  select c.id, c.name, c.facts, c.photo_url, c.pageviews
    from cards c
   where c.active
     and c.category = 'player'
     and c.facts is not null
     and c.facts ? 'position'
     and (c.facts ? 'national_team' or c.facts ? 'clubs_count' or c.facts ? 'birth_year')
$$;

create or replace function public.quiz_player_round()
returns table (
  answer_id   uuid,
  facts       jsonb,
  photo_url   text,
  options     jsonb
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_target record;
begin
  select * into v_target from quiz_guessable_cards() order by random() limit 1;
  if v_target.id is null then
    return;
  end if;

  return query
    with pool as (
      select q.id, q.name, q.pageviews
        from quiz_guessable_cards() q
       where q.id <> v_target.id
       order by abs(coalesce(q.pageviews, 0) - coalesce(v_target.pageviews, 0))
       limit 40
    ),
    distractors as (select id, name from pool order by random() limit 3),
    everyone as (
      select v_target.id as id, v_target.name as name
      union all
      select id, name from distractors
    )
    select v_target.id, v_target.facts, v_target.photo_url,
           (select jsonb_agg(jsonb_build_object('id', e.id, 'name', e.name) order by random())
              from everyone e);
end;
$$;

revoke all on function public.quiz_guessable_cards() from public;
revoke all on function public.quiz_player_round()    from public;
grant execute on function public.quiz_guessable_cards() to anon, authenticated, service_role;
grant execute on function public.quiz_player_round()    to anon, authenticated, service_role;
