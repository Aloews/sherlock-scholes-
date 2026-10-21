-- All photo writes must pass source identity, URL reachability and read-after-write checks.
-- Keep the legacy RPC callable for older scheduled runs, but prevent it from writing unverified URLs.
create or replace function public.fill_photo_from_soccerwiki()
returns integer
language plpgsql
security definer
set search_path = public
set statement_timeout = '120s'
as $function$
begin
  return 0;
end;
$function$;

revoke all on function public.fill_photo_from_soccerwiki() from public, anon, authenticated;
grant execute on function public.fill_photo_from_soccerwiki() to service_role;
