-- Big Brother hardening (idempotent): server-authoritative access status, DB-enforced handoff cap,
-- structured handoff summary built server-side, onboarding allowlist, admin_extend_trial validation.
-- Semantics mirror config/handoff.yaml: max_handoffs_per_user=2 per window_days=30, response_time_hours=24.

-- 1) Onboarding: only allowlisted general keys, typed, length-limited (mirrors app/auth.js onboarding questions).
create or replace function public.bb_onboarding_valid(o jsonb) returns boolean
language plpgsql immutable set search_path = public as
$$
declare k text; v jsonb; e jsonb;
begin
  if o is null or jsonb_typeof(o) <> 'object' then return false; end if;
  for k, v in select * from jsonb_each(o) loop
    if k = 'name' then
      if jsonb_typeof(v) <> 'string' or char_length(v #>> '{}') > 24 then return false; end if;
    elsif k in ('ageRange','gender','occupation','living','tone','length','source','hope') then
      if jsonb_typeof(v) <> 'string' or char_length(v #>> '{}') > 40 then return false; end if;
    elsif k = 'interests' then
      if jsonb_typeof(v) <> 'array' or jsonb_array_length(v) > 12 then return false; end if;
      for e in select * from jsonb_array_elements(v) loop
        if jsonb_typeof(e) <> 'string' or char_length(e #>> '{}') > 24 then return false; end if;
      end loop;
    else
      return false;
    end if;
  end loop;
  return true;
end $$;
alter table public.profiles drop constraint if exists profiles_onboarding_allowlist;
alter table public.profiles add constraint profiles_onboarding_allowlist check (public.bb_onboarding_valid(onboarding));

-- Trial / admin columns stay non-updatable by clients (column grants), re-asserted here.
revoke update on public.profiles from anon, authenticated;
grant update (onboarding, onboarding_done) on public.profiles to authenticated;

-- 2) Server-authoritative access status (trial computed from DB; admin extensions live in trial_days).
create or replace function public.access_status() returns jsonb
language plpgsql stable security definer set search_path = public as
$$
declare p public.profiles; t_end timestamptz; used int; ts jsonb; nxt timestamptz;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  select * into p from public.profiles where id = auth.uid();
  if not found then return jsonb_build_object('active', false, 'reason', 'no_profile'); end if;
  t_end := p.trial_started_at + make_interval(days => p.trial_days);
  select count(*), coalesce(jsonb_agg((extract(epoch from created_at)*1000)::bigint order by created_at), '[]'::jsonb), min(created_at) + interval '30 days'
    into used, ts, nxt
    from public.handoffs where user_id = auth.uid() and created_at > now() - interval '30 days';
  return jsonb_build_object(
    'active', p.is_admin or now() < t_end,
    'is_admin', p.is_admin,
    'trial_end', t_end,
    'days_left', greatest(0, ceil(extract(epoch from (t_end - now())) / 86400))::int,
    'server_time', now(),
    'handoffs', jsonb_build_object('used', used, 'max', 2, 'window_days', 30, 'response_time_hours', 24,
       'remaining', greatest(0, 2 - used), 'timestamps', ts, 'next_available_at', case when used >= 2 then nxt end));
end $$;
revoke execute on function public.access_status() from public, anon;
grant execute on function public.access_status() to authenticated;

-- 3) Handoffs: no direct client inserts; cap + summary shape enforced by trigger for every insert path.
drop policy if exists handoffs_insert_own on public.handoffs;
revoke insert on public.handoffs from anon, authenticated;

create or replace function public.bb_handoffs_guard() returns trigger
language plpgsql security definer set search_path = public as
$$
declare n int; k text;
begin
  if new.user_id is null then raise exception 'handoff requires user' using errcode = '23514'; end if;
  perform pg_advisory_xact_lock(hashtextextended('bb_handoff:' || new.user_id::text, 0));
  select count(*) into n from public.handoffs where user_id = new.user_id and created_at > now() - interval '30 days';
  if n >= 2 then raise exception 'handoff_cap_reached' using errcode = 'P0001', hint = 'max 2 per 30 days'; end if;
  new.created_at := now(); new.status := 'new';
  if jsonb_typeof(new.summary) <> 'object' or char_length(new.summary::text) > 2000 then raise exception 'bad summary'; end if;
  for k in select jsonb_object_keys(new.summary) loop
    if k not in ('profile','theme','subtheme','stage','auto','turns','note') then raise exception 'summary key not allowed: %', k; end if;
  end loop;
  if new.summary ? 'profile' and not public.bb_onboarding_valid(new.summary->'profile') then raise exception 'summary profile not allowed'; end if;
  return new;
end $$;
drop trigger if exists handoffs_guard on public.handoffs;
create trigger handoffs_guard before insert on public.handoffs for each row execute function public.bb_handoffs_guard();

-- The only client path: server builds the summary from allowlisted onboarding fields + enum metadata.
create or replace function public.request_handoff(theme text default null, subtheme text default null, stage text default null, auto boolean default false, turns int default null)
returns jsonb language plpgsql security definer set search_path = public as
$$
declare o jsonb; s jsonb; hid uuid; th text;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
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
  begin
    insert into public.handoffs(user_id, summary) values (auth.uid(), s) returning id into hid;
  exception when sqlstate 'P0001' then
    if sqlerrm = 'handoff_cap_reached' then return jsonb_build_object('ok', false, 'reason', 'cap', 'status', public.access_status()); end if;
    raise;
  end;
  return jsonb_build_object('ok', true, 'id', hid, 'status', public.access_status());
end $$;
revoke execute on function public.request_handoff(text,text,text,boolean,int) from public, anon;
grant execute on function public.request_handoff(text,text,text,boolean,int) to authenticated;

-- 4) admin_extend_trial: admin only, 1..90 days, existing target, total capped.
create or replace function public.admin_extend_trial(target uuid, extra_days int) returns void
language plpgsql security definer set search_path = public as
$$ begin
  if not public.is_admin() then raise exception 'not admin' using errcode = '42501'; end if;
  if extra_days is null or extra_days < 1 or extra_days > 90 then raise exception 'extra_days must be 1..90' using errcode = '22023'; end if;
  update public.profiles set trial_days = trial_days + extra_days where id = target and trial_days + extra_days <= 3650;
  if not found then raise exception 'target not found or trial too long' using errcode = '22023'; end if;
end $$;
revoke execute on function public.admin_extend_trial(uuid,int) from public, anon;
grant execute on function public.admin_extend_trial(uuid,int) to authenticated;

-- Internal helpers not callable by clients.
revoke execute on function public.bb_handoffs_guard() from public, anon, authenticated;
