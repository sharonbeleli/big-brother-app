-- AI per-user rate limit (8/min, 120/day, 10 insights/day). Idempotent.
-- Table is not readable/writable by clients (RLS on, no policies, grants revoked); only the RPC below touches it.
create table if not exists public.ai_usage (
  user_id uuid primary key references auth.users(id) on delete cascade,
  day date not null default (now() at time zone 'utc')::date,
  minute_bucket bigint not null default 0,
  per_min int not null default 0,
  per_day int not null default 0,
  insights int not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.ai_usage enable row level security;
revoke all on public.ai_usage from public, anon, authenticated;

create or replace function public.ai_rate_hit(p_mode text) returns jsonb
language plpgsql volatile security definer set search_path = public as
$$
declare u uuid := auth.uid(); r public.ai_usage; d date := (now() at time zone 'utc')::date;
        mb bigint := floor(extract(epoch from now()) / 60)::bigint; ins boolean := (p_mode = 'insight');
begin
  if u is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  insert into public.ai_usage(user_id, day, minute_bucket) values (u, d, mb) on conflict (user_id) do nothing;
  select * into r from public.ai_usage where user_id = u for update;   -- per-user row lock => atomic check+increment
  if r.day <> d then r.day := d; r.per_day := 0; r.insights := 0; end if;
  if r.minute_bucket <> mb then r.minute_bucket := mb; r.per_min := 0; end if;
  if r.per_min >= 8 or r.per_day >= 120 or (ins and r.insights >= 10) then
    update public.ai_usage set day = r.day, minute_bucket = r.minute_bucket, per_min = r.per_min, per_day = r.per_day, insights = r.insights, updated_at = now() where user_id = u;
    return jsonb_build_object('allowed', false, 'per_min', r.per_min, 'per_day', r.per_day, 'insights', r.insights);
  end if;
  update public.ai_usage set day = r.day, minute_bucket = r.minute_bucket, per_min = r.per_min + 1, per_day = r.per_day + 1,
    insights = r.insights + (case when ins then 1 else 0 end), updated_at = now() where user_id = u;
  return jsonb_build_object('allowed', true, 'per_min', r.per_min + 1, 'per_day', r.per_day + 1, 'insights', r.insights + (case when ins then 1 else 0 end));
end $$;
revoke execute on function public.ai_rate_hit(text) from public, anon;
grant execute on function public.ai_rate_hit(text) to authenticated;
