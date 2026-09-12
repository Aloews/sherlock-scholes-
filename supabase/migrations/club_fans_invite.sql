-- ============================================================================
-- Позвать в комнату СВОИХ по клубу.
--
-- Владелец: «и возможность добавления в комнату … фанаты команды, той или
-- иной».
--
-- Половина этого уже была: фан-клубы (`fan_club`), присутствие
-- (`player_presence`) и приглашения (`invite_to_room`). Не было ровно
-- перемычки — списка тех, кого можно позвать ПРЯМО СЕЙЧАС и по клубу.
--
-- ⚠️ ТОЛЬКО ТЕ, С КЕМ Я В ОДНОМ ФАН-КЛУБЕ. Не «болельщики любого клуба» и не
-- «все, кто онлайн»: приглашение — это обращение к человеку, и рассылать его
-- незнакомым по совпадению интереса значит завести спам внутри игры. Общий
-- клуб — это уже связь, и её человек завёл сам, нажав «вступить».
--
-- ⚠️ ОНЛАЙН, А НЕ ВСЕ ПОДРЯД. Приглашение в комнату живёт минуты: зовут
-- смотреть матч, который идёт. Позвать того, кто зайдёт завтра, — это
-- уведомление в пустоту, и оно обесценивает все остальные.
--
-- ⚠️ УЖЕ СИДЯЩИЕ В КОМНАТЕ ОТСЕЯНЫ ЗДЕСЬ, ХОТЯ `invite_to_room` ИХ И ТАК
-- ОТОБЬЁТ. Отказ сервера — правильный ответ, но показывать человеку кнопку,
-- которая обязана отказать, значит предлагать действие и наказывать за него.
--
-- ⚠️ ИМЕНА ОТДАЁТ SECURITY DEFINER, И ЭТО НАДО ЗАМЕТИТЬ. Функция читает
-- `players` за игрока, поэтому список ограничен трижды: подпись Telegram
-- проверена, участники — только из МОИХ клубов, и только те, кто сейчас
-- виден. Ни одного способа перечислить чужих здесь нет.
-- ============================================================================

drop function if exists club_fans_to_invite(text, uuid, integer);

create or replace function club_fans_to_invite(
  p_init_data text,
  p_room_id uuid,
  p_limit integer default 20
)
returns table (
  club_key text,
  club text,
  player_id bigint,
  first_name text,
  last_name text,
  avatar_url text
)
language plpgsql security definer set search_path = public as $$
declare
  v_me bigint := tg_validate_init_data(p_init_data);
begin
  if v_me is null then
    raise exception 'invalid init data' using errcode = '28000';
  end if;

  return query
    select c.club_key, c.club, m.player_id, p.first_name, p.last_name, p.avatar_url
      from fan_club c
      -- Мой клуб: без этого соединения список стал бы «все болельщики всех».
      join fan_club_member mine on mine.club_id = c.id and mine.player_id = v_me
      join fan_club_member m    on m.club_id = c.id and m.player_id <> v_me
      join players p            on p.id = m.player_id
      join player_presence pr   on pr.player_id = m.player_id
     where pr.seen_at > now() - presence_window()
       and not pr.hidden
       and not exists (
         select 1 from room_players rp
          where rp.room_id = p_room_id and rp.player_id = m.player_id
       )
     order by c.club, coalesce(p.first_name, ''), m.player_id
     limit greatest(1, least(coalesce(p_limit, 20), 50));
end;
$$;

revoke all on function club_fans_to_invite(text, uuid, integer) from public;
grant execute on function club_fans_to_invite(text, uuid, integer) to anon, authenticated, service_role;

comment on function club_fans_to_invite(text, uuid, integer) is
  'Болельщики МОИХ фан-клубов, которые сейчас онлайн и ещё не в этой комнате.';
