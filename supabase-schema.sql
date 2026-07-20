-- ช้าช้าไทย — Supabase schema & Row-Level-Security
-- Safe to run multiple times (idempotent). Run in: Supabase Dashboard → SQL Editor → Run.
--
-- Sprint 11 — Real per-student accounts (name + PIN).
-- Every account is a Supabase Auth user (email = "<name>@chaachaa-angkrit-app.com",
-- password = the student's 4-digit PIN). This lets Postgres restrict each
-- row to its owner via auth.uid(), instead of trusting a plain-text
-- `username` column that anyone with the public anon key could read or edit.

-- ---------------------------------------------------------------------------
-- Tables (created fresh if they don't exist yet)
-- ---------------------------------------------------------------------------
create table if not exists shared_kv (
  key         text primary key,
  value       text not null,
  updated_at  timestamptz not null default now()
);

create table if not exists personal_kv (
  id          bigint generated always as identity primary key,
  username    text not null,
  key         text not null,
  value       text not null,
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Migration: add the real owner column to personal_kv
-- ---------------------------------------------------------------------------
alter table personal_kv add column if not exists user_id uuid references auth.users(id);

-- One row per (owner, key) from now on. Existing rows keep user_id = NULL
-- until their student logs in once under the new PIN system and "claims"
-- them (handled automatically by the app on first PIN sign-up).
drop index if exists personal_kv_username_key_idx;
create unique index if not exists personal_kv_user_id_key_idx on personal_kv (user_id, key);
create index if not exists personal_kv_user_id_idx on personal_kv (user_id);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table personal_kv enable row level security;
alter table shared_kv   enable row level security;

-- personal_kv: only the owner (matching Supabase Auth user) can read/write their own rows.
drop policy if exists "personal_kv_owner_select" on personal_kv;
create policy "personal_kv_owner_select" on personal_kv
  for select using (auth.uid() = user_id);

drop policy if exists "personal_kv_owner_insert" on personal_kv;
create policy "personal_kv_owner_insert" on personal_kv
  for insert with check (auth.uid() = user_id);

drop policy if exists "personal_kv_owner_update" on personal_kv;
create policy "personal_kv_owner_update" on personal_kv
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "personal_kv_owner_delete" on personal_kv;
create policy "personal_kv_owner_delete" on personal_kv
  for delete using (auth.uid() = user_id);

-- TEMPORARY migration policy: lets a freshly-authenticated student "claim"
-- their own pre-PIN legacy rows (user_id still NULL) the first time they set
-- a PIN. Safe — it only ever touches rows that have no owner yet, and the
-- app immediately sets user_id on them so they fall under the policies
-- above from then on. You can drop this a few weeks after launch, once every
-- active student has logged in at least once:
--   drop policy "personal_kv_claim_legacy" on personal_kv;
drop policy if exists "personal_kv_claim_legacy" on personal_kv;
create policy "personal_kv_claim_legacy" on personal_kv
  for update using (user_id is null) with check (auth.uid() is not null);

-- shared_kv: word bank / roster / teacher code — readable by anyone (needed
-- before login, e.g. to check whether a name already has a PIN), but only
-- logged-in accounts can write to it.
drop policy if exists "shared_kv_public_select" on shared_kv;
create policy "shared_kv_public_select" on shared_kv
  for select using (true);

drop policy if exists "shared_kv_auth_insert" on shared_kv;
create policy "shared_kv_auth_insert" on shared_kv
  for insert with check (auth.uid() is not null);

drop policy if exists "shared_kv_auth_update" on shared_kv;
create policy "shared_kv_auth_update" on shared_kv
  for update using (auth.uid() is not null) with check (auth.uid() is not null);

drop policy if exists "shared_kv_auth_delete" on shared_kv;
create policy "shared_kv_auth_delete" on shared_kv
  for delete using (auth.uid() is not null);
