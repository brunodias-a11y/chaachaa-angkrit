-- ช้าช้าอังกฤษ — Supabase schema & Row-Level-Security
-- Safe to run multiple times (idempotent). Run in: Supabase Dashboard → SQL Editor → Run.
--
-- Accounts use fake per-student emails: "<name>@chaachaa-angkrit-app.com"
-- (never a real mailbox). The "password" is the student's 4-digit PIN.
-- This lets Postgres restrict each row to its owner via auth.uid().

-- ---------------------------------------------------------------------------
-- Tables
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

drop index if exists personal_kv_username_key_idx;
create unique index if not exists personal_kv_user_id_key_idx on personal_kv (user_id, key);
create index if not exists personal_kv_user_id_idx on personal_kv (user_id);

-- ---------------------------------------------------------------------------
-- Push notifications (#573)
-- ---------------------------------------------------------------------------
create table if not exists push_subscriptions (
  endpoint    text primary key,
  user_id     uuid references auth.users(id),
  username    text,
  keys        jsonb not null,
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table personal_kv        enable row level security;
alter table shared_kv          enable row level security;
alter table push_subscriptions enable row level security;

-- personal_kv: only the owner can read/write their own rows
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

-- Migration policy: lets a student claim legacy rows (user_id NULL) on first PIN login
drop policy if exists "personal_kv_claim_legacy" on personal_kv;
create policy "personal_kv_claim_legacy" on personal_kv
  for update using (user_id is null) with check (auth.uid() is not null);

-- shared_kv: readable by anyone (needed before login), writable by authenticated users
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

-- push_subscriptions: owner can manage their own subscription
drop policy if exists "push_sub_owner_all" on push_subscriptions;
create policy "push_sub_owner_all" on push_subscriptions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
