begin;

do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.telegram_chat_quiz_sessions'::regclass) then
    raise exception 'quiz sessions must have RLS enabled';
  end if;
  if has_table_privilege('anon', 'public.telegram_chat_quiz_sessions', 'select')
     or has_table_privilege('authenticated', 'public.telegram_chat_quiz_sessions', 'select') then
    raise exception 'client roles must not read private quiz sessions';
  end if;
  if not has_table_privilege('service_role', 'public.telegram_chat_quiz_sessions', 'select')
     or not has_table_privilege('service_role', 'public.telegram_chat_quiz_sessions', 'insert')
     or not has_table_privilege('service_role', 'public.telegram_chat_quiz_sessions', 'update') then
    raise exception 'service_role must manage quiz sessions';
  end if;
end;
$$;

insert into public.telegram_chat_quiz_sessions (
  session_key, chat_id, created_by, language_code, answer_id, facts, options
) values (
  '0123456789abcdef', 12345, 12345, 'ru',
  '10000000-0000-0000-0000-000000000001',
  '{"position":"Forward"}'::jsonb,
  '[{"id":"10000000-0000-0000-0000-000000000001","name":"Player A"}]'::jsonb
);

do $$
begin
  if not exists (
    select 1 from public.telegram_chat_quiz_sessions
    where session_key = '0123456789abcdef'
      and expires_at > now()
      and answered_at is null
  ) then
    raise exception 'quiz session fixture was not stored correctly';
  end if;
end;
$$;

rollback;
