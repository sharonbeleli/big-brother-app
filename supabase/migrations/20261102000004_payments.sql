-- Payments scaffolding (provider-agnostic). Idempotent. NO real charges: only the mock provider (PAYMENTS_MODE=mock) and admins write here.
-- Writes: only service_role (server webhook / mock checkout) via bb_apply_payment(), or admins via admin_* RPCs. Clients: read own rows only.

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider ~ '^[a-z_]{2,20}$'),
  provider_ref text not null check (char_length(provider_ref) between 1 and 200),
  plan text not null default 'monthly' check (plan in ('monthly')),
  status text not null default 'active' check (status in ('active','past_due','canceled','expired')),
  current_period_end timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_ref));
create index if not exists subscriptions_user_idx on public.subscriptions(user_id);

create table if not exists public.purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider ~ '^[a-z_]{2,20}$'),
  provider_ref text not null check (char_length(provider_ref) between 1 and 200),
  kind text not null check (kind in ('subscription','session_credits')),
  quantity int not null default 1 check (quantity between 1 and 50),
  amount_agorot int not null default 0 check (amount_agorot >= 0),
  currency text not null default 'ILS' check (currency ~ '^[A-Z]{3}$'),
  is_test boolean not null default true,
  created_at timestamptz not null default now(),
  unique (provider, provider_ref));
create index if not exists purchases_user_idx on public.purchases(user_id);

create table if not exists public.session_credits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  balance int not null default 0 check (balance >= 0 and balance <= 500),
  updated_at timestamptz not null default now());

create table if not exists public.credit_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  delta int not null check (delta <> 0),
  reason text not null check (reason in ('purchase','handoff','admin_grant','admin_revoke','refund')),
  ref text,
  created_at timestamptz not null default now());
create index if not exists credit_events_user_idx on public.credit_events(user_id);

alter table public.handoffs add column if not exists paid boolean not null default false;

-- RLS: own read + admin read; no client writes at all.
do $$ declare t text; begin
  foreach t in array array['subscriptions','purchases','session_credits','credit_events'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('drop policy if exists %I on public.%I', t||'_own_select', t);
    execute format('create policy %I on public.%I for select to authenticated using (user_id = auth.uid() or public.is_admin())', t||'_own_select', t);
  end loop; end $$;

create or replace function public.bb_sub_active(uid uuid) returns boolean
language sql stable security definer set search_path = public as
$$ select exists(select 1 from public.subscriptions where user_id = uid and status in ('active','past_due') and current_period_end > now()) $$;

-- Single idempotent write path for payment events (mock checkout now, real provider webhook later). service_role only.
create or replace function public.bb_apply_payment(p_user uuid, p_provider text, p_ref text, p_kind text, p_qty int, p_amount int, p_currency text, p_is_test boolean, p_period_days int default 30)
returns jsonb language plpgsql security definer set search_path = public as
$$
declare pid uuid; base timestamptz;
begin
  if not exists(select 1 from auth.users where id = p_user) then raise exception 'user not found' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('bb_pay:' || p_user::text, 0));
  insert into public.purchases(user_id, provider, provider_ref, kind, quantity, amount_agorot, currency, is_test)
    values (p_user, p_provider, p_ref, p_kind, coalesce(p_qty,1), coalesce(p_amount,0), coalesce(p_currency,'ILS'), coalesce(p_is_test,true))
    on conflict (provider, provider_ref) do nothing returning id into pid;
  if pid is null then return jsonb_build_object('ok', true, 'duplicate', true); end if;
  if p_kind = 'subscription' then
    if p_period_days is null or p_period_days < 1 or p_period_days > 400 then raise exception 'bad period' using errcode = '22023'; end if;
    select max(current_period_end) into base from public.subscriptions where user_id = p_user and status = 'active' and current_period_end > now();
    insert into public.subscriptions(user_id, provider, provider_ref, status, current_period_end)
      values (p_user, p_provider, p_ref, 'active', greatest(coalesce(base, now()), now()) + make_interval(days => p_period_days));
  else
    insert into public.session_credits(user_id, balance) values (p_user, p_qty)
      on conflict (user_id) do update set balance = public.session_credits.balance + excluded.balance, updated_at = now();
    insert into public.credit_events(user_id, delta, reason, ref) values (p_user, p_qty, 'purchase', p_provider || ':' || p_ref);
  end if;
  return jsonb_build_object('ok', true, 'duplicate', false, 'purchase_id', pid);
end $$;
revoke execute on function public.bb_apply_payment(uuid,text,text,text,int,int,text,boolean,int) from public, anon, authenticated;
grant execute on function public.bb_apply_payment(uuid,text,text,text,int,int,text,boolean,int) to service_role;

