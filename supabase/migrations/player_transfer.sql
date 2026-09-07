-- ===========================================================================
-- История трансферов игрока. ЗАПИСАНО ЗАДНИМ ЧИСЛОМ: таблица и обе функции
-- уже применены к бою — файл заведён, чтобы репозиторий совпадал с продом.
-- DDL снят с боевой базы через pg_get_functiondef, а не набран заново: этот
-- проект однажды уже получил «ᑑ» вместо «ё» от перепечатанного файла.
--
-- Проверка по просьбе владельца («проверь статистику и историю трансферов у
-- Классена и игроков его ценовой категории и выше») показала, что истории
-- трансферов в проекте НЕ БЫЛО ВООБЩЕ — таблиц со словом transfer ноль.
--
-- ⚠️ КЛЮЧ — (tm_player_id, transfer_id), А НЕ ДАТА. В один день игрок может
-- уйти в аренду и вернуться; по дате такая пара схлопнулась бы в одну строку.
--
-- ⚠️ СУММА ХРАНИТСЯ ДВАЖДЫ, ЧИСЛОМ И СТРОКОЙ, и это не дублирование.
-- «loan transfer», «free transfer», «?» — не числа. Ноль означал бы «перешёл
-- бесплатно», а «?» означает «неизвестно»; по нулю потом считали бы средние.
-- Поэтому fee_eur пуст, а fee_text несёт то, что написано у источника.
--
-- ⚠️ card_id — СЛЕПОК, А НЕ ВНЕШНИЙ КЛЮЧ. Историю собираем и на тех, кого в
-- колоде ещё нет: карточка заведётся позже, а переходы уже лежат. Связывает
-- их tm_player_id, он же живёт в cards.transfermarkt_id.
--
-- Источник назван прямо: transfermarkt.com, `ceapi/transferHistory/list/<id>`.
-- ===========================================================================
create table if not exists public.player_transfer (
  tm_player_id     text        not null,
  transfer_id      text        not null,
  card_id          uuid,
  moved_on         date,
  season           text,
  from_club        text,
  from_tm_id       text,
  to_club          text,
  to_tm_id         text,
  fee_eur          bigint,
  fee_text         text,
  market_value_eur bigint,
  fetched_at       timestamptz not null default now(),
  primary key (tm_player_id, transfer_id)
);

create index if not exists player_transfer_card_idx
  on public.player_transfer (card_id, moved_on desc);

alter table public.player_transfer enable row level security;

drop policy if exists player_transfer_read on public.player_transfer;
create policy player_transfer_read on public.player_transfer for select using (true);

-- Грант перечислен ЯВНО. Политика без гранта уже роняла этот проект: чтение
-- разрешено, а роль всё равно получает 403 «permission denied for table».
grant select on public.player_transfer to anon, authenticated;
grant all    on public.player_transfer to service_role;

-- --------------------------------------------------------------------------
-- Запись пачкой: один игрок — одна транзакция, целиком идемпотентная.
-- distinct on (transfer_id) не формальность: без него повтор одного id внутри
-- пачки даёт «on conflict do update cannot affect row a second time».
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apply_player_transfers(p_tm_id text, p_rows jsonb)
 RETURNS TABLE(written integer, linked integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_written integer := 0;
  v_card    uuid;
begin
  select id into v_card from cards
   where transfermarkt_id = p_tm_id and active and category = 'player' limit 1;

  with rows as (
    select distinct on (r->>'transfer_id')
           r->>'transfer_id'                   as transfer_id,
           nullif(r->>'moved_on','')::date     as moved_on,
           nullif(r->>'season','')             as season,
           nullif(r->>'from_club','')          as from_club,
           nullif(r->>'from_tm_id','')         as from_tm_id,
           nullif(r->>'to_club','')            as to_club,
           nullif(r->>'to_tm_id','')           as to_tm_id,
           nullif(r->>'fee_eur','')::bigint    as fee_eur,
           nullif(r->>'fee_text','')           as fee_text,
           nullif(r->>'market_value_eur','')::bigint as market_value_eur
      from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r
     where coalesce(r->>'transfer_id','') <> ''
     order by r->>'transfer_id'
  ),
  ins as (
    insert into player_transfer (tm_player_id, transfer_id, card_id, moved_on, season,
                                 from_club, from_tm_id, to_club, to_tm_id,
                                 fee_eur, fee_text, market_value_eur, fetched_at)
    select p_tm_id, transfer_id, v_card, moved_on, season, from_club, from_tm_id,
           to_club, to_tm_id, fee_eur, fee_text, market_value_eur, now()
      from rows
    on conflict (tm_player_id, transfer_id) do update
       set card_id = excluded.card_id, moved_on = excluded.moved_on,
           season = excluded.season, from_club = excluded.from_club,
           from_tm_id = excluded.from_tm_id, to_club = excluded.to_club,
           to_tm_id = excluded.to_tm_id, fee_eur = excluded.fee_eur,
           fee_text = excluded.fee_text, market_value_eur = excluded.market_value_eur,
           fetched_at = now()
    returning 1
  )
  select count(*) into v_written from ins;

  return query select v_written, (case when v_card is null then 0 else 1 end);
end;
$function$;

revoke all on function public.apply_player_transfers(text, jsonb) from public;
grant execute on function public.apply_player_transfers(text, jsonb) to service_role;

-- --------------------------------------------------------------------------
-- Чтение для карточки: новые переходы сверху.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.player_transfers(p_card_id uuid)
 RETURNS TABLE(moved_on date, season text, from_club text, to_club text, fee_eur bigint, fee_text text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select t.moved_on, t.season, t.from_club, t.to_club, t.fee_eur, t.fee_text
    from player_transfer t
   where t.card_id = p_card_id
   order by t.moved_on desc nulls last;
$function$;

revoke all on function public.player_transfers(uuid) from public;
grant execute on function public.player_transfers(uuid) to anon, authenticated, service_role;
