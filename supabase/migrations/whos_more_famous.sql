-- ============================================================================
-- Мини-игра «Кто известнее» — выбор из двух карточек по известности.
--
-- НОВОГО ИСТОЧНИКА НЕ ПОНАДОБИЛОСЬ: cards.fame уже посчитан как единая ось
-- узнаваемости (deck_fame.sql, §7 MAP.md) — процентиль ВНУТРИ семьи (игроки
-- против игроков), а не сырые pageviews одной вики. Раунд берёт только
-- игроков и сравнивает их между собой: у процентиля разных семей (игрок
-- против стадиона) разные шкалы, и сравнивать их бессмысленно — та же
-- причина, по которой refresh_card_fame() считает игроков и «остальных»
-- раздельно.
--
-- Названа в docs/FANTASY_AND_MINIGAMES.md §7 самой дешёвой из мини-игр без
-- нового источника — той, что должна открывать раздел. Первая по счёту.
--
-- ОТВЕТ ПРИХОДИТ ВМЕСТЕ С ВОПРОСОМ, тем же приёмом, что и quiz_player_round
-- (quiz_guess_player.sql): игра одиночная, очков в профиль не начисляет,
-- лишний круг к серверу на каждый ответ стоил бы задержки ради защиты того,
-- что защищать не от чего.
--
-- ⚠️ СЫРОЕ ЗНАЧЕНИЕ fame НАРУЖУ НЕ ОТДАЁТСЯ, и это не только про честность
-- игры: PlayerCard красит рамку карточки по cards.tier, а tier — это
-- fame_tier(fame), то есть ПРОИЗВОДНАЯ той же оси. Покажи эту игра карточки
-- через PlayerCard с их настоящим tier — редкая рамка сама выдаст ответ.
-- Поэтому экран использует свою, более простую плитку без рамки редкости, а
-- RPC вообще не возвращает tier.
--
-- ⚠️ ИМЯ РЕЗОЛВИТСЯ НА СЕРВЕРЕ, а не встраиванием card_translations, как в
-- collection_page. Та функция отдаёт SETOF cards ради постраничного
-- каталога, где PostgREST и так тянет полную строку; здесь на раунд — ровно
-- две карточки, и тащить весь массив переводов ради одного имени не нужно.
-- Резолв — тот же порядок, что и в cardName.ts: ru -> name, en -> name_en ->
-- name, остальные -> card_translations -> name_en -> name.
--
-- Честная слабость v1: пара берётся полностью случайно, без выравнивания по
-- разнице fame. Раунд «легенда против футболиста третьего дивизиона» будет
-- попадаться чаще, чем интересный. Решать это здесь не будем — как
-- quiz_player_round для своей похожей проблемы, только с сортировкой по
-- близости pageviews, а не с честным подбором.
-- ============================================================================

create or replace function public.whos_more_famous_round(p_lang text default 'en')
returns table (
  answer_id uuid,
  options   jsonb
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_lang  text := lower(left(coalesce(p_lang, 'en'), 2));
  v_left  record;
  v_right record;
begin
  select id, fame into v_left
    from cards
   where active and category = 'player' and fame is not null and photo_url is not null
   order by random()
   limit 1;

  if v_left.id is null then
    return;
  end if;

  -- Другое значение fame обязательно: при равенстве «кто известнее» не имеет
  -- честного ответа, а раунд без ответа хуже, чем раунд без пары.
  select id, fame into v_right
    from cards
   where active and category = 'player' and fame is not null and photo_url is not null
     and id <> v_left.id and fame <> v_left.fame
   order by random()
   limit 1;

  if v_right.id is null then
    return;
  end if;

  return query
    select
      case when v_left.fame > v_right.fame then v_left.id else v_right.id end,
      jsonb_agg(
        jsonb_build_object(
          'id', c.id,
          'name',
            case
              when v_lang = 'ru' then c.name
              when v_lang = 'en' then coalesce(nullif(c.name_en, ''), c.name)
              else coalesce(
                (select ct.name from card_translations ct
                  where ct.card_id = c.id and ct.lang = v_lang),
                nullif(c.name_en, ''),
                c.name
              )
            end,
          'photo_url', c.photo_url
        )
        order by random()
      )
    from cards c
    where c.id in (v_left.id, v_right.id);
end;
$$;

revoke all on function public.whos_more_famous_round(text) from public;
grant execute on function public.whos_more_famous_round(text) to anon, authenticated, service_role;

comment on function public.whos_more_famous_round(text) is
  'Раунд «Кто известнее»: две случайные карточки-игрока с разным fame, имя '
  'резолвится под p_lang. answer_id — id более известной; сырой fame клиенту '
  'не передаётся.';