-- Cancel by provider ref (future webhook: subscription.canceled). service_role only.
create or replace function public.bb_cancel_subscription(p_provider text, p_ref text) returns jsonb
language plpgsql security definer set search_path = public as
$$ begin update public.subscriptions set status = 'canceled', updated_at = now() where provider = p_provider and provider_ref = p_ref;
  return jsonb_build_object('ok', found); end $$;
revoke execute on function public.bb_cancel_subscription(text,text) from public, anon, authenticated;
grant execute on function public.bb_cancel_subscription(text,text) to service_role;

-- Admin tools (mock/manual): grant/revoke subscription days, adjust credits.
create or replace function public.admin_grant_subscription(target uuid, days int) returns jsonb
language plpgsql security definer set search_path = public as
$$ begin
  if not public.is_admin() then raise exception 'not admin' using errcode = '42501'; end if;
  if days is null or days < 1 or days > 365 then raise exception 'days must be 1..365' using errcode = '22023'; end if;
  return public.bb_apply_payment(target, 'admin', 'grant_' || gen_random_uuid()::text, 'subscription', 1, 0, 'ILS', true, days);
end $$;
create or replace function public.admin_revoke_subscription(target uuid) returns jsonb
language plpgsql security definer set search_path = public as
$$ declare n int; begin
  if not public.is_admin() then raise exception 'not admin' using errcode = '42501'; end if;
  update public.subscriptions set status = 'canceled', updated_at = now() where user_id = target and status in ('active','past_due');
  get diagnostics n = row_count; return jsonb_build_object('ok', true, 'canceled', n);
end $$;
create or replace function public.admin_adjust_credits(target uuid, delta int) returns jsonb
language plpgsql security definer set search_path = public as
$$ declare b int; begin
  if not public.is_admin() then raise exception 'not admin' using errcode = '42501'; end if;
  if delta is null or delta = 0 or delta < -50 or delta > 50 then raise exception 'delta must be -50..50, not 0' using errcode = '22023'; end if;
  if not exists(select 1 from auth.users where id = target) then raise exception 'user not found' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('bb_pay:' || target::text, 0));
  insert into public.session_credits(user_id, balance) values (target, greatest(delta,0))
    on conflict (user_id) do update set balance = greatest(0, public.session_credits.balance + delta), updated_at = now() returning balance into b;
  insert into public.credit_events(user_id, delta, reason, ref) values (target, delta, case when delta > 0 then 'admin_grant' else 'admin_revoke' end, 'admin:' || auth.uid()::text);
  return jsonb_build_object('ok', true, 'balance', b);
end $$;
do $$ declare f text; begin
  foreach f in array array['public.admin_grant_subscription(uuid,int)','public.admin_revoke_subscription(uuid)','public.admin_adjust_credits(uuid,int)'] loop
    execute 'revoke execute on function ' || f || ' from public, anon'; execute 'grant execute on function ' || f || ' to authenticated'; end loop; end $$;

-- access_status: active = admin OR trial OR active subscription. Free handoff quota counts only non-paid handoffs.
create or replace function public.access_status() returns jsonb
language plpgsql stable security definer set search_path = public as
$$
declare p public.profiles; t_end timestamptz; used int; ts jsonb; nxt timestamptz; s public.subscriptions; cr int; trial boolean;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  select * into p from public.profiles where id = auth.uid();
  if not found then return jsonb_build_object('active', false, 'reason', 'no_profile'); end if;
  t_end := p.trial_started_at + make_interval(days => p.trial_days);
  trial := now() < t_end;
  select * into s from public.subscriptions where user_id = auth.uid() and status in ('active','past_due') and current_period_end > now() order by current_period_end desc limit 1;
  select coalesce((select balance from public.session_credits where user_id = auth.uid()), 0) into cr;
  select count(*), coalesce(jsonb_agg((extract(epoch from created_at)*1000)::bigint order by created_at), '[]'::jsonb), min(created_at) + interval '30 days'
    into used, ts, nxt
    from public.handoffs where user_id = auth.uid() and not paid and created_at > now() - interval '30 days';
  return jsonb_build_object(
    'active', p.is_admin or trial or s.id is not null,
    'reason', case when p.is_admin then 'admin' when s.id is not null then 'subscription' when trial then 'trial' else 'expired' end,
    'is_admin', p.is_admin,
    'trial_end', t_end,
    'days_left', greatest(0, ceil(extract(epoch from (t_end - now())) / 86400))::int,
    'server_time', now(),
    'subscription', case when s.id is null then null else jsonb_build_object('status', s.status, 'current_period_end', s.current_period_end, 'provider', s.provider) end,
    'credits', cr,
    'handoffs', jsonb_build_object('used', used, 'max', 2, 'window_days', 30, 'response_time_hours', 24,
       'remaining', greatest(0, 2 - used), 'timestamps', ts, 'next_available_at', case when used >= 2 then nxt end, 'credits', cr));
