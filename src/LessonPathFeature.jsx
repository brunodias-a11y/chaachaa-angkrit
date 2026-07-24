// ---------------------------------------------------------------------------
// LessonPathFeature — Phase 21 container
//
// Extracted from App.jsx to avoid Terser TDZ errors on minified bundles.
// All LP state lives here; App.jsx communicates via props/callbacks only.
// Issue #425 — root fix for "activeLessonPlayer is not defined" in production.
// ---------------------------------------------------------------------------
import React, { useState, useEffect, useCallback, useMemo, useRef, forwardRef, useImperativeHandle } from "react";
import {
  ManageLessonsModal,
  LessonPlayerModal,
  LessonPathScreen,
  checkAndClaimSectionRewards,
  listAllLessonsOrdered,
  listAllClassCodes,
  getPathCurrentCode,
  advancePathCurrentCode,
  getLessonProgress,
  getSectionProgress,
  getSectionMeta,
  getDecorativeAvatars,
  mirrorLessonNodeIndex,
  markLessonComplete,
  markLessonAvailable,
  ensureS0FirstLessonAvailable,
} from "./lessonPath.jsx";
import { spendS0Energy, getS0Energy, addS0Energy, S0_ENERGY_MAX, getProgressiveEnergyCost, getNewLessonsToday, incrementNewLessonsToday, storageGet, storageSet } from "./storage.js";

