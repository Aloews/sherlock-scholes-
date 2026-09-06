-- Автоматических трат модели больше нет: только кнопка и раз в неделю.
--
-- Владелец: «я добавил токены, автоматически больше их не трать. только по
-- вызову кнопки краткая суть и автоматически раз в неделю».
--
-- ГДЕ ТРАТИЛОСЬ. Конвейер `football-digest` идёт по лентам каждые десять минут
-- и на каждом прогоне заказывал модели ДВЕ вещи: суть каждой новой заметки и
-- чистый заголовок каждого нового ролика. Замер: 863 сути за сутки, 2436 за
-- неделю.
--
-- ⚠️ ЭТА МИГРАЦИЯ ЗАКРЫВАЕТ ТОЛЬКО ПОЛОВИНУ, И ВТОРУЮ ОТСЮДА НЕ ЗАКРЫТЬ.
-- Кандидатов на ЗАГОЛОВОК РОЛИКА функция спрашивает у базы —
-- `goal_clips_needing_title`, — и пустой ответ значит «звонить некому»: это
-- в нашей власти, и это делается ниже. А кандидатов на СУТЬ НОВОСТИ она берёт
-- из того, что сама только что вставила, и никакая SQL-функция в этот выбор
-- не вмешивается. Та половина выключается флагом в самой функции (он уже
-- написан: `run(useLlm)` в supabase/functions/football-digest/index.ts) и
-- требует ОДНОЙ выкладки:
--
--     supabase functions deploy football-digest
--
-- До выкладки суть новостей продолжит писаться, но не безнаказанно: расход
-- по-прежнему упирается в суточный потолок `spend_llm_calls(30)` на прогон.
--
-- ⚠️ ВЫКЛЮЧАТЕЛЬ ОДИН НА ОБЕ ПОЛОВИНЫ И ЛЕЖИТ В БАЗЕ, а не в коде функции:
-- включить пересказы обратно должно быть можно без выкладки. Иначе следующий
-- разговор про деньги опять упрётся в «надо выложить функцию».

create table if not exists public.llm_auto_switch (
  -- Одна строка по построению: id может быть только true.
  id         boolean primary key default true check (id),
  enabled    boolean not null default false,
  changed_at timestamptz not null default now(),
  note       text
);

comment on table public.llm_auto_switch is
  'Можно ли тратить модель В АВТОМАТЕ (крон каждые 10 минут). По умолчанию '
  'НЕЛЬЗЯ: кнопка «краткая суть» и недельная сборка ходят мимо этого флага.';

insert into llm_auto_switch (id, enabled, note)
values (true, false, 'Владелец: автоматически токены не тратить (06.09.2026)')
on conflict (id) do nothing;

create or replace function public.llm_auto_enabled()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select enabled from llm_auto_switch where id = true), false);
$$;

-- Кандидаты на чистый заголовок ролика — ТОЛЬКО когда автомат разрешён.
--
-- ⚠️ ПУСТОЙ СПИСОК ЗДЕСЬ ЧЕСТЕН, А НЕ ХИТЁР: функция спрашивает «кому нужен
-- заголовок», и ответ «никому» — это ответ, а не поломка. Сырой заголовок
-- ролика показывается как показывался: `title_generated` остаётся NULL, и
-- экран берёт `title`.
create or replace function public.goal_clips_needing_title(p_limit integer default 20)
returns table(video_id text, title text, channel text)
language sql
stable
security definer
set search_path = public
as $$
  select g.video_id, g.title, g.channel
  from goal_clips g
  where g.title_generated is null
    and llm_auto_enabled()
  order by g.published_at desc
  limit greatest(1, least(p_limit, 50));
$$;

revoke all on function public.llm_auto_enabled() from public;
grant execute on function public.llm_auto_enabled() to service_role;
revoke all on function public.goal_clips_needing_title(integer) from public;
grant execute on function public.goal_clips_needing_title(integer) to service_role;
