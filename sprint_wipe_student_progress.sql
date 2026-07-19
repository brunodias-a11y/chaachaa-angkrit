-- ช้าช้าไทย — Wipe all progress data for a student (Issue #561, #565)
-- Safe to run multiple times (idempotent, CREATE OR REPLACE).
-- Run in: Supabase Dashboard → SQL Editor → Run. One-time setup — after
-- this, the "Wipe" button in the Teacher tab becomes available.
-- Re-run after Issue #565 fix to pick up the shared_kv cleanup.
--
-- WHAT THIS DOES:
-- 1. Deletes every personal_kv row for the given username, covering:
--      profile, p:<word-id>, l:<date>, sessions-completed, unlocked-achievements,
--      path-stats, activity-log, streak, berserk-stars, berserk-attempts,
--      exam-history, exam-feedback, gacha-tickets, gacha-pity, gacha-pull-history,
--      avatar-unlock-criteria, level-complete-avatar-grants, monthly-cat-unlocked,
--      avatar-power-charges, avatar-active-boosts, streak-freeze-uses,
--      calligraphy-prog, word-calligraphy-prog, onboarding-done, and all others.
--
-- 2. Deletes student-scoped shared_kv gift entries:
--      avatar-gift:<username>        — pending/last avatar gift record
--      avatar-gift-budget:<username> — "1 free gift per level" budget lock
--      coin-gift:<username>          — pending/last coin gift record
--    This resets the teacher's ability to give a new free gift per level.
--
-- WHAT THIS DOES NOT TOUCH:
--   shared_kv roster:<username>  — student stays visible in the Teacher tab
--   auth.users / account_roles   — login is preserved; student logs in normally
--
-- After the wipe, the student's next login recreates a fresh default profile
-- (same as a brand-new account), with class codes intact from the roster entry.
--
-- Returns the number of personal_kv rows deleted.

create or replace function wipe_student_progress(p_username text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if not is_teacher() then
    raise exception 'only teachers can wipe student progress';
  end if;

  -- Wipe all personal progress rows
  delete from personal_kv where username = p_username;
  get diagnostics v_count = row_count;

  -- #565: also clear shared_kv gift entries so the teacher's per-level
  -- free-gift budget resets and pending gifts don't linger
  delete from shared_kv where key = 'avatar-gift:'        || p_username;
  delete from shared_kv where key = 'avatar-gift-budget:' || p_username;
  delete from shared_kv where key = 'coin-gift:'          || p_username;

  return v_count;
end;
$$;

revoke all on function wipe_student_progress(text) from public;
grant execute on function wipe_student_progress(text) to authenticated;