// ---------------------------------------------------------------------------
// EnergyInsufficientModal — #801
// ---------------------------------------------------------------------------
function EnergyInsufficientModal({ energy, energyMax, needed, waitStr, powers = [], nodeRect, onActivate, onClose }) {
  const [activating, setActivating] = React.useState(null);
  const cardRef = React.useRef(null);
  const [cardPos, setCardPos] = React.useState(null);

  React.useLayoutEffect(() => {
    if (!nodeRect || !cardRef.current) return;
    const card = cardRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const gap = 12;
    let top = nodeRect.top - card.height - gap;
    if (top < 8) top = nodeRect.bottom + gap;
    top = Math.max(8, Math.min(top, vh - card.height - 8));
    let left = nodeRect.left + nodeRect.width / 2 - card.width / 2;
    left = Math.max(8, Math.min(left, vw - card.width - 8));
    setCardPos({ top, left });
  }, [nodeRect]);

  const barPct = Math.round((energy / Math.max(energyMax, 1)) * 100);
  const cardStyle = cardPos
    ? { position: "absolute", top: cardPos.top, left: cardPos.left }
    : { position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)" };

  function parsePowerEmoji(name) {
    const m = name.match(/^([\p{Emoji_Presentation}\p{Extended_Pictographic}]+)/u);
    return m ? m[1] : "⚡";
  }
  function parsePowerLabel(name) {
    const after = name.split("•")[1];
    return after ? after.trim() : name.replace(/^[\p{Emoji_Presentation}\p{Extended_Pictographic}]+\s*/u, "").trim();
  }

  return (
    <div className="eim-overlay" onClick={onClose}>
      <div ref={cardRef} className="eim-card" style={{ ...cardStyle, opacity: cardPos || !nodeRect ? 1 : 0, transition: "opacity 0.1s" }} onClick={e => e.stopPropagation()}>
        <button className="eim-close" onClick={onClose} aria-label="Close">✕</button>

        <div className="eim-header">
          <span className="eim-icon">⚡</span>
          <div>
            <div className="eim-title">Not Enough Energy</div>
            <div className="eim-subtitle">This lesson needs <strong>{needed}</strong> energy</div>
          </div>
        </div>

        <div className="eim-bar-section">
          <div className="eim-bar-label">
            <span>Current energy</span>
            <span className="eim-bar-nums">{energy} / {energyMax}</span>
          </div>
          <div className="eim-bar-track">
            <div className="eim-bar-fill" style={{ width: `${barPct}%` }} />
            {needed <= energyMax && (
              <div className="eim-bar-needed-mark" style={{ left: `${Math.round((needed / energyMax) * 100)}%` }} />
            )}
          </div>
          <div className="eim-recharge">
            🕐 Recharges in <strong>{waitStr}</strong>
          </div>
        </div>

        {powers.length > 0 && (
          <div className="eim-powers-section">
            <div className="eim-powers-title">Energy Powers</div>
            {powers.map(p => (
              <div key={p.slot} className={`eim-power-card${p.mechanic === "passive" ? " eim-power-passive" : ""}`}>
                <div className="eim-power-emoji">{parsePowerEmoji(p.name)}</div>
                <div className="eim-power-info">
                  <div className="eim-power-name">{parsePowerLabel(p.name)}</div>
                  <div className="eim-power-desc">{p.desc}</div>
                </div>
                <div className="eim-power-action">
                  {p.mechanic === "passive" ? (
                    <span className="eim-power-badge eim-badge-passive">Passive</span>
                  ) : p.canActivate ? (
                    <button
                      className="eim-activate-btn"
                      disabled={activating === p.slot}
                      onClick={async () => {
                        setActivating(p.slot);
                        await onActivate(p.slot);
                        setActivating(null);
                      }}
                    >
                      {activating === p.slot ? "…" : "Use"}
                    </button>
                  ) : (
                    <span className="eim-power-badge eim-badge-cooldown">On cooldown</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// LessonPathFeature
//
// Props (all required unless noted):
//   tab             — current app tab string
//   classCode       — student's first enabled class code (string | undefined)
//   profile         — user profile object
//   words           — full word list
//   speakEnglish       — TTS function (text: string) => void
//   avatarCatalog   — result of getFullAvatarCatalog()
//   appClassCodes   — teacher's class codes array (for ManageLessonsModal)
//   teacher         — boolean
//   showManageLessonsModal  — boolean (controlled from App, teacher home button)
//   onManageLessonsClose    — () => void
//
//   onHasLessons(bool)      — fires when lessons load, drives tab Path visibility
//   onPracticeFilter(ids)   — student clicked "Practice now!" in player
//   onGoToPractice()        — navigate to practice tab
//   onCoinsAwarded(amount)  — section reward: credit coins in App
//   onCoinsFly()            — section reward: trigger coin animation in App
//   onTicketAwarded()       — section reward: increment rare ticket in App
// ---------------------------------------------------------------------------
const LessonPathFeature = forwardRef(function LessonPathFeature(
  {
    tab,
    classCode,
    profile,
    words,
    speakEnglish,
    avatarCatalog,
    appClassCodes,
    teacher,
    onHasLessons,
    onPracticeFilter,
    onGoToPractice,
    onCoinsAwarded,
    onCoinsFly,
    onTicketAwarded,
    onStreakUpdate,
    onGetCatSkillEffects,
    onPathStatsUpdate,
    onEnergySpend,
    onPathAccuracy,
    onGetEnergyPowers,
    onActivateEnergyPower,
    onUnlockClassCode,
    onStageComplete,
    onSaveVocabWord,
    onCreateFlashcardWord,
    allCategories = [],
    onNodeIndexUpdate,
    walkEnabled = true,
  },
  ref
) {
  // ── LP state (isolated from App scope — this is the TDZ fix) ─────────────
  const [activeLessonPlayer,    setActiveLessonPlayer]    = useState(null);
  const [catSkillEffects,       setCatSkillEffects]       = useState({ removeWrongOption: false });
  const [lessonRewardToasts,    setLessonRewardToasts]    = useState([]);
  const [pathLessons,           setPathLessons]           = useState([]);
  const [pathProgress,          setPathProgress]          = useState({});
  const [pathSectionStats,      setPathSectionStats]      = useState(null);
  const [showManageLessonsModal, setShowManageLessonsModal] = useState(false); // owned here — avoids TDZ in App
  const [effectiveClassCode, setEffectiveClassCode] = useState(null);
  const [energyVersion,      setEnergyVersion]      = useState(0); // #562
  const [energyModal,        setEnergyModal]        = useState(null); // #801 — replaces energyWaitMsg string
  const [pathSectionMeta,    setPathSectionMeta]    = useState({}); // #707
  // #725 — unified path state
  const [allPathCodes,     setAllPathCodes]     = useState([]);
  const [currentPathCode,  setCurrentPathCode]  = useState(null);
  const allPathCodesRef    = React.useRef([]);
  const currentPathCodeRef = React.useRef(null);

  // ── Decorative avatars for path map background (LP5) ─────────────────────
  const decorativeAvatars = useMemo(() => {
    const now      = new Date();
    const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    return getDecorativeAvatars(avatarCatalog, monthKey);
  }, [avatarCatalog]);

  // ── LP4 — load all lessons from all codes (#725 unified path) ────────────
  const loadPathData = useCallback(async (fallbackCode) => {
    const allCodes = await listAllClassCodes();
    // Always include S0C1 as fallback so new students see the path on first login
    const codesWithFallback = allCodes.length > 0 ? allCodes : ["S0C1"];
    setAllPathCodes(codesWithFallback);
    allPathCodesRef.current = codesWithFallback;

    const currentCode = await getPathCurrentCode(codesWithFallback, fallbackCode || codesWithFallback[0]);
    setCurrentPathCode(currentCode);
    currentPathCodeRef.current = currentCode;
    setEffectiveClassCode(currentCode);

    const [allLessons, prog] = await Promise.all([
      listAllLessonsOrdered(codesWithFallback),
      getLessonProgress(),
    ]);

    // Section meta: composite keys classCode::sectionIndex
    const metaPerCode = await Promise.all(codesWithFallback.map(cc => getSectionMeta(cc)));
    const combinedMeta = {};
    codesWithFallback.forEach((cc, i) => {
      Object.entries(metaPerCode[i]).forEach(([si, data]) => {
        combinedMeta[`${cc}::${si}`] = data;
      });
    });
    setPathSectionMeta(combinedMeta);

    // Ensure first S0 lesson is available for new students
    const s0Lessons = allLessons
      .filter(l => l.classCode?.startsWith("S0"))
      .sort((a, b) => a.sectionIndex - b.sectionIndex || a.orderInSection - b.orderInSection);
    if (s0Lessons.length) await ensureS0FirstLessonAvailable(s0Lessons);

    const freshProg = await getLessonProgress();
    setPathLessons(allLessons);
    setPathProgress(freshProg);

    // Section stats: keyed by classCode::sectionIndex
    const codeSecKeys = [...new Set(allLessons.map(l => `${l.classCode}::${l.sectionIndex}`))];
    const statsEntries = await Promise.all(
      codeSecKeys.map(async key => {
        const sep = key.indexOf("::");
        const cc  = key.slice(0, sep);
        const si  = Number(key.slice(sep + 2));
        return [key, await getSectionProgress(cc, si)];
      })
    );
    setPathSectionStats(new Map(statsEntries));
    onHasLessons?.(allLessons.length);
  }, [onHasLessons]);

  // Expose loadPathData so App can trigger it (e.g. from the nav tab click)
  useImperativeHandle(ref, () => ({ loadPathData, openManageLessons: () => setShowManageLessonsModal(true) }), [loadPathData]);

  // Load on mount / classCode change; teacher uses appClassCodes[0] as the view target
  useEffect(() => {
    loadPathData(teacher ? appClassCodes?.[0]?.code : classCode);
  }, [teacher, classCode, appClassCodes, loadPathData]);

  // #572 — load cat effects on mount so energyMax is known for the path screen
  // (not just when opening a lesson). Re-runs whenever tab switches to "path".
  useEffect(() => {
    if (teacher || tab !== "path") return;
    onGetCatSkillEffects?.().then(effects => {
      if (effects) setCatSkillEffects(effects);
    }).catch(() => {});
  }, [tab, teacher]); // eslint-disable-line

  // ── LP6 — lesson complete handler ────────────────────────────────────────
  const handleLessonComplete = useCallback(async (lessonId, cc, sectionIndex, lessonStats = {}) => {
    const isFirstTime = !pathProgress[lessonId]?.completedAt;
    await markLessonComplete(lessonId);

    // #499/#886/#888 — lesson totals shared by isFirstTime and !isFirstTime blocks
    const {
      correctCounts = {},
      listeningTotal = 0, calligraphyTotal = 0, matchTotal = 0,
      listenWriteTotal = 0, memoryCheckTotal = 0,
      writeWordTotal = 0, listenWriteWordTotal = 0, matchWriteWordTotal = 0,
      tipsInLesson = 0,
    } = lessonStats;
    const totalExercises = listeningTotal + calligraphyTotal + matchTotal
      + listenWriteTotal + memoryCheckTotal
      + writeWordTotal + listenWriteWordTotal + matchWriteWordTotal;
    const totalCorrect = (correctCounts.listening    || 0) + (correctCounts.calligraphy    || 0)
      + (correctCounts.match        || 0) + (correctCounts.listenWrite    || 0)
      + (correctCounts.memoryCheck  || 0) + (correctCounts.writeWord      || 0)
      + (correctCounts.listenWriteWord || 0) + (correctCounts.matchWriteWord || 0);

    // #467 — award 2 Meowtongs per step on first completion
    if (isFirstTime) {
      const lesson = pathLessons.find(l => l.id === lessonId);
      const stepCount = lesson?.steps?.length || 0;
      if (stepCount > 0) {
        let baseCoins = stepCount * 2;
        if (catSkillEffects.pathFirstLessonDouble) {
          const storedDate = await storageGet("path-first-lesson-date", false);
          const today = new Date();
          const todayKey = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,"0")}-${String(today.getDate()).padStart(2,"0")}`;
          if (storedDate !== todayKey) {
            baseCoins = baseCoins * 2;
            await storageSet("path-first-lesson-date", todayKey, false);
          }
        }
        await onCoinsAwarded?.(baseCoins, "Lesson completion");
      }

      // #534 — extra rewards configured by the teacher
      if ((lesson?.rewardCoins || 0) > 0) {
        await onCoinsAwarded?.(lesson.rewardCoins, "Lesson extra reward");
      }
      if (lesson?.rewardTicket) {
        await onTicketAwarded?.(lesson.rewardTicket);
      }

      // #499 — accumulate Path Mode stats for achievements
      if (totalExercises > 0) onPathAccuracy?.({ correct: totalCorrect, total: totalExercises });
      const isPerfect = totalExercises > 0 && totalCorrect === totalExercises;

      // #701 — perfect_lesson_bonus: +50% coins when lesson is flawless
      if (isPerfect && catSkillEffects.perfectLessonBonus > 0) {
        const lesson2 = pathLessons.find(l => l.id === lessonId);
        const stepCount2 = lesson2?.steps?.length || 0;
        const bonusCoins = Math.round(stepCount2 * 2 * catSkillEffects.perfectLessonBonus);
        if (bonusCoins > 0) await onCoinsAwarded?.(bonusCoins, "🎯 Perfect lesson bonus");
      }

      const isMiddleConsonants = lesson?.title?.toLowerCase().includes("middle class consonants");
      // #705 — track new lessons today for progressive energy cost
      await incrementNewLessonsToday();
      await onPathStatsUpdate?.({
        lessonsCompleted: 1,
        classCode: cc,
        listeningCorrect:   correctCounts.listening  || 0,
        matchCorrect:       correctCounts.match      || 0,
        listenWriteCorrect: correctCounts.listenWrite || 0,
        tipsRead: tipsInLesson,
        // #757/#888 — skill-level tracking (Listening / Vocabulary / Writing)
        skillListeningCorrect: (correctCounts.listening || 0) + (correctCounts.listenWrite || 0) + (correctCounts.listenWriteWord || 0),
        skillListeningTotal:   listeningTotal + listenWriteTotal + listenWriteWordTotal,
        skillVocabularyCorrect: (correctCounts.match || 0) + (correctCounts.memoryCheck || 0) + (correctCounts.matchWriteWord || 0),
        skillVocabularyTotal:   matchTotal + memoryCheckTotal + matchWriteWordTotal,
        skillWritingCorrect: (correctCounts.calligraphy || 0) + (correctCounts.listenWrite || 0) + (correctCounts.memoryCheck || 0) + (correctCounts.writeWord || 0) + (correctCounts.listenWriteWord || 0) + (correctCounts.matchWriteWord || 0),
        skillWritingTotal:   calligraphyTotal + listenWriteTotal + memoryCheckTotal + writeWordTotal + listenWriteWordTotal + matchWriteWordTotal,
        ...(isPerfect && { perfectLessons: 1 }),
        ...(isMiddleConsonants && { middleConsonants2Done: true }),
        // #703 — consonant milestone flags (Section 0)
        ...(sectionIndex === 0 && (lesson?.orderInSection || 0) >= 6 && { lowClassDone: true }),
        ...(sectionIndex === 0 && (lesson?.orderInSection || 0) >= 8 && { highClassDone: true }),
        ...(sectionIndex === 0 && (lesson?.orderInSection || 0) >= 9 && { firstMasteryDone: true }),
      });
    }

    // #703/#888 — secret_repeat_perfect: replay with 100% accuracy across all exercise types
    if (!isFirstTime && totalExercises > 0 && totalCorrect === totalExercises) {
      await onPathStatsUpdate?.({ replayPerfectDone: true });
    }

    // #430 / #563 — energy deducted per 5 steps DURING the lesson (onEnergySpend callback);
    // here we only handle Tiger Ointment grant on first completion
    if (cc?.startsWith("S0") && isFirstTime) {
      if (catSkillEffects.energyGrantPerLesson > 0) {
        const effectiveMax = S0_ENERGY_MAX + (catSkillEffects.energyMaxBonus || 0);
        const current = await getS0Energy();
        const grant = Math.min(catSkillEffects.energyGrantPerLesson, Math.max(0, effectiveMax - current));
        if (grant > 0) await addS0Energy(grant);
      }
    }

    // #725 — advance classCode when the last lesson of the current code is completed
    try {
      const curCode  = currentPathCodeRef.current;
      const curCodes = allPathCodesRef.current;
      if (curCode && curCodes.length > 0) {
        const codeLessons = pathLessons
          .filter(l => l.classCode === curCode)
          .sort((a, b) => a.sectionIndex - b.sectionIndex || a.orderInSection - b.orderInSection);
        const lastLesson = codeLessons[codeLessons.length - 1];
        if (lastLesson && lastLesson.id === lessonId) {
          const nextCode = await advancePathCurrentCode(curCodes, curCode);
          if (nextCode !== curCode) {
            setCurrentPathCode(nextCode);
            currentPathCodeRef.current = nextCode;
          }
          // #847 — auto-unlock next classCode of the same stage in student roster
          const parseC = c => { const m = c.match(/C(\d+)$/); return m ? parseInt(m[1], 10) : 0; };
          const stagePrefix = curCode.replace(/C\d+$/, "");
          const sameStage = curCodes
            .filter(c => c.startsWith(stagePrefix) && /C\d+$/.test(c))
            .sort((a, b) => parseC(a) - parseC(b));
          const curIdx = sameStage.indexOf(curCode);
          if (curIdx >= 0 && curIdx + 1 < sameStage.length) {
            await onUnlockClassCode?.(sameStage[curIdx + 1]);
          } else if (curIdx >= 0) {
            // #848 — último classCode do stage: gate pelo Proficiency Exam
            const nextStageNum = parseInt(stagePrefix.replace(/^S/, ""), 10) + 1;
            const nextStagePrefix = `S${nextStageNum}`;
            const nextStageFirst = curCodes
              .filter(c => c.startsWith(nextStagePrefix) && /C\d+$/.test(c))
              .sort((a, b) => parseC(a) - parseC(b))[0] || null;
            await onStageComplete?.(curCode, nextStageFirst);
          }
        }
      }
    } catch (e) {
      console.error("[handleLessonComplete] code advance failed:", e);
    }

    // #564 — wrap all post-award operations so an exception in any of them
    // does NOT propagate up to LessonPlayerModal (which would leave the modal
    // open and block the coin/ticket celebrations already queued above).
    try {
      // issue #428 — S0 sequential unlock: after completing an S0 lesson, unlock the next one
      if (cc?.startsWith("S0")) {
        const s0Sorted = [...pathLessons]
          .filter(l => l.classCode?.startsWith("S0"))
          .sort((a, b) => a.sectionIndex - b.sectionIndex || a.orderInSection - b.orderInSection);
        const idx = s0Sorted.findIndex(l => l.id === lessonId);
        if (idx >= 0 && idx + 1 < s0Sorted.length) {
          await markLessonAvailable(s0Sorted[idx + 1].id);
        }
      }
      await loadPathData(cc);
      // LP7 — mirror node index to shared roster
      const nodeIndex = pathLessons.findIndex((l) => l.id === lessonId);
      if (nodeIndex >= 0 && profile?.username) {
        mirrorLessonNodeIndex(profile.username, nodeIndex).catch(() => {});
        onNodeIndexUpdate?.(nodeIndex); // #844 — keep App's studentNodeIndex in sync immediately
      }
      await checkAndClaimSectionRewards(cc, sectionIndex, {
        onAwardCoins: async (amount) => {
          // #700 — pathSectionCoinBonus: +50% on section rewards
          const bonus = catSkillEffects.pathSectionCoinBonus > 0
            ? Math.round(amount * catSkillEffects.pathSectionCoinBonus) : 0;
          await onCoinsAwarded?.(amount + bonus, "Section reward");
        },
        onSectionComplete: async () => {
          await onPathStatsUpdate?.({ sectionsCompleted: 1 });
        },
        onAwardTicket: async () => {
          await onTicketAwarded?.("rare");
        },
        onToast: (toast) => {
          const id = `lpr_${Date.now()}`;
          setLessonRewardToasts((q) => [...q, { id, ...toast }]);
          setTimeout(
            () => setLessonRewardToasts((q) => q.filter((t) => t.id !== id)),
            5000
          );
        },
      });
    } catch (e) {
      console.error("[handleLessonComplete] post-award step failed:", e);
    }

    // #852 — isolated so post-award failures never skip streak/activity-log write
    try {
      await onStreakUpdate?.();
    } catch (e) {
      console.error("[handleLessonComplete] streak update failed:", e);
    }
  }, [loadPathData, pathLessons, profile, catSkillEffects, onCoinsAwarded, onCoinsFly, onTicketAwarded, onStreakUpdate, onPathStatsUpdate]);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      {/* LP4 — path map (tab === "path"); teacher sees all nodes unlocked */}
      {tab === "path" && (
        <LessonPathScreen
          lessons={pathLessons}
          progress={pathProgress}
          sectionStats={pathSectionStats}
          sectionMeta={pathSectionMeta}
          decorativeAvatars={decorativeAvatars}
          classCode={effectiveClassCode || (teacher ? appClassCodes?.[0]?.code : classCode)}
          currentCode={currentPathCode}
          allCodes={allPathCodes}
          selfUsername={profile?.username}
          avatarCatalog={avatarCatalog}
          playerAvatarId={teacher ? null : profile?.avatar}
          teacherView={teacher}
          energyVersion={energyVersion}
          energyMax={S0_ENERGY_MAX + (catSkillEffects.energyMaxBonus || 0)}
          walkEnabled={walkEnabled && !activeLessonPlayer}
          onOpenLesson={teacher ? null : async (lesson, nodeRect) => {
            let effects = { removeWrongOption: false };
            try { effects = (await onGetCatSkillEffects?.()) ?? effects; } catch (_) {}
            setCatSkillEffects(effects);
            const isFirst = !pathProgress[lesson.id]?.completedAt;
            const coinsToAward = isFirst ? (lesson.steps?.length || 0) * 2 : 0;
            const energyMax = S0_ENERGY_MAX + (effects.energyMaxBonus || 0);
            let energy = null;
            try { energy = await getS0Energy(energyMax); } catch (_) {}

            // #705 — progressive energy cost (only for S0 new lessons)
            const isS0 = lesson.classCode?.startsWith("S0");
            let energyCostAmount = effects.energyCostHalf ? 1 : 2;
            let energyCostEvery  = 5;
            if (isS0 && isFirst) {
              const lessonsToday = await getNewLessonsToday();
              const cost = getProgressiveEnergyCost(lessonsToday);
              energyCostAmount = effects.energyCostHalf ? Math.ceil(cost.amount / 2) : cost.amount;
              energyCostEvery  = cost.every;
              const stepCount  = lesson.steps?.length || 0;
              const energyNeeded = Math.ceil(stepCount / cost.every) * cost.amount;
              const effectiveNeeded = effects.energyCostHalf ? Math.ceil(energyNeeded / 2) : energyNeeded;
              if ((energy ?? energyMax) < effectiveNeeded) {
                const deficit  = effectiveNeeded - (energy ?? 0);
                const totalMin = deficit * 15;
                const hrs = Math.floor(totalMin / 60);
                const min = totalMin % 60;
                const waitStr = hrs > 0 ? `${hrs}h ${min}min` : `${min}min`;
                const powers = onGetEnergyPowers ? await onGetEnergyPowers().catch(() => []) : [];
                setEnergyModal({ energy: energy ?? 0, energyMax, needed: effectiveNeeded, waitStr, powers, nodeRect });
                return;
              }
            }

            setActiveLessonPlayer({ lesson, coinsToAward, energy, energyMax, energyCostAmount, energyCostEvery });
          }}
        />
      )}

      {/* Backdrop that dims the path map while the lesson player is open */}
      {activeLessonPlayer && (
        <div style={{ position: "fixed", inset: 0, zIndex: 8999, background: "rgba(6, 4, 18, 0.87)", pointerEvents: "none" }} />
      )}

      {/* LP3 — lesson player modal */}
      {activeLessonPlayer && (
        <LessonPlayerModal
          lesson={activeLessonPlayer.lesson}
          words={words}
          speakEnglish={speakEnglish}
          profile={profile}
          avatarCatalog={avatarCatalog}
          removeWrongOption={catSkillEffects.removeWrongOption}
          coinsToAward={activeLessonPlayer.coinsToAward ?? 0}
          energy={activeLessonPlayer.energy ?? null}
          energyMax={activeLessonPlayer.energyMax ?? S0_ENERGY_MAX}
          energyCostPer5={activeLessonPlayer.energyCostAmount ?? (catSkillEffects.energyCostHalf ? 1 : 2)}
          energyCostEvery={activeLessonPlayer.energyCostEvery ?? 5}
          onEnergySpend={activeLessonPlayer.lesson.classCode?.startsWith("S0") ? async (cost) => {
            await spendS0Energy(cost);
            setEnergyVersion(v => v + 1);
            onEnergySpend?.(cost);
          } : null}
          onComplete={(lessonStats) =>
            handleLessonComplete(
              activeLessonPlayer.lesson.id,
              activeLessonPlayer.lesson.classCode,
              activeLessonPlayer.lesson.sectionIndex,
              lessonStats
            )
          }
          onPracticeNow={(wordIds) => {
            setActiveLessonPlayer(null);
            onPracticeFilter?.(wordIds.length ? wordIds : null);
            onGoToPractice?.();
          }}
          onClose={() => setActiveLessonPlayer(null)}
        />
      )}

      {/* Issue #521 — Manage Lessons as dedicated tab (teacher only) */}
      {tab === "lessons" && teacher && (
        <ManageLessonsModal
          asTab
          classCodes={appClassCodes}
          words={words}
          onSaveVocabWord={onSaveVocabWord}
          onCreateFlashcardWord={onCreateFlashcardWord}
          allCategories={allCategories}
        />
      )}

      {/* LP2 — teacher lesson authoring modal (legacy: still usable if openManageLessons() is called) */}
      {showManageLessonsModal && (
        <ManageLessonsModal
          classCodes={appClassCodes}
          words={words}
          onClose={() => setShowManageLessonsModal(false)}
          onSaveVocabWord={onSaveVocabWord}
          onCreateFlashcardWord={onCreateFlashcardWord}
          allCategories={allCategories}
        />
      )}

      {/* #801 — insufficient energy modal */}
      {energyModal && (
        <EnergyInsufficientModal
          energy={energyModal.energy}
          energyMax={energyModal.energyMax}
          needed={energyModal.needed}
          waitStr={energyModal.waitStr}
          powers={energyModal.powers}
          nodeRect={energyModal.nodeRect}
          onActivate={async (slot) => {
            if (!onActivateEnergyPower) return;
            const result = await onActivateEnergyPower(slot).catch(() => ({ ok: false }));
            if (result.ok) {
              // Refresh energy and close modal
              let newEnergy = energyModal.energy;
              if (result.energyGranted) newEnergy = Math.min(energyModal.energyMax, newEnergy + result.energyGranted);
              setEnergyModal(null);
            }
          }}
          onClose={() => setEnergyModal(null)}
        />
      )}

      {/* LP6 — section reward toasts */}
      {!teacher && lessonRewardToasts.map((t, i) => (
        <div
          key={t.id}
          className="ach-toast"
          style={{ "--ach-color": "#7B3FA8", "--idx": i + 4 }}
          onClick={() => setLessonRewardToasts((q) => q.filter((x) => x.id !== t.id))}
          role="button"
          aria-label="Dismiss notification"
        >
          <div className="ach-toast-glow" />
          <span className="ach-toast-emoji">{t.emoji}</span>
          <div className="ach-toast-body">
            <div className="ach-toast-super">{t.super}</div>
            <div className="ach-toast-title">{t.title}</div>
            <div className="ach-toast-desc">{t.desc}</div>
          </div>
          <div className="ach-toast-bar" />
        </div>
      ))}
    </>
  );
});

export default LessonPathFeature;
