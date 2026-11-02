-- Big Brother Phase 1: profiles, trial, handoffs, call schedule, counsellors. RLS everywhere.
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  is_admin boolean not null default false,
  trial_started_at timestamptz not null default now(),
  trial_days int not null default 7,
  onboarding_done boolean not null default false,
  onboarding jsonb not null default '{}'::jsonb, -- general details only, never dilemma content
  created_at timestamptz not null default now()
);
create table if not exists public.counsellors (
  id uuid primary key default gen_random_uuid(),
  name text not null, phone text, email text, notes text, active boolean not null default true,
  created_at timestamptz not null default now()
);
create table if not exists public.handoffs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  summary jsonb not null default '{}'::jsonb, -- short: general profile + neutral themes
  status text not null default 'new' check (status in ('new','scheduled','done','closed')),
  created_at timestamptz not null default now()
);
create table if not exists public.call_slots (
  id uuid primary key default gen_random_uuid(),
  starts_at timestamptz not null, duration_min int not null default 30,
  counsellor_id uuid references public.counsellors(id) on delete set null,
  user_id uuid references auth.users(id) on delete set null,
  handoff_id uuid references public.handoffs(id) on delete set null,
  status text not null default 'open' check (status in ('open','booked','done','cancelled','no_show')),
  notes text, created_at timestamptz not null default now()
);

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as
$$ select coalesce((select is_admin from public.profiles where id = auth.uid()), false) $$;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as
$$ begin insert into public.profiles(id,email) values (new.id,new.email) on conflict do nothing; return new; end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.counsellors enable row level security;
alter table public.handoffs enable row level security;
alter table public.call_slots enable row level security;

-- profiles: own row read; own row update limited to onboarding columns (column grants); admin all
create policy profiles_self_select on public.profiles for select using (id = auth.uid() or public.is_admin());
create policy profiles_self_update on public.profiles for update using (id = auth.uid() or public.is_admin()) with check (id = auth.uid() or public.is_admin());
revoke update on public.profiles from anon, authenticated;
grant update (onboarding, onboarding_done) on public.profiles to authenticated;
revoke insert, delete on public.profiles from anon, authenticated;
-- handoffs: user can create own; only admin can read/update
create policy handoffs_insert_own on public.handoffs for insert with check (user_id = auth.uid());
create policy handoffs_admin on public.handoffs for all using (public.is_admin()) with check (public.is_admin());
-- call slots: admin manages; user sees own booked slot
create policy slots_admin on public.call_slots for all using (public.is_admin()) with check (public.is_admin());
create policy slots_own_select on public.call_slots for select using (user_id = auth.uid());
-- counsellors: admin only
create policy counsellors_admin on public.counsellors for all using (public.is_admin()) with check (public.is_admin());
revoke all on public.profiles, public.handoffs, public.call_slots, public.counsellors from anon;

-- admin-only RPC to extend a trial (column grants block direct updates of trial fields by non-service roles)
create or replace function public.admin_extend_trial(target uuid, extra_days int) returns void
language plpgsql security definer set search_path = public as
$$ begin if not public.is_admin() then raise exception 'not admin'; end if;
 update public.profiles set trial_days = trial_days + extra_days where id = target; end $$;
revoke execute on function public.admin_extend_trial(uuid,int) from public, anon;
grant execute on function public.admin_extend_trial(uuid,int) to authenticated;