end $$;
revoke execute on function public.access_status() from public, anon;
grant execute on function public.access_status() to authenticated;

-- Guard: free cap counts only non-paid handoffs; paid flag can only be set by request_handoff (txn-local setting, not client-reachable).
create or replace function public.bb_handoffs_guard() returns trigger
language plpgsql security definer set search_path = public as
$$
declare n int; k text; is_paid boolean := coalesce(current_setting('bb.paid_handoff', true), '') = '1';
begin
  if new.user_id is null then raise exception 'handoff requires user' using errcode = '23514'; end if;
  perform pg_advisory_xact_lock(hashtextextended('bb_handoff:' || new.user_id::text, 0));
  new.paid := is_paid;
  if not is_paid then
    select count(*) into n from public.handoffs where user_id = new.user_id and not paid and created_at > now() - interval '30 days';
    if n >= 2 then raise exception 'handoff_cap_reached' using errcode = 'P0001', hint = 'max 2 per 30 days'; end if;
  end if;
  new.created_at := now(); new.status := 'new';
  if jsonb_typeof(new.summary) <> 'object' or char_length(new.summary::text) > 2000 then raise exception 'bad summary'; end if;
  for k in select jsonb_object_keys(new.summary) loop
    if k not in ('profile','theme','subtheme','stage','auto','turns','note') then raise exception 'summary key not allowed: %', k; end if;
  end loop;
  if new.summary ? 'profile' and not public.bb_onboarding_valid(new.summary->'profile') then raise exception 'summary profile not allowed'; end if;
  return new;
end $$;
revoke execute on function public.bb_handoffs_guard() from public, anon, authenticated;

-- request_handoff: free quota (2/30d) only while active (trial/subscription); otherwise / beyond it, consumes 1 session credit atomically.
create or replace function public.request_handoff(theme text default null, subtheme text default null, stage text default null, auto boolean default false, turns int default null)
returns jsonb language plpgsql security definer set search_path = public as
$$
declare o jsonb; s jsonb; hid uuid; th text; st jsonb; used int; cr int; use_credit boolean := false;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  perform pg_advisory_xact_lock(hashtextextended('bb_pay:' || auth.uid()::text, 0));
  select coalesce(onboarding, '{}'::jsonb) into o from public.profiles where id = auth.uid();
  th := case theme when 'career' then 'קריירה' when 'business' then 'עסק' when 'relationship' then 'זוגיות' when 'family' then 'משפחה' when 'other' then 'אחר' else null end;
  s := jsonb_strip_nulls(jsonb_build_object(
    'profile', jsonb_strip_nulls(jsonb_build_object('name', o->'name', 'ageRange', o->'ageRange', 'occupation', o->'occupation', 'tone', o->'tone')),
    'theme', th,
    'subtheme', case when subtheme ~ '^[a-z_]{1,24}$' then subtheme end,
    'stage', case when stage in ('welcome','acquaint','topic','questions','reflection','luck','closing','done') then stage end,
    'auto', coalesce(auto, false),
    'turns', case when turns between 0 and 500 then turns end,
    'note', 'המשתמש/ת ביקש/ה לדבר עם בן אדם' || coalesce(' בנושא ' || th, '')));
  st := public.access_status();
  used := (st->'handoffs'->>'used')::int; cr := coalesce((st->>'credits')::int, 0);
  if not ((st->>'active')::boolean and used < 2) then
    if cr < 1 then return jsonb_build_object('ok', false, 'reason', case when (st->>'active')::boolean then 'cap' else 'no_credit' end, 'status', st); end if;
    use_credit := true;
  end if;
  if use_credit then
    update public.session_credits set balance = balance - 1, updated_at = now() where user_id = auth.uid() and balance >= 1;
    if not found then return jsonb_build_object('ok', false, 'reason', 'no_credit', 'status', st); end if;
    perform set_config('bb.paid_handoff', '1', true);
  end if;
  begin
    insert into public.handoffs(user_id, summary) values (auth.uid(), s) returning id into hid;
  exception when sqlstate 'P0001' then
    if sqlerrm = 'handoff_cap_reached' then return jsonb_build_object('ok', false, 'reason', 'cap', 'status', public.access_status()); end if;
    raise;
  end;
  perform set_config('bb.paid_handoff', '', true);
  if use_credit then insert into public.credit_events(user_id, delta, reason, ref) values (auth.uid(), -1, 'handoff', hid::text); end if;
  return jsonb_build_object('ok', true, 'id', hid, 'paid_with_credit', use_credit, 'status', public.access_status());
end $$;
revoke execute on function public.request_handoff(text,text,text,boolean,int) from public, anon;
grant execute on function public.request_handoff(text,text,text,boolean,int) to authenticated;
revoke execute on function public.bb_sub_active(uuid) from public, anon, authenticated;
