-- ช้าช้าไทย — Sprint 12: real teacher role (server-enforced)
-- Safe to run multiple times (idempotent). Run in: Supabase Dashboard → SQL Editor → Run.
--
-- PROBLEM this fixes:
-- The old teacher gate compared a plaintext code against a value stored in
-- shared_kv, which is publicly readable (anyone, even logged out, can read
-- it via the anon key). Worse, "role" lived only in personal_kv, a table
-- each user can freely write to for their OWN row — so any student could,
-- in principle, just tell the client "I'm a teacher" and the database had
-- no way to disagree. This migration moves the teacher code and the role
-- decision fully server-side, where students cannot read or forge it.

-- ---------------------------------------------------------------------------
-- 1. account_roles — one row per account, holds the real role.
--    Users can read their own row. Nobody can write it directly — only the
--    SECURITY DEFINER functions below (owned by the table owner, so they
--    bypass RLS) are allowed to insert/update it.
-- ---------------------------------------------------------------------------
create table if not exists account_roles (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  username    text not null,
  role        text not null default 'student' check (role in ('student', 'teacher')),
  created_at  timestamptz not null default now()
);

alter table account_roles enable row level security;

drop policy if exists "account_roles_self_select" on account_roles;
create policy "account_roles_self_select" on account_roles
  for select using (auth.uid() = user_id);

-- Intentionally no insert/update/delete policy here — direct writes from
-- the client are always denied. Role changes only happen via the RPCs below.

-- ---------------------------------------------------------------------------
-- 2. teacher_secret — the access code, in a table with RLS enabled and
--    ZERO policies. That means it is unreadable/unwritable from the client
--    under any circumstance (including via the JS SDK) — only functions
--    that run with the table owner's privileges (SECURITY DEFINER) can see
--    it. This replaces the old shared_kv "config:teacher-code" key.
-- ---------------------------------------------------------------------------
create table if not exists teacher_secret (
  id    boolean primary key default true check (id),  -- singleton row
  code  text not null
);

insert into teacher_secret (id, code)
values (true, 'TEACHER2025')   -- same default as before, change it any time via Settings
on conflict (id) do nothing;

alter table teacher_secret enable row level security;
-- no policies added on purpose

-- ---------------------------------------------------------------------------
-- 3. Helper functions used inside RLS policies
-- ---------------------------------------------------------------------------
create or replace function my_username()
returns text
language sql
stable
as $$
  select username from account_roles where user_id = auth.uid();
$$;

create or replace function is_teacher()
returns boolean
language sql
stable
as $$
  select exists (select 1 from account_roles where user_id = auth.uid() and role = 'teacher');
$$;

-- ---------------------------------------------------------------------------
-- 4. RPCs — the only way role can ever change
-- ---------------------------------------------------------------------------

-- Called right after every successful sign-in/sign-up. Creates the profile
-- on first login (role defaults to 'student') and just refreshes the
-- username on later logins — it never touches an already-assigned role, so
-- a teacher never gets silently downgraded.
create or replace function ensure_student_profile(p_username text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  insert into account_roles (user_id, username, role)
  values (auth.uid(), p_username, 'student')
  on conflict (user_id) do update set username = excluded.username;
end;
$$;

revoke all on function ensure_student_profile(text) from public;
grant execute on function ensure_student_profile(text) to authenticated;

-- Verifies the code server-side and, only on a match, upgrades the caller's
-- own row to 'teacher'. The code itself is never sent back to the client —
-- only true/false.
create or replace function claim_teacher_role(p_code text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  select code into v_code from teacher_secret where id = true;

  if v_code is null or p_code is null or p_code <> v_code then
    return false;
  end if;

  update account_roles set role = 'teacher' where user_id = auth.uid();
  return true;
end;
$$;

revoke all on function claim_teacher_role(text) from public;
grant execute on function claim_teacher_role(text) to authenticated;

-- Lets a teacher change the access code from Settings. Rejects the call if
-- the caller isn't a teacher (checked server-side via account_roles, not trusted
-- from the client).
create or replace function update_teacher_code(p_new_code text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_teacher() then
    raise exception 'only teachers can change the access code';
  end if;
  update teacher_secret set code = p_new_code where id = true;
  return true;
end;
$$;

revoke all on function update_teacher_code(text) from public;
grant execute on function update_teacher_code(text) to authenticated;

-- Lets a teacher see the current code in Settings (fixes the old badge,
-- which always showed the hardcoded default instead of the real value).
create or replace function get_teacher_code()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
begin
  if not is_teacher() then
    raise exception 'only teachers can view the access code';
  end if;
  select code into v_code from teacher_secret where id = true;
  return v_code;
end;
$$;

revoke all on function get_teacher_code() from public;
grant execute on function get_teacher_code() to authenticated;

-- ---------------------------------------------------------------------------
-- 5. shared_kv write policies — now role-aware instead of "any logged-in
--    user can write anything". Reads stay public (unchanged — needed
--    pre-login, e.g. to check whether a name already has a PIN).
--
--    - Teachers can write everything: access code, categories, class
--      codes, the shared word bank (add/edit/import), any student's
--      roster entry.
--    - Students can only write their OWN roster entry and their OWN
--      stats row (self-registration, rename, progress sync) — matching
--      what the UI already only lets them do. Adding/editing shared
--      vocabulary is teacher-only in the UI (onAdd/onEdit/onImport are
--      only wired up when `teacher` is true) — this policy update closes
--      the gap where a student could still call the Supabase client
--      directly and write to the word bank even though the UI never
--      offered that button.
-- ---------------------------------------------------------------------------
drop policy if exists "shared_kv_auth_insert" on shared_kv;
drop policy if exists "shared_kv_write_insert" on shared_kv;
create policy "shared_kv_write_insert" on shared_kv
  for insert with check (
    is_teacher()
    or key like 'account:%'
    or (key like 'roster:%' and key = 'roster:' || my_username())
    or (key like 'student-stats:%' and key = 'student-stats:' || my_username())
  );

drop policy if exists "shared_kv_auth_update" on shared_kv;
drop policy if exists "shared_kv_write_update" on shared_kv;
create policy "shared_kv_write_update" on shared_kv
  for update using (
    is_teacher()
    or key like 'account:%'
    or (key like 'roster:%' and key = 'roster:' || my_username())
    or (key like 'student-stats:%' and key = 'student-stats:' || my_username())
  ) with check (
    is_teacher()
    or key like 'account:%'
    or (key like 'roster:%' and key = 'roster:' || my_username())
    or (key like 'student-stats:%' and key = 'student-stats:' || my_username())
  );

drop policy if exists "shared_kv_auth_delete" on shared_kv;
drop policy if exists "shared_kv_write_delete" on shared_kv;
create policy "shared_kv_write_delete" on shared_kv
  for delete using (is_teacher());
