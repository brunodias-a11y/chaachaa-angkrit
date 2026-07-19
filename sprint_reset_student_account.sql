-- ช้าช้าไทย — Reset a stuck legacy/pre-PIN student account (Issue #195)
-- Safe to run multiple times (idempotent, only ever CREATE OR REPLACE).
-- Run in: Supabase Dashboard → SQL Editor → Run. One-time setup — after
-- this, resets happen from the Teacher tab, no dashboard needed.
--
-- PROBLEM this fixes:
-- authenticateAccount() treats any username without an account:<slug>
-- marker in shared_kv as "never had a PIN" and tries signUp() with the PIN
-- just typed. If a PAST attempt for that name already created the real
-- Supabase Auth user (e.g. a signup that looked like it failed on the
-- client due to a network hiccup, but actually succeeded server-side)
-- without the account:<slug> marker and/or the personal_kv claim step
-- completing, every later login falls into the "already registered"
-- recovery branch — and if the PIN typed this time doesn't match the
-- forgotten original one, the student is stuck with no way to recover
-- through the UI.
--
-- This RPC lets a teacher clear that stuck state from inside the app:
-- it deletes the orphaned Auth user + role row + account marker, and
-- (importantly) releases any personal_kv rows already claimed by that
-- user_id back to unclaimed (user_id = null) so the *next* real signup
-- can claim the student's legacy history again, same as a fresh account.

create or replace function reset_student_account(p_email text, p_slug text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
begin
  if not is_teacher() then
    raise exception 'only teachers can reset a student account';
  end if;

  select id into v_user_id from auth.users where email = p_email;

  if v_user_id is null then
    -- Nothing to reset — either there's no stuck account, or the student
    -- just needs to try logging in again.
    return false;
  end if;

  -- Release any already-claimed legacy rows so the next signup can re-claim
  -- them (mirrors the "user_id is null" state a never-claimed legacy account
  -- starts in). Must happen before deleting the user — personal_kv.user_id
  -- references auth.users(id) with no cascade.
  update personal_kv set user_id = null where user_id = v_user_id;

  delete from account_roles where user_id = v_user_id;
  delete from auth.users where id = v_user_id;
  delete from shared_kv where key = 'account:' || p_slug;

  return true;
end;
$$;

revoke all on function reset_student_account(text, text) from public;
grant execute on function reset_student_account(text, text) to authenticated;
