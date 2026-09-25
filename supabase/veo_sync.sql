-- VEO: one account across televisions and phones.
-- Run once in the Supabase SQL Editor of the VEO project (nothing here refers to any other project).
--
-- What is kept: the household's profiles, and for each profile the small pieces the app keeps for it
-- (settings, progress, library, taste ... - the same keys as PROFILE_KEYS in core/store.js), one row per piece.
-- Who may see it: only the signed-in account that owns it (row level security).
-- Signing a television in: it asks for a pairing code and shows it as a QR; a phone that is signed in
-- approves the code, handing over a refresh token; the television collects it once, and the row is gone.

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------- the household's data
create table if not exists public.profiles (
  account_id uuid not null references auth.users(id) on delete cascade,
  id         text not null,
  data       jsonb not null default '{}'::jsonb,       -- name, icon, lock ...
  deleted    boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (account_id, id)
);

create table if not exists public.profile_data (
  account_id uuid not null references auth.users(id) on delete cascade,
  profile_id text not null,
  key        text not null,
  value      jsonb,
  updated_at timestamptz not null default now(),
  primary key (account_id, profile_id, key)
);
create index if not exists profile_data_changed on public.profile_data (account_id, updated_at);

alter table public.profiles     enable row level security;
alter table public.profile_data enable row level security;

drop policy if exists own_profiles on public.profiles;
create policy own_profiles on public.profiles
  for all to authenticated using (account_id = auth.uid()) with check (account_id = auth.uid());

drop policy if exists own_profile_data on public.profile_data;
create policy own_profile_data on public.profile_data
  for all to authenticated using (account_id = auth.uid()) with check (account_id = auth.uid());

-- ---------------------------------------------------------------- signing a television in
create table if not exists public.pairings (
  code          text primary key,
  secret_hash   text not null,
  refresh_token text,
  approved_by   uuid,
  expires_at    timestamptz not null default now() + interval '10 minutes'
);
alter table public.pairings enable row level security;      -- no policies: reached only through the functions below

-- a television asks for a code (no account yet)
create or replace function public.pair_start()
returns table (code text, secret text)
language plpgsql security definer set search_path = public, extensions as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';   -- no 0/O/1/I/L
  c text; s text; i int;
begin
  delete from pairings where expires_at < now();
  if (select count(*) from pairings) > 2000 then raise exception 'busy'; end if;
  loop
    c := '';
    for i in 1..8 loop c := c || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1); end loop;
    exit when not exists (select 1 from pairings p where p.code = c);
  end loop;
  s := encode(gen_random_bytes(24), 'hex');
  insert into pairings (code, secret_hash) values (c, encode(digest(s, 'sha256'), 'hex'));
  return query select c, s;
end $$;

-- a signed-in phone approves it, handing over its refresh token
create or replace function public.pair_approve(p_code text, p_refresh_token text)
returns boolean
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if auth.uid() is null then raise exception 'sign in first'; end if;
  update pairings set refresh_token = p_refresh_token, approved_by = auth.uid()
   where code = upper(trim(p_code)) and expires_at > now() and refresh_token is null;
  get diagnostics n = row_count;
  return n = 1;
end $$;

-- the television collects it, once
create or replace function public.pair_poll(p_code text, p_secret text)
returns text
language plpgsql security definer set search_path = public, extensions as $$
declare t text;
begin
  select refresh_token into t from pairings
   where code = upper(trim(p_code)) and secret_hash = encode(digest(p_secret, 'sha256'), 'hex')
     and expires_at > now();
  if t is not null then delete from pairings where code = upper(trim(p_code)); end if;
  return t;
end $$;

revoke all on function public.pair_start()               from public;
revoke all on function public.pair_approve(text, text)   from public;
revoke all on function public.pair_poll(text, text)      from public;
grant execute on function public.pair_start()             to anon, authenticated;
grant execute on function public.pair_poll(text, text)    to anon, authenticated;
grant execute on function public.pair_approve(text, text) to authenticated;

-- ---------------------------------------------------------------- v2: approval by account
-- A signed-in phone (the web page after its email code, or the app already signed in) approves a pairing by the
-- account alone. The television then collects a session of its own from the pair-collect function
-- (supabase/functions/pair-collect); no login is ever handed from one device to another.
create or replace function public.pair_approve_account(p_code text)
returns boolean
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if auth.uid() is null then raise exception 'sign in first'; end if;
  update pairings set approved_by = auth.uid()
   where code = upper(trim(p_code)) and expires_at > now() and approved_by is null;
  get diagnostics n = row_count;
  return n = 1;
end $$;
revoke all on function public.pair_approve_account(text) from public;
grant execute on function public.pair_approve_account(text) to authenticated;

-- ---------------------------------------------------------------- v3: a signed-in device offers a number

alter table public.pairings add column if not exists offered boolean not null default false;
alter table public.pairings alter column secret_hash drop not null;

-- a signed-in device offers a number for another device to join the account with (10 minutes)
create or replace function public.pair_offer()
returns text
language plpgsql security definer set search_path = public, extensions as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  c text; i int;
begin
  if auth.uid() is null then raise exception 'sign in first'; end if;
  delete from pairings where expires_at < now();
  delete from pairings where approved_by = auth.uid() and offered;          -- one open offer per account
  loop
    c := '';
    for i in 1..8 loop c := c || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1); end loop;
    exit when not exists (select 1 from pairings p where p.code = c);
  end loop;
  insert into pairings (code, secret_hash, approved_by, offered) values (c, null, auth.uid(), true);
  return c;
end $$;
revoke all on function public.pair_offer() from public;
grant execute on function public.pair_offer() to authenticated;
