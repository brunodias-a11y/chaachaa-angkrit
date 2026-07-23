// ---------------------------------------------------------------------------
// Lesson Path — Phase 21
// Feature module: data layer (LP1), authoring UI (LP2), player (LP3),
// path map (LP4), decorative background (LP5), rewards (LP6), social (LP7).
// ---------------------------------------------------------------------------
import React, { useState, useEffect, useRef, useCallback, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { X, Plus, ChevronUp, ChevronDown, Trash2, BookOpen, Lightbulb, Search, Volume2, ChevronLeft, ChevronRight, Lock, Check, Star } from "lucide-react";
import { storageGet, storageGetSafe, storageSet, storageDelete, storageList, storageUpload, getS0Energy, spendS0Energy, calcS0Energy, S0_ENERGY_MAX, S0_ENERGY_COST } from "./storage.js";
import { ENGLISH_STROKES } from "./data/englishStrokes";
// ALL_STROKE_DATA is the single source of truth for the calligraphy/tracing engine.
const ALL_STROKE_DATA = { ...ENGLISH_STROKES };
import { TracingCanvas, StrokeAnimation, getSvgPathFromStroke, TRACE_FREEHAND_OPTS } from "./calligraphy.jsx";
import { getStroke } from "perfect-freehand";
import { WordWritingCanvas } from "./wordWriting.jsx";

// ---------------------------------------------------------------------------
// Typography constants — change font here, takes effect everywhere in this file
export const FONT_ENGLISH = "'Poppins', sans-serif";   // language being learned (English)
export const FONT_THAI    = "'Sarabun', sans-serif";    // students' native language (Thai)

// ---------------------------------------------------------------------------
// LP1 — Data model & storage functions
// ---------------------------------------------------------------------------

// Storage key conventions
const LESSON_DEF_PREFIX    = "lesson-def:";       // shared_kv — lesson definition
const LESSON_INDEX_PREFIX  = "lesson-index:";     // shared_kv — ordered list of lessonIds per classCode
const LESSON_PROGRESS_KEY  = "lesson-progress";   // personal_kv — { [lessonId]: { completedAt, rewardClaimed } }
const SECTION_META_PREFIX  = "section-meta:";     // shared_kv — { [sectionIndex]: { name, font } } per classCode
const CODE_META_PREFIX     = "code-meta:";         // shared_kv — { cefrLevel } per classCode (#793)
const PATH_CURRENT_CODE_KEY = "path-current-code"; // personal_kv — classCode the student is currently on

// #725 — one accent color per code slot (index 0 = S0/fallback gold, 1-8 = C1-C8+)
export const CODE_COLORS = [
  { light: "#f5a623", dark: "#c8860a", shadow: "rgba(245,166,35,0.55)",  grad: ["#ffd080", "#f5a623", "#c8860a"] },
  { light: "#4ECDC4", dark: "#2eada5", shadow: "rgba(78,205,196,0.55)",  grad: ["#a8f0ec", "#4ECDC4", "#2eada5"] },
  { light: "#9B59B6", dark: "#7d3fa0", shadow: "rgba(155,89,182,0.55)",  grad: ["#d8a8e8", "#9B59B6", "#7d3fa0"] },
  { light: "#E74C3C", dark: "#c0392b", shadow: "rgba(231,76,60,0.55)",   grad: ["#f5a8a0", "#E74C3C", "#c0392b"] },
  { light: "#2ECC71", dark: "#27ae60", shadow: "rgba(46,204,113,0.55)",  grad: ["#90e8b0", "#2ECC71", "#27ae60"] },
  { light: "#3498DB", dark: "#2980b9", shadow: "rgba(52,152,219,0.55)",  grad: ["#90c8f0", "#3498DB", "#2980b9"] },
  { light: "#F39C12", dark: "#d68910", shadow: "rgba(243,156,18,0.55)",  grad: ["#fde8a0", "#F39C12", "#d68910"] },
  { light: "#E91E63", dark: "#c2185b", shadow: "rgba(233,30,99,0.55)",   grad: ["#f8a0c0", "#E91E63", "#c2185b"] },
  { light: "#5C6BC0", dark: "#3f51b5", shadow: "rgba(92,107,192,0.55)",  grad: ["#9fa8da", "#5C6BC0", "#3f51b5"] },
];

export function getCodeColorIndex(classCode, allCodes) {
  if (!allCodes || allCodes.length === 0) return 0;
  const idx = allCodes.indexOf(classCode);
  return idx >= 0 ? idx % CODE_COLORS.length : 0;
}

// #725 — load all lessons from all codes in progression order
export async function listAllLessonsOrdered(sortedCodes) {
  const perCode = await Promise.all(sortedCodes.map(cc => listLessonsByClassCode(cc)));
  return perCode.flat();
}

// #725 — track which classCode the student is currently working through
export async function getPathCurrentCode(sortedCodes, fallbackCode = null) {
  const stored = await storageGet(PATH_CURRENT_CODE_KEY, false);
  if (stored && sortedCodes.includes(stored)) return stored;
  if (fallbackCode && sortedCodes.includes(fallbackCode)) return fallbackCode;
  return sortedCodes[0] || null;
}

export async function advancePathCurrentCode(sortedCodes, currentCode) {
  const idx = sortedCodes.indexOf(currentCode);
  if (idx < 0 || idx >= sortedCodes.length - 1) return currentCode;
  const next = sortedCodes[idx + 1];
  await storageSet(PATH_CURRENT_CODE_KEY, next, false);
  return next;
}

// #707 — Section meta (name + font) per classCode
export async function getSectionMeta(classCode) {
  if (!classCode) return {};
  return (await storageGet(`${SECTION_META_PREFIX}${classCode}`, true)) || {};
}
export async function setSectionMeta(classCode, meta) {
  await storageSet(`${SECTION_META_PREFIX}${classCode}`, meta, true);
}

// #793 — Code meta (cefrLevel) per classCode
export const CEFR_LEVELS_ORDERED = ["Pre-A1", "A1", "A2", "B1", "B2", "C1", "C2"];
export async function getCodeMeta(code) {
  if (!code) return {};
  return (await storageGet(`${CODE_META_PREFIX}${code}`, true)) || {};
}
export async function setCodeMeta(code, meta) {
  await storageSet(`${CODE_META_PREFIX}${code}`, meta, true);
}
// S0/S1 prefix always = Pre-A1 (hardcoded); all others read from stored meta.
export function resolveCodeLevel(code, metaMap = {}) {
  const prefix = code?.match(/^(S\d+)/)?.[1];
  if (prefix === "S0" || prefix === "S1") return "Pre-A1";
  return metaMap[code]?.cefrLevel || null;
}
function isPreA1Prefix(code) {
  const prefix = code?.match(/^(S\d+)/)?.[1];
  return prefix === "S0" || prefix === "S1";
}

// Fonts available for section name display
export const SECTION_NAME_FONTS = [
  { value: "Sarabun",          label: "Sarabun (Thai)" },
  { value: "Poppins",          label: "Poppins" },
  { value: "Work Sans",        label: "Work Sans" },
  { value: "Noto Sans Thai",   label: "Noto Sans Thai" },
  { value: "Cormorant Unicase",label: "Cormorant Unicase" },
  { value: "Fraunces",         label: "Fraunces" },
];

// Generate a lesson ID scoped to the current month and classCode.
// Format: l-YYYY-MM-<classCode>-<random>
function newLessonId(classCode) {
  const now   = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const rand  = Math.random().toString(36).slice(2, 6);
  return `l-${month}-${classCode.toLowerCase().replace(/[^a-z0-9]/g, "")}-${rand}`;
}

// ---------------------------------------------------------------------------
// Lesson definitions (shared_kv — written by teacher, read by everyone)
// ---------------------------------------------------------------------------

export async function getLessonDef(lessonId) {
  return storageGet(`${LESSON_DEF_PREFIX}${lessonId}`, true);
}

export async function saveLessonDef(lesson) {
  const def = {
    ...lesson,
    id: lesson.id || newLessonId(lesson.classCode),
    createdAt: lesson.createdAt || Date.now(),
  };

  const ok = await storageSet(`${LESSON_DEF_PREFIX}${def.id}`, def, true);
  if (!ok) return null;

  // Maintain the ordered index for this classCode
  await _addToIndex(def.classCode, def.id);

  return def;
}

export async function deleteLessonDef(lessonId, classCode) {
  await storageDelete(`${LESSON_DEF_PREFIX}${lessonId}`, true);
  await _removeFromIndex(classCode, lessonId);
}

// Returns lessons ordered by (sectionIndex, orderInSection).
export async function listLessonsByClassCode(classCode) {
  const index = await _getIndex(classCode);
  if (!index.length) return [];

  const defs = await Promise.all(index.map(id => getLessonDef(id)));
  return defs
    .filter(Boolean)
    .sort((a, b) =>
      a.sectionIndex !== b.sectionIndex
        ? a.sectionIndex - b.sectionIndex
        : a.orderInSection - b.orderInSection
    );
}

// ---------------------------------------------------------------------------
// Index helpers — lesson-index:{classCode} is an array of lessonIds in shared_kv.
// Uses storageGetSafe for read-merge-write safety (same pattern as roster writes).
// ---------------------------------------------------------------------------

async function _getIndex(classCode) {
  return (await storageGet(`${LESSON_INDEX_PREFIX}${classCode}`, true)) || [];
}

async function _addToIndex(classCode, lessonId) {
  const key = `${LESSON_INDEX_PREFIX}${classCode}`;
  const { value, error } = await storageGetSafe(key, true);
  if (error) return; // abort — don't overwrite with a partial list
  const current = value || [];
  if (current.includes(lessonId)) return;
  await storageSet(key, [...current, lessonId], true);
}

async function _removeFromIndex(classCode, lessonId) {
  const key = `${LESSON_INDEX_PREFIX}${classCode}`;
  const { value, error } = await storageGetSafe(key, true);
  if (error) return;
  const current = value || [];
  await storageSet(key, current.filter(id => id !== lessonId), true);
}

// ---------------------------------------------------------------------------
// Student progress (personal_kv — scoped per student via RLS)
// ---------------------------------------------------------------------------

export async function getLessonProgress() {
  return (await storageGet(LESSON_PROGRESS_KEY, false)) || {};
}

// Marks a lesson as complete. Returns the updated progress map.
export async function markLessonComplete(lessonId) {
  const progress = await getLessonProgress();
  if (progress[lessonId]?.completedAt) return progress; // idempotent

  const updated = {
    ...progress,
    [lessonId]: { ...progress[lessonId], completedAt: Date.now(), rewardClaimed: false },
  };
  await storageSet(LESSON_PROGRESS_KEY, updated, false);
  return updated;
}

// Marks a lesson as available (used for S0 sequential unlock). Idempotent.
export async function markLessonAvailable(lessonId) {
  const progress = await getLessonProgress();
  if (progress[lessonId]?.available || progress[lessonId]?.completedAt) return;
  const updated = { ...progress, [lessonId]: { ...progress[lessonId], available: true } };
  await storageSet(LESSON_PROGRESS_KEY, updated, false);
}

// Ensures the first S0 lesson in an ordered list is unlocked.
// Called on loadPathData so new students can start without teacher action.
export async function ensureS0FirstLessonAvailable(s0Lessons) {
  if (!s0Lessons.length) return;
  const progress = await getLessonProgress();
  const anyUnlocked = s0Lessons.some(l => progress[l.id]?.available || progress[l.id]?.completedAt);
  if (!anyUnlocked) await markLessonAvailable(s0Lessons[0].id);
}

// Returns whether the student has already claimed the reward for a section half.
// half: "mid" (50%) or "full" (100%)
export async function hasClaimedReward(classCode, sectionIndex, half) {
  const progress = await getLessonProgress();
  const key = `reward:${classCode}:${sectionIndex}:${half}`;
  return !!progress[key]?.claimed;
}

// Marks a reward as claimed. Called by LP6 after granting coins/ticket.
export async function markRewardClaimed(classCode, sectionIndex, half) {
  const progress = await getLessonProgress();
  const key = `reward:${classCode}:${sectionIndex}:${half}`;
  const updated = { ...progress, [key]: { claimed: true, claimedAt: Date.now() } };
  await storageSet(LESSON_PROGRESS_KEY, updated, false);
  return updated;
}

// Returns completion stats for a section: { total, completed, midClaimed, fullClaimed }
export async function getSectionProgress(classCode, sectionIndex) {
  const [lessons, progress] = await Promise.all([
    listLessonsByClassCode(classCode),
    getLessonProgress(),
  ]);
  const section = lessons.filter(l => l.sectionIndex === sectionIndex);
  const completed = section.filter(l => !!progress[l.id]?.completedAt).length;
  return {
    total:      section.length,
    completed,
    midClaimed:  !!progress[`reward:${classCode}:${sectionIndex}:mid`]?.claimed,
    fullClaimed: !!progress[`reward:${classCode}:${sectionIndex}:full`]?.claimed,
  };
}

// ---------------------------------------------------------------------------
// LP6 — Section rewards
//
// checkAndClaimSectionRewards(classCode, sectionIndex, callbacks)
//   Computes section completion after a lesson is marked complete.
//   Grants each unclaimed reward exactly once.
//
//   callbacks:
//     onAwardCoins(amount)  — called by App.jsx to run creditCoins + coin shower
//     onAwardTicket()       — called by App.jsx to increment gacha-tickets.rare
//     onToast(msg)          — called to surface a reward toast to the student
// ---------------------------------------------------------------------------

export async function checkAndClaimSectionRewards(classCode, sectionIndex, { onAwardCoins, onAwardTicket, onSectionComplete, onToast } = {}) {
  const stats = await getSectionProgress(classCode, sectionIndex);
  if (stats.total === 0) return;

  const pct = stats.completed / stats.total;

  // Mid reward: ≥ 50% and not yet claimed
  if (pct >= 0.5 && !stats.midClaimed) {
    await markRewardClaimed(classCode, sectionIndex, "mid");
    onToast?.({ emoji: "⭐", super: "Section reward", title: "Halfway there!", desc: "Keep going!" });
  }

  // Full reward: 100% and not yet claimed
  if (pct >= 1 && !stats.fullClaimed) {
    await markRewardClaimed(classCode, sectionIndex, "full");
    await onSectionComplete?.();
    onToast?.({ emoji: "🏆", super: "Section complete!", title: "All lessons done!", desc: "Great work!" });
  }
}

// ---------------------------------------------------------------------------

// Issue #426 — list all classCodes that have at least one lesson-index entry.
// Used by App.jsx to populate appClassCodes for ManageLessonsModal.
export async function listAllClassCodes() {
  const keys = await storageList(LESSON_INDEX_PREFIX, true);
  return keys
    .map(k => k.replace(LESSON_INDEX_PREFIX, ""))
    .filter(Boolean)
    .sort((a, b) => {
      // Semantic sort: S0 < S1 < S2 … (numeric stage comparison)
      const parseStage = s => {
        const m = s.match(/^S(\d+)/i);
        return m ? parseInt(m[1], 10) : 999;
      };
      return parseStage(a) - parseStage(b) || a.localeCompare(b);
    });
}

// LP2 — ManageLessonsModal (Teacher Panel authoring UI)
// Props:
//   classCodes — array of { code } from the app's shared registry
//   words      — full word bank array (for vocab step search)
//   onClose    — close callback
// ---------------------------------------------------------------------------

const EMPTY_LESSON_FORM = { title: "", classCode: "", sectionIndex: 0, orderInSection: 0, steps: [], rewardCoins: 0, rewardTicket: "" };

function StepCard({ step, index, total, onChange, onRemove, onMoveUp, onMoveDown, words }) {
  const [query, setQuery] = useState("");
  const filtered = query.trim()
    ? words.filter(w =>
        w.thai?.includes(query) ||
        w.english?.toLowerCase().includes(query.toLowerCase()) ||
        w.romanization?.toLowerCase().includes(query.toLowerCase())
      ).slice(0, 8)
    : [];

  return (
    <div className="lp-step-card">
      <div className="lp-step-header">
        <span className="lp-step-type-badge">
          {step.type === "vocab" ? <BookOpen size={12} /> : <Lightbulb size={12} />}
          {step.type === "calligraphy" ? "✍️" : step.type === "listening" ? "👂" : step.type === "image-match" ? "🖼️" : step.type === "listen-write" ? "👂✍️" : step.type === "memory-check" ? "🖼️✍️" : step.type === "write-word" ? "✍️📝" : step.type === "listen-write-word" ? "👂✍️📝" : step.type === "match-write-word" ? "🖼️✍️📝" : null}
          {step.type}
        </span>
        <div className="lp-step-actions">
          <button className="icon-btn" onClick={onMoveUp}  disabled={index === 0}         title="Move up">   <ChevronUp   size={14} /></button>
          <button className="icon-btn" onClick={onMoveDown} disabled={index === total - 1} title="Move down"> <ChevronDown size={14} /></button>
          <button className="icon-btn" onClick={onRemove} title="Remove step"><Trash2 size={14} /></button>
        </div>
      </div>

      {step.type === "vocab" && (
        <div className="lp-step-vocab">
          {step.wordId ? (
            <div className="lp-step-word-preview">
              {(() => {
                const w = words.find(x => x.id === step.wordId);
                return w
                  ? <><span className="lp-preview-en">{w.english}</span> <span className="lp-preview-thai">{w.romanization} · {w.thai}</span></>
                  : <span className="lp-preview-en">Word ID: {step.wordId}</span>;
              })()}
              <button className="icon-btn" onClick={() => onChange({ ...step, wordId: null })} title="Change word">
                <X size={12} />
              </button>
            </div>
          ) : (
            <div className="lp-word-search">
              <div className="lp-word-search-input-wrap">
                <Search size={13} />
                <input
                  placeholder="Search English, Thai or romanization…"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  className="lp-word-search-input"
                />
              </div>
              {filtered.length > 0 && (
                <div className="lp-word-results">
                  {filtered.map(w => (
                    <button key={w.id} className="lp-word-result-row" onClick={() => { onChange({ ...step, wordId: w.id }); setQuery(""); }}>
                      <span className="lp-preview-en">{w.english}</span>
                      <span className="lp-preview-thai">{w.romanization} · {w.thai}</span>
                    </button>
                  ))}
                </div>
              )}
              {query.trim() && filtered.length === 0 && (
                <div className="lp-word-empty">No words found.</div>
              )}
            </div>
          )}
        </div>
      )}

      {step.type === "tip" && (
        <div className="lp-tip-editor">
          <textarea
            className="lp-tip-input"
            placeholder="Tip text…"
            value={step.text || ""}
            onChange={e => onChange({ ...step, text: e.target.value })}
            rows={3}
          />
          <div className="lp-step-char-row" style={{ marginTop: 4 }}>
            <label className="lp-step-char-label">Read aloud (optional)</label>
            <input
              className="lp-step-char-input"
              style={{ width: 200, fontSize: 14 }}
              value={step.speakText || ""}
              onChange={e => onChange({ ...step, speakText: e.target.value })}
              placeholder="ay"
            />
          </div>
          {step.imageUrl ? (
            <div className="lp-tip-img-preview">
              <img src={step.imageUrl} alt="tip" className="lp-tip-thumb" />
              <button
                type="button"
                className="lp-tip-img-remove"
                onClick={() => onChange({ ...step, imageUrl: "" })}
                aria-label="Remove image"
              >×</button>
            </div>
          ) : (
            <label className="btn-secondary lp-tip-upload-btn">
              Upload image
              <input
                type="file"
                accept="image/*"
                style={{ display: "none" }}
                onChange={async e => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  try {
                    const url = await storageUpload(file, "lesson-assets", "tips/");
                    onChange({ ...step, imageUrl: url });
                  } catch (err) {
                    alert("Upload failed: " + err.message);
                  }
                }}
              />
            </label>
          )}
        </div>
      )}

      {step.type === "calligraphy" && (
        <div className="lp-step-char-row">
          <label className="lp-step-char-label">English character</label>
          <input
            className="lp-step-char-input"
            value={step.char || ""}
            onChange={e => onChange({ ...step, char: [...e.target.value].slice(-1).join("") })}
            placeholder="A"
          />
          {step.char && ALL_STROKE_DATA[step.char] && (
            <span className="lp-step-char-ok">✓ stroke data available</span>
          )}
          {step.char && !ALL_STROKE_DATA[step.char] && (
            <span className="lp-step-char-warn">⚠ no stroke data for this character</span>
          )}
          <label className="lp-step-char-label" style={{ marginLeft: 12 }}>Speak as (optional)</label>
          <input
            className="lp-step-char-input"
            style={{ width: 140, fontSize: 14 }}
            value={step.speakText || ""}
            onChange={e => onChange({ ...step, speakText: e.target.value })}
            placeholder="ay"
          />
        </div>
      )}

      {(step.type === "listening" || step.type === "image-match") && (
        <div className="lp-step-char-row">
          <label className="lp-step-char-label">English character</label>
          <input
            className="lp-step-char-input"
            value={step.char || ""}
            onChange={e => onChange({ ...step, char: [...e.target.value].slice(-1).join("") })}
            placeholder="A"
          />
          <label className="lp-step-char-label" style={{ marginLeft: 12 }}>Distractors (leave blank for random)</label>
          <input
            className="lp-step-char-input lp-step-distractors-input"
            value={(step.distractors || []).join("")}
            onChange={e => onChange({ ...step, distractors: [...e.target.value].slice(0, 3) })}
            placeholder="BCD"
            maxLength={3}
          />
        </div>
      )}

      {(step.type === "listening" || step.type === "image-match") && (
        <div className="lp-step-char-row" style={{ marginTop: 4 }}>
          <label className="lp-step-char-label">Speak as (optional)</label>
          <input
            className="lp-step-char-input"
            style={{ width: 140, fontSize: 14 }}
            value={step.speakText || ""}
            onChange={e => onChange({ ...step, speakText: e.target.value })}
            placeholder="ay"
          />
        </div>
      )}

      {step.type === "image-match" && (
        <div className="lp-tip-editor" style={{ marginTop: 6 }}>
          {step.imageUrl ? (
            <div className="lp-tip-img-preview">
              <img src={step.imageUrl} alt="reference" className="lp-tip-thumb" />
              <button type="button" className="lp-tip-img-remove" onClick={() => onChange({ ...step, imageUrl: "" })} aria-label="Remove image">×</button>
            </div>
          ) : (
            <label className="btn-secondary lp-tip-upload-btn">
              Upload reference image
              <input type="file" accept="image/*" style={{ display: "none" }} onChange={async e => {
                const file = e.target.files?.[0];
                if (!file) return;
                try { onChange({ ...step, imageUrl: await storageUpload(file, "lesson-assets", "image-match/") }); }
                catch (err) { alert("Upload failed: " + err.message); }
              }} />
            </label>
          )}
        </div>
      )}

      {step.type === "listen-write" && (
        <div className="lp-step-char-row">
          <label className="lp-step-char-label">English character</label>
          <input
            className="lp-step-char-input"
            value={step.char || ""}
            onChange={e => onChange({ ...step, char: [...e.target.value].slice(-1).join("") })}
            placeholder="A"
          />
          <label className="lp-step-char-label" style={{ marginLeft: 12 }}>Speak as</label>
          <input
            className="lp-step-char-input"
            style={{ width: 140, fontSize: 14 }}
            value={step.speakText || ""}
            onChange={e => onChange({ ...step, speakText: e.target.value })}
            placeholder="ay"
          />
        </div>
      )}

      {step.type === "memory-check" && (
        <>
          <div className="lp-step-char-row">
            <label className="lp-step-char-label">English character</label>
            <input
              className="lp-step-char-input"
              value={step.char || ""}
              onChange={e => onChange({ ...step, char: e.target.value.slice(-1) })}
              placeholder="A"
              maxLength={1}
            />
            <label className="lp-step-char-label" style={{ marginLeft: 12 }}>Speak as (optional)</label>
            <input
              className="lp-step-char-input"
              style={{ width: 140, fontSize: 14 }}
              value={step.speakText || ""}
              onChange={e => onChange({ ...step, speakText: e.target.value })}
              placeholder="ay"
            />
          </div>
          <div className="lp-tip-editor" style={{ marginTop: 6 }}>
            {step.imageUrl ? (
              <div className="lp-tip-img-preview">
                <img src={step.imageUrl} alt="reference" className="lp-tip-thumb" />
                <button type="button" className="lp-tip-img-remove" onClick={() => onChange({ ...step, imageUrl: "" })} aria-label="Remove image">×</button>
              </div>
            ) : (
              <label className="btn-secondary lp-tip-upload-btn">
                Upload reference image
                <input type="file" accept="image/*" style={{ display: "none" }} onChange={async e => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  try { onChange({ ...step, imageUrl: await storageUpload(file, "lesson-assets", "memory-check/") }); }
                  catch (err) { alert("Upload failed: " + err.message); }
                }} />
              </label>
            )}
          </div>
        </>
      )}

      {step.type === "write-word" && (
        <div className="lp-step-char-row">
          <label className="lp-step-char-label">English word</label>
          <input
            className="lp-step-char-input"
            style={{ width: 140, fontSize: 18 }}
            value={step.word || ""}
            onChange={e => onChange({ ...step, word: e.target.value })}
            placeholder="cat"
          />
          <label className="lp-step-char-label" style={{ marginLeft: 12 }}>Speak as (optional)</label>
          <input
            className="lp-step-char-input"
            style={{ width: 140, fontSize: 14 }}
            value={step.speakText || ""}
            onChange={e => onChange({ ...step, speakText: e.target.value })}
            placeholder="cat"
          />
        </div>
      )}

      {step.type === "listen-write-word" && (
        <div className="lp-step-char-row">
          <label className="lp-step-char-label">English word</label>
          <input
            className="lp-step-char-input"
            style={{ width: 140, fontSize: 18 }}
            value={step.word || ""}
            onChange={e => onChange({ ...step, word: e.target.value })}
            placeholder="cat"
          />
          <label className="lp-step-char-label" style={{ marginLeft: 12 }}>Speak as</label>
          <input
            className="lp-step-char-input"
            style={{ width: 140, fontSize: 14 }}
            value={step.speakText || ""}
            onChange={e => onChange({ ...step, speakText: e.target.value })}
            placeholder="cat"
          />
        </div>
      )}

      {step.type === "match-write-word" && (
        <>
          <div className="lp-step-char-row">
            <label className="lp-step-char-label">English word</label>
            <input
              className="lp-step-char-input"
              style={{ width: 140, fontSize: 18 }}
              value={step.word || ""}
              onChange={e => onChange({ ...step, word: e.target.value })}
              placeholder="cat"
            />
            <label className="lp-step-char-label" style={{ marginLeft: 12 }}>Speak as (optional)</label>
            <input
              className="lp-step-char-input"
              style={{ width: 140, fontSize: 14 }}
              value={step.speakText || ""}
              onChange={e => onChange({ ...step, speakText: e.target.value })}
              placeholder="cat"
            />
          </div>
          <div className="lp-tip-editor" style={{ marginTop: 6 }}>
            {step.imageUrl ? (
              <div className="lp-tip-img-preview">
                <img src={step.imageUrl} alt="reference" className="lp-tip-thumb" />
                <button type="button" className="lp-tip-img-remove" onClick={() => onChange({ ...step, imageUrl: "" })} aria-label="Remove image">×</button>
              </div>
            ) : (
              <label className="btn-secondary lp-tip-upload-btn">
                Upload reference image
                <input type="file" accept="image/*" style={{ display: "none" }} onChange={async e => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  try { onChange({ ...step, imageUrl: await storageUpload(file, "lesson-assets", "match-write-word/") }); }
                  catch (err) { alert("Upload failed: " + err.message); }
                }} />
              </label>
            )}
          </div>
        </>
      )}

      {/* #844 — Add to Word Bank: any step that references a word by ID */}
      {step.wordId && (
        <label className="lp-step-vocab-toggle">
          <input
            type="checkbox"
            checked={!!step.addToVocab}
            onChange={e => onChange({ ...step, addToVocab: e.target.checked })}
          />
          Add to Word Bank
        </label>
      )}
    </div>
  );
}

export function ManageLessonsModal({ classCodes = [], words = [], onClose, asTab = false, onSaveVocabWord }) {
  const [localCodes,    setLocalCodes]    = useState(classCodes);
  const [selectedCode,  setSelectedCode]  = useState(classCodes[0]?.code || "");
  const [lessons,       setLessons]       = useState([]);
  const [loading,       setLoading]       = useState(false);
  const [editingId,     setEditingId]     = useState(null); // null = creating new
  const [form,          setForm]          = useState(EMPTY_LESSON_FORM);
  const [error,         setError]         = useState("");
  const [busy,          setBusy]          = useState(false);
  const [addingCode,    setAddingCode]    = useState(false);
  const [newCodeVal,    setNewCodeVal]    = useState("");
  const [codeToast,     setCodeToast]     = useState(null); // Issue #525
  const [sectionMeta,   setSectionMetaState] = useState({}); // #707 — { [secIdx]: { name, font } }
  const [codeMetas,     setCodeMetas]     = useState({}); // #793 — { [code]: { cefrLevel } }
  const [newCodeCefr,   setNewCodeCefr]   = useState(""); // cefrLevel for "+ New code" flow
  const [editingCefr,   setEditingCefr]   = useState(false); // inline edit mode for active code

  // Issue #426 — classCodes may arrive after mount (async fetch in App.jsx).
  // When the prop updates from [] to a real list, set the first code automatically.
  useEffect(() => {
    setLocalCodes(classCodes);
    if (classCodes.length > 0 && !selectedCode) {
      setSelectedCode(classCodes[0].code);
    }
  }, [classCodes, selectedCode]);

  async function handleAddCode() {
    const code = newCodeVal.trim().toUpperCase();
    if (!code) return;
    if (!/^S\d+C\d+$/.test(code)) {
      alert("Class code must follow the pattern S<n>C<n> — ex: S0C1, S1C2.");
      return;
    }
    const cefrLevel = isPreA1Prefix(code) ? "Pre-A1" : newCodeCefr;
    if (!cefrLevel) {
      alert("Select a CEFR Level for this class code.");
      return;
    }
    if (localCodes.some(c => c.code === code)) {
      setSelectedCode(code);
      setAddingCode(false);
      setNewCodeVal("");
      setNewCodeCefr("");
      return;
    }
    await storageSet(`${LESSON_INDEX_PREFIX}${code}`, [], true);
    await setCodeMeta(code, { cefrLevel });
    const next = [...localCodes, { code }].sort((a, b) => a.code.localeCompare(b.code));
    setLocalCodes(next);
    setCodeMetas(m => ({ ...m, [code]: { cefrLevel } }));
    setSelectedCode(code);
    setAddingCode(false);
    setNewCodeVal("");
    setNewCodeCefr("");
    setCodeToast(`Class code ${code} (${cefrLevel}) created.`);
    setTimeout(() => setCodeToast(null), 3000);
  }

  const reload = useCallback(async (code) => {
    if (!code) return;
    setLoading(true);
    try { setLessons(await listLessonsByClassCode(code)); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { reload(selectedCode); }, [selectedCode, reload]);
  useEffect(() => {
    getSectionMeta(selectedCode).then(setSectionMetaState);
  }, [selectedCode]);
  useEffect(() => {
    if (localCodes.length === 0) return;
    Promise.all(localCodes.map(c => getCodeMeta(c.code).then(m => [c.code, m]))).then(entries => {
      setCodeMetas(Object.fromEntries(entries));
    });
  }, [localCodes]);

  // Keep form.classCode in sync when selectedCode changes (e.g. after "+ New code")
  useEffect(() => {
    if (selectedCode) setForm(f => ({ ...f, classCode: selectedCode }));
  }, [selectedCode]);

  function startCreate() {
    setEditingId(null);
    setForm({ ...EMPTY_LESSON_FORM, classCode: selectedCode });
    setError("");
  }

  function startEdit(lesson) {
    setEditingId(lesson.id);
    setForm({
      title:          lesson.title,
      classCode:      lesson.classCode,
      sectionIndex:   lesson.sectionIndex,
      orderInSection: lesson.orderInSection,
      steps:          lesson.steps ? [...lesson.steps] : [],
      rewardCoins:    lesson.rewardCoins  ?? 0,
      rewardTicket:   lesson.rewardTicket ?? "",
    });
    setError("");
  }

  function addStep(type) {
    const newStep =
      type === "vocab"       ? { type: "vocab",       wordId: null }
      : type === "calligraphy" ? { type: "calligraphy", char: "" }
      : type === "listening"   ? { type: "listening",   char: "", distractors: [] }
      : type === "image-match"   ? { type: "image-match",   char: "", imageUrl: "", distractors: [] }
      : type === "listen-write"  ? { type: "listen-write",  char: "", speakText: "" }
      : type === "memory-check"  ? { type: "memory-check",  char: "", imageUrl: "", speakText: "" }
      : type === "write-word"         ? { type: "write-word",         word: "", speakText: "" }
      : type === "listen-write-word"  ? { type: "listen-write-word",  word: "", speakText: "" }
      : type === "match-write-word"   ? { type: "match-write-word",   word: "", imageUrl: "", speakText: "" }
      : { type: "tip", text: "" };
    setForm(f => ({ ...f, steps: [...f.steps, newStep] }));
  }

  function updateStep(index, updated) {
    setForm(f => ({ ...f, steps: f.steps.map((s, i) => i === index ? updated : s) }));
  }

  function removeStep(index) {
    setForm(f => ({ ...f, steps: f.steps.filter((_, i) => i !== index) }));
  }

  function moveStep(index, dir) {
    setForm(f => {
      const steps = [...f.steps];
      const target = index + dir;
      if (target < 0 || target >= steps.length) return f;
      [steps[index], steps[target]] = [steps[target], steps[index]];
      return { ...f, steps };
    });
  }

  function validate() {
    if (!form.title.trim()) return "Lesson title is required.";
    if (!form.classCode.trim()) return "Class code is required.";
    if (form.steps.length === 0) return "At least one step is required.";
    for (const s of form.steps) {
      if (s.type === "vocab"       && !s.wordId)      return "All vocab steps need a word selected.";
      if (s.type === "tip"         && !s.text?.trim() && !s.imageUrl) return "All tip steps need text or an image.";
      if (s.type === "calligraphy" && !s.char)        return "Calligraphy steps need an English character.";
      if (s.type === "listening"   && !s.char)        return "Listening steps need an English character.";
      if (s.type === "image-match"  && !s.char)        return "Image-match steps need an English character.";
      if (s.type === "image-match"  && !s.imageUrl)   return "Image-match steps need a reference image.";
      if (s.type === "listen-write"  && !s.char)      return "Listen & Write steps need an English character.";
      if (s.type === "listen-write"  && !s.speakText) return "Listen & Write steps need a Speak as text.";
      if (s.type === "memory-check"  && !s.char)      return "Memory Check steps need an English character.";
      if (s.type === "memory-check"  && !s.imageUrl)  return "Memory Check steps need a reference image.";
      if (s.type === "write-word"        && !s.word?.trim())     return "Write Word steps need an English word.";
      if (s.type === "listen-write-word" && !s.word?.trim())      return "Listen & Write Word steps need an English word.";
      if (s.type === "listen-write-word" && !s.speakText?.trim()) return "Listen & Write Word steps need a Speak as text.";
      if (s.type === "match-write-word"  && !s.word?.trim())      return "Match & Write Word steps need an English word.";
      if (s.type === "match-write-word"  && !s.imageUrl)          return "Match & Write Word steps need a reference image.";
    }
    // Warn if deleting would orphan a section's rewards
    if (editingId === null) return null; // creating, no orphan risk
    return null;
  }

  async function handleSave() {
    const err = validate();
    if (err) { setError(err); return; }
    setBusy(true);
    setError("");
    try {
      const payload = {
        ...(editingId ? { id: editingId } : {}),
        title:          form.title.trim(),
        classCode:      form.classCode.trim(),
        sectionIndex:   Number(form.sectionIndex),
        orderInSection: Number(form.orderInSection),
        steps:          form.steps,
        rewardCoins:    Number(form.rewardCoins) || 0,
        rewardTicket:   form.rewardTicket || "",
      };
      const saved = await saveLessonDef(payload);
      // #844 — sync addToVocab steps to the Word Bank with the lesson's node index
      if (saved && onSaveVocabWord) {
        const vocabSteps = (saved.steps || []).filter(s => s.addToVocab && s.wordId);
        if (vocabSteps.length > 0) {
          const allCodes = classCodes.map(c => c.code);
          const allLessons = await listAllLessonsOrdered(allCodes);
          const nodeIndex = allLessons.findIndex(l => l.id === saved.id);
          if (nodeIndex >= 0) {
            await Promise.all(vocabSteps.map(s => onSaveVocabWord(s.wordId, nodeIndex)));
          }
        }
      }
      await reload(selectedCode);
      startCreate();
    } catch (e) {
      setError(e.message || "Save failed.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(lesson) {
    if (!window.confirm(`Delete "${lesson.title}"? This cannot be undone.`)) return;
    setBusy(true);
    try {
      await deleteLessonDef(lesson.id, lesson.classCode);
      await reload(selectedCode);
      if (editingId === lesson.id) startCreate();
    } finally {
      setBusy(false);
    }
  }

  // #704 — teacher lock/unlock toggle
  async function handleToggleLock(lesson, e) {
    e.stopPropagation();
    await saveLessonDef({ ...lesson, locked: !lesson.locked });
    await reload(selectedCode);
  }

  // Group lessons by section for display
  const sections = [];
  lessons.forEach(l => {
    if (!sections[l.sectionIndex]) sections[l.sectionIndex] = [];
    sections[l.sectionIndex].push(l);
  });

  // Issue #521 — shared body used by both tab and modal modes
  const manageLessonsBody = (
    <div className="lp-manage-body">
          {/* Left: lesson list */}
          <div className="lp-manage-list">
            <div className="lp-manage-code-row">
              <select
                className="lp-code-select"
                value={selectedCode}
                onChange={e => { setSelectedCode(e.target.value); startCreate(); }}
              >
                {localCodes.map(c => <option key={c.code} value={c.code}>{c.code}</option>)}
                {localCodes.length === 0 && <option value="">No class codes</option>}
              </select>
              <button className="btn-secondary lp-new-btn" onClick={startCreate}>
                <Plus size={13} /> New lesson
              </button>
            </div>
            {/* Issue #525 — toast de confirmação de novo code */}
            {codeToast && <div className="lp-code-toast">{codeToast}</div>}
            {/* #793 — CEFR Level badge + inline edit for active code */}
            {selectedCode && (() => {
              const lvl = resolveCodeLevel(selectedCode, codeMetas);
              return (
                <div className="lp-code-cefr-row">
                  {editingCefr ? (
                    <>
                      <select
                        className="lp-newcode-cefr-select"
                        value={codeMetas[selectedCode]?.cefrLevel || ""}
                        disabled={isPreA1Prefix(selectedCode)}
                        onChange={async e => {
                          const cefrLevel = e.target.value;
                          await setCodeMeta(selectedCode, { cefrLevel });
                          setCodeMetas(m => ({ ...m, [selectedCode]: { cefrLevel } }));
                          setEditingCefr(false);
                        }}
                      >
                        <option value="" disabled>Select CEFR Level…</option>
                        {CEFR_LEVELS_ORDERED.map(l => <option key={l} value={l}>{l}</option>)}
                      </select>
                      <button className="btn-secondary lp-newcode-cancel" onClick={() => setEditingCefr(false)}>✕</button>
                    </>
                  ) : (
                    <>
                      <span className="lp-code-cefr-badge" style={{ opacity: lvl ? 1 : 0.45 }}>
                        {lvl || "No CEFR Level"}
                      </span>
                      {!isPreA1Prefix(selectedCode) && (
                        <button className="btn-secondary lp-code-cefr-edit" onClick={() => setEditingCefr(true)}>
                          Edit
                        </button>
                      )}
                    </>
                  )}
                </div>
              );
            })()}
            {/* issue #428 — "+ New code" inline input */}
            {addingCode ? (
              <div className="lp-newcode-row" style={{ flexDirection: "column", alignItems: "stretch", gap: 6 }}>
                <div style={{ display: "flex", gap: 6 }}>
                  <input
                    className="lp-newcode-input"
                    placeholder="e.g. S2C1"
                    value={newCodeVal}
                    onChange={e => {
                      setNewCodeVal(e.target.value);
                      if (isPreA1Prefix(e.target.value.trim().toUpperCase())) setNewCodeCefr("Pre-A1");
                    }}
                    onKeyDown={e => { if (e.key === "Enter") handleAddCode(); if (e.key === "Escape") { setAddingCode(false); setNewCodeVal(""); setNewCodeCefr(""); } }}
                    autoFocus
                  />
                  <button className="btn-primary lp-newcode-confirm" onClick={handleAddCode}>Add</button>
                  <button className="btn-secondary lp-newcode-cancel" onClick={() => { setAddingCode(false); setNewCodeVal(""); setNewCodeCefr(""); }}>✕</button>
                </div>
                <select
                  className="lp-newcode-cefr-select"
                  value={newCodeCefr}
                  disabled={isPreA1Prefix(newCodeVal.trim().toUpperCase())}
                  onChange={e => setNewCodeCefr(e.target.value)}
                >
                  <option value="" disabled>CEFR Level (required)…</option>
                  {CEFR_LEVELS_ORDERED.map(l => <option key={l} value={l}>{l}</option>)}
                </select>
              </div>
            ) : (
              <button className="btn-secondary lp-add-code-btn" onClick={() => setAddingCode(true)}>
                <Plus size={12} /> New code
              </button>
            )}

            {loading && <div className="release-modal-hint">Loading…</div>}
            {!loading && lessons.length === 0 && (
              <div className="release-modal-hint">No lessons yet for {selectedCode}.</div>
            )}

            {sections.map((group, secIdx) => group && (
              <div key={secIdx} className="lp-section-group">
                <div className="lp-section-label">Section {secIdx}</div>
                <div className="lp-section-meta-editor">
                  <input
                    className="lp-section-name-input"
                    placeholder="Section name (optional)…"
                    value={sectionMeta[secIdx]?.name || ""}
                    style={{ fontFamily: sectionMeta[secIdx]?.font || FONT_THAI }}
                    onChange={e => {
                      const updated = { ...sectionMeta, [secIdx]: { ...sectionMeta[secIdx], name: e.target.value } };
                      setSectionMetaState(updated);
                      setSectionMeta(selectedCode, updated).catch(() => {});
                    }}
                  />
                  <select
                    className="lp-section-font-select"
                    value={sectionMeta[secIdx]?.font || FONT_THAI}
                    onChange={e => {
                      const updated = { ...sectionMeta, [secIdx]: { ...sectionMeta[secIdx], font: e.target.value } };
                      setSectionMetaState(updated);
                      setSectionMeta(selectedCode, updated).catch(() => {});
                    }}
                  >
                    {SECTION_NAME_FONTS.map(f => (
                      <option key={f.value} value={f.value}>{f.label}</option>
                    ))}
                  </select>
                </div>
                {group.map(l => (
                  <div
                    key={l.id}
                    className={"lp-lesson-row" + (editingId === l.id ? " active" : "") + (l.locked ? " lp-lesson-row-locked" : "")}
                    onClick={() => startEdit(l)}
                  >
                    <span className="lp-lesson-title">{l.title}</span>
                    <span className="lp-lesson-meta">{l.steps.length} step{l.steps.length !== 1 ? "s" : ""}</span>
                    <button
                      className={"lp-lock-btn" + (l.locked ? " lp-lock-btn-on" : "")}
                      onClick={(e) => handleToggleLock(l, e)}
                      title={l.locked ? "Unlock lesson for students" : "Lock lesson for students"}
                      aria-label={l.locked ? "Unlock" : "Lock"}
                    >{l.locked ? "🔒" : "🔓"}</button>
                  </div>
                ))}
              </div>
            ))}
          </div>

          {/* Right: form — header fixed, steps scroll independently (#523) */}
          <div className="lp-manage-form">
            <div className="lp-form-sticky-header">
              <div className="lp-form-title">{editingId ? "Edit lesson" : "New lesson"}</div>

              <div className="level-settings-field">
                <span className="level-settings-field-label">Title</span>
                <input
                  className="lp-input"
                  placeholder="e.g. Animals – Basic"
                  value={form.title}
                  onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                />
              </div>

              <div className="lp-form-row">
                <div className="level-settings-field" style={{ flex: 1 }}>
                  <span className="level-settings-field-label">Section</span>
                  <input
                    className="lp-input"
                    type="number" min={0}
                    value={form.sectionIndex}
                    onChange={e => setForm(f => ({ ...f, sectionIndex: e.target.value }))}
                  />
                </div>
                <div className="level-settings-field" style={{ flex: 1 }}>
                  <span className="level-settings-field-label">Order in section</span>
                  <input
                    className="lp-input"
                    type="number" min={0}
                    value={form.orderInSection}
                    onChange={e => setForm(f => ({ ...f, orderInSection: e.target.value }))}
                  />
                </div>
              </div>

              <div className="lp-steps-header">
                <span className="level-settings-field-label">Steps ({form.steps.length})</span>
                <div style={{ display: "flex", gap: 6 }}>
                  <button className="btn-secondary lp-add-step-btn" onClick={() => addStep("vocab")}>
                    <BookOpen size={12} /> Vocab
                  </button>
                  <button className="btn-secondary lp-add-step-btn" onClick={() => addStep("tip")}>
                    <Lightbulb size={12} /> Tip
                  </button>
                  <button className="btn-secondary lp-add-step-btn" onClick={() => addStep("calligraphy")}>
                    ✍️ Calligraphy
                  </button>
                  <button className="btn-secondary lp-add-step-btn" onClick={() => addStep("listening")}>
                    👂 Listening
                  </button>
                  <button className="btn-secondary lp-add-step-btn" onClick={() => addStep("image-match")}>
                    🖼️ Image-match
                  </button>
                  <button className="btn-secondary lp-add-step-btn" onClick={() => addStep("listen-write")}>
                    👂✍️ Listen &amp; Write
                  </button>
                  <button className="btn-secondary lp-add-step-btn" onClick={() => addStep("memory-check")}>
                    🖼️✍️ Memory Check
                  </button>
                  <button className="btn-secondary lp-add-step-btn" onClick={() => addStep("write-word")}>
                    ✍️📝 Write Word
                  </button>
                  <button className="btn-secondary lp-add-step-btn" onClick={() => addStep("listen-write-word")}>
                    👂✍️📝 Listen &amp; Write Word
                  </button>
                  <button className="btn-secondary lp-add-step-btn" onClick={() => addStep("match-write-word")}>
                    🖼️✍️📝 Match &amp; Write Word
                  </button>
                </div>
              </div>
            </div>

            {/* Steps scroll independently from the header above */}
            <div className="lp-form-steps-scroll">
              {form.steps.length === 0 && (
                <div className="release-modal-hint">Add at least one step above.</div>
              )}

              {form.steps.map((step, i) => (
                <StepCard
                  key={i}
                  step={step}
                  index={i}
                  total={form.steps.length}
                  words={words}
                  onChange={updated => updateStep(i, updated)}
                  onRemove={() => removeStep(i)}
                  onMoveUp={() => moveStep(i, -1)}
                  onMoveDown={() => moveStep(i, +1)}
                />
              ))}

              <div className="lp-rewards-section">
                <span className="level-settings-field-label">Extra Rewards</span>
                <div className="lp-form-row">
                  <div className="level-settings-field" style={{ flex: 1 }}>
                    <span className="level-settings-field-label">Meowtongs</span>
                    <input
                      className="lp-input"
                      type="number" min={0}
                      value={form.rewardCoins}
                      onChange={e => setForm(f => ({ ...f, rewardCoins: e.target.value }))}
                    />
                  </div>
                  <div className="level-settings-field" style={{ flex: 1 }}>
                    <span className="level-settings-field-label">Ticket</span>
                    <select
                      className="lp-input"
                      value={form.rewardTicket}
                      onChange={e => setForm(f => ({ ...f, rewardTicket: e.target.value }))}
                    >
                      <option value="">None</option>
                      <option value="rare">Rare</option>
                      <option value="epic">Epic</option>
                      <option value="solstice">Solstice</option>
                    </select>
                  </div>
                </div>
              </div>

              {error && <div className="release-modal-hint" style={{ color: "var(--danger, #c0392b)" }}>{error}</div>}

              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <button className="btn-primary level-settings-save" onClick={handleSave} disabled={busy}>
                  {editingId ? "Save changes" : "Create lesson"}
                </button>
                {editingId && (
                  <>
                    <button className="btn-secondary" onClick={startCreate} disabled={busy}>Cancel</button>
                    <button className="btn-secondary" style={{ marginLeft: "auto", color: "var(--danger,#c0392b)" }}
                      onClick={() => handleDelete({ id: editingId, title: form.title, classCode: form.classCode })}
                      disabled={busy}
                    >
                      Delete
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
  );

  if (asTab) {
    return <div className="lp-manage-tab-screen">{manageLessonsBody}</div>;
  }

  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card lp-manage-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Manage Lessons</h2>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>
        {manageLessonsBody}
      </div>
    </div>,
    document.body
  );
}

// ---------------------------------------------------------------------------
// LP3 helper — interactive step sub-components
// ---------------------------------------------------------------------------

const ALL_CONSONANTS = Object.keys(ENGLISH_STROKES); // distractor pool for choice steps

function pickDistractors(correct, fixed) {
  if (fixed?.length === 3) return fixed;
  const pool = ALL_CONSONANTS.filter(c => c !== correct);
  const out = [];
  while (out.length < 3 && pool.length) {
    const i = Math.floor(Math.random() * pool.length);
    out.push(pool.splice(i, 1)[0]);
  }
  return out;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function playCorrectSfx() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1320, ctx.currentTime + 0.12);
    gain.gain.setValueAtTime(0.28, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.45);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.45);
  } catch (_) {}
}

function playVictorySfx() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const notes = [523, 659, 784, 1047]; // C5 E5 G5 C6
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "sine";
      const t = ctx.currentTime + i * 0.13;
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.3, t + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
      osc.start(t);
      osc.stop(t + 0.5);
    });
  } catch (_) {}
}

function CalligraphyStep({ step, onDone, speakEnglish }) {
  const [phase, setPhase] = useState("watch");
  const [done, setDone] = useState(false);
  if (!step.char) return <div className="lp-tip-text">No character set for this step.</div>;
  return (
    <div className="lp-calli-step">
      <div className="lp-calli-phase-label">{phase === "watch" ? "Watch the stroke order" : "Now trace it"}</div>
      {step.speakText && (
        <button className="tts-btn lp-listen-round" onClick={() => speakEnglish?.(step.speakText)} aria-label="Listen again">
          <Volume2 size={28} />
        </button>
      )}
      {phase === "watch" ? (
        <StrokeAnimation key={step.char} char={step.char} size={200} onComplete={() => setPhase("trace")} />
      ) : done ? (
        <div className="lp-calli-done">
          <div className="lp-calli-great">Well done!</div>
          <div className="lp-calli-great-sub">เก่งมาก</div>
          <div className="lp-calli-great-en">Great job!</div>
        </div>
      ) : (
        <TracingCanvas key={step.char} char={step.char} size={220} onComplete={() => { setDone(true); playCorrectSfx(); onDone?.(); }} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SPEC — Minimal Pairs fill-in-the-gap (future redesign of listen-write &
// memory-check for English phonics / literacy)
//
// Both step types will share the same mechanic:
//
//   step.display  — word shown with the gap, e.g. "sh_p"
//   step.word     — full word spoken via TTS, e.g. "ship" or "sheep"
//   step.expected — letters the canvas waits for (1 or more), e.g. "i" or "ee"
//   step.speakText — optional override for TTS text (defaults to step.word)
//
// Flow:
//   1. Show step.display + play TTS(step.word) automatically.
//   2. Student writes step.expected on the canvas (one letter or sequence).
//   3. Stroke scorer validates against ALL_STROKE_DATA[step.expected]:
//      ✅ correct → award point, show "Well Done!" / "เก่งมาก", auto-advance.
//      ⛔ wrong   → grant one retry (canvas clears, TTS replays).
//   4. On second failure:
//      ⛔ wrong again → credit as error (no point), show "ไม่เป็นไร" in
//         var(--color-orange, #F39C12) instead of green, auto-advance.
//
// listen-write  (👂✍️) — shows display + audio only, no image reference.
// memory-check  (🖼️✍️) — shows step.imageUrl as a visual hint alongside display.
//
// Implementation notes:
//   - Canvas must support multi-character expected values (loop scorer over
//     each glyph in step.expected sequentially, or treat the sequence as a
//     single $1 Unistroke template if glyphs are ligated).
//   - Uppercase / lowercase must both be valid templates for English letters
//     (store both in ALL_STROKE_DATA once englishStrokes.js is created).
//   - "ไม่เป็นไร" copy lives in FEEDBACK_WRONG constant below so it's easy
//     to update if tone/translation changes.
// ---------------------------------------------------------------------------

function ListenWriteStep({ step, speakEnglish, onDone }) {
  const [done, setDone] = useState(false);
  const [correct, setCorrect] = useState(false);
  if (!step.char) return null;
  function handleComplete(score) {
    const passed = score > 0;
    setCorrect(passed);
    setDone(true);
    onDone?.(passed);
  }
  return (
    <div className="lp-calli-step">
      {step.speakText && !done && (
        <button className="tts-btn lp-listen-round" onClick={() => speakEnglish?.(step.speakText)} aria-label="Listen again">
          <Volume2 size={28} />
        </button>
      )}
      {done ? (
        <div className="lp-calli-done">
          {correct
            ? <><div className="lp-calli-great">Well done!</div><div className="lp-calli-great-sub">เก่งมาก</div><div className="lp-calli-great-en">Great job!</div></>
            : <><div className="lp-calli-great">Keep going!</div><div className="lp-calli-great-en">You'll get it next time 💪</div></>
          }
        </div>
      ) : (
        <TracingCanvas char={step.char} size={220} hideGuide onComplete={handleComplete} />
      )}
    </div>
  );
}

function MemoryCheckStep({ step, speakEnglish, onDone }) {
  const [done, setDone] = useState(false);
  const [correct, setCorrect] = useState(false);
  if (!step.char) return null;
  function handleComplete(score) {
    const passed = score > 0;
    setCorrect(passed);
    setDone(true);
    onDone?.(passed);
  }
  return (
    <div className="lp-calli-step">
      {!done && step.imageUrl && <img src={step.imageUrl} alt="prompt" className="lp-mc-image" />}
      {step.speakText && !done && (
        <button className="tts-btn lp-listen-round" onClick={() => speakEnglish?.(step.speakText)} aria-label="Listen again">
          <Volume2 size={28} />
        </button>
      )}
      {done ? (
        <div className="lp-calli-done">
          {correct
            ? <><div className="lp-calli-great">Well done!</div><div className="lp-calli-great-sub">เก่งมาก</div><div className="lp-calli-great-en">Great job!</div></>
            : <><div className="lp-calli-great">Keep going!</div><div className="lp-calli-great-en">You'll get it next time 💪</div></>
          }
        </div>
      ) : (
        <TracingCanvas char={step.char} size={220} hideGuide onComplete={handleComplete} />
      )}
    </div>
  );
}

function WriteWordStep({ step, speakEnglish, onDone }) {
  const [done, setDone] = useState(false);
  if (!step.word?.trim()) return <div className="lp-tip-text">No word set for this step.</div>;
  return (
    <div className="lp-calli-step">
      <div className="lp-calli-phase-label">Write the word</div>
      {step.speakText && (
        <button className="tts-btn lp-listen-round" onClick={() => speakEnglish?.(step.speakText)} aria-label="Listen again">
          <Volume2 size={28} />
        </button>
      )}
      {done ? (
        <div className="lp-calli-done">
          <div className="lp-calli-great">Well done!</div>
          <div className="lp-calli-great-sub">เก่งมาก</div>
          <div className="lp-calli-great-en">Great job!</div>
        </div>
      ) : (
        <WordWritingCanvas
          word={step.word}
          onComplete={() => { setDone(true); playCorrectSfx(); onDone?.(); }}
        />
      )}
    </div>
  );
}

// Listen & Write Word: o aluno ouve o TTS e depois escreve a palavra sem vê-la.
// A palavra só é revelada como confirmação após concluir todos os traços.
function ListenWriteWordStep({ step, speakEnglish, onDone }) {
  const [done, setDone] = useState(false);
  if (!step.word?.trim()) return <div className="lp-tip-text">No word set for this step.</div>;
  return (
    <div className="lp-calli-step">
      <div className="lp-calli-phase-label">Listen and write the word</div>
      {step.speakText && (
        <button className="tts-btn lp-listen-round" onClick={() => speakEnglish?.(step.speakText)} aria-label="Listen again">
          <Volume2 size={28} />
        </button>
      )}
      {done ? (
        <div className="lp-calli-done">
          <div className="lp-calli-great-thai" style={{ fontSize: 36 }}>{step.word}</div>
          <div className="lp-calli-great">Well done!</div>
          <div className="lp-calli-great-sub">เก่งมาก</div>
        </div>
      ) : (
        <WordWritingCanvas
          word={step.word}
          onComplete={() => { setDone(true); playCorrectSfx(); onDone?.(); }}
        />
      )}
    </div>
  );
}

// Match & Write Word: mostra imagem de referência e o aluno escreve a palavra.
// A imagem fica visível durante a escrita; a palavra é revelada ao concluir.
function MatchWriteWordStep({ step, speakEnglish, onDone }) {
  const [done, setDone] = useState(false);
  if (!step.word?.trim()) return <div className="lp-tip-text">No word set for this step.</div>;
  return (
    <div className="lp-calli-step">
      <div className="lp-calli-phase-label">Match the image — write the word</div>
      {step.speakText && (
        <button className="tts-btn lp-listen-round" onClick={() => speakEnglish?.(step.speakText)} aria-label="Listen again">
          <Volume2 size={28} />
        </button>
      )}
      {step.imageUrl && !done && (
        <img
          src={step.imageUrl}
          alt="reference"
          style={{ maxHeight: 140, maxWidth: "100%", objectFit: "contain",
                   borderRadius: 8, marginBottom: 8, border: "1px solid #e2e8f0" }}
        />
      )}
      {done ? (
        <div className="lp-calli-done">
          <div className="lp-calli-great-thai" style={{ fontSize: 36 }}>{step.word}</div>
          <div className="lp-calli-great">Well done!</div>
          <div className="lp-calli-great-sub">เก่งมาก</div>
        </div>
      ) : (
        <WordWritingCanvas
          word={step.word}
          onComplete={() => { setDone(true); playCorrectSfx(); onDone?.(); }}
        />
      )}
    </div>
  );
}

function ChoiceStep({ correct, distractors, speakEnglish, speakText, imageUrl, removeWrongOption = false, catName = null, onDone, onAutoNext }) {
  const [{ options, wrongRemoved }] = useState(() => {
    const all = shuffle([correct, ...pickDistractors(correct, distractors?.length ? distractors : null)]);
    if (!removeWrongOption || all.length <= 2) return { options: all, wrongRemoved: false };
    const wrongIndices = all.map((c, i) => c !== correct ? i : -1).filter(i => i >= 0);
    if (!wrongIndices.length) return { options: all, wrongRemoved: false };
    const removeAt = wrongIndices[Math.floor(Math.random() * wrongIndices.length)];
    return { options: all.filter((_, i) => i !== removeAt), wrongRemoved: true };
  });
  const [selected, setSelected] = useState(null);
  const [countdown, setCountdown] = useState(null);

  // Auto-play is handled by LessonPlayerModal for listening steps; skip here to avoid double-fire

  // Countdown after wrong answer
  useEffect(() => {
    if (countdown === null) return;
    if (countdown === 0) { onAutoNext?.(); return; }
    const t = setTimeout(() => setCountdown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown, onAutoNext]);

  function handlePick(ch) {
    if (selected) return;
    setSelected(ch);
    if (ch === correct) {
      playCorrectSfx();
      onDone?.();
      setTimeout(() => onAutoNext?.(), 700);
    } else {
      setCountdown(5);
    }
  }

  return (
    <div className="lp-choice-step">
      {wrongRemoved && catName && (
        <div className="lp-cat-flag">🐱 {catName} skill — Removed one wrong answer</div>
      )}
      {speakEnglish ? (
        <button className="tts-btn lp-listen-round" onClick={() => speakEnglish(speakText || correct)} aria-label="Play sound">
          <Volume2 size={28} />
        </button>
      ) : imageUrl ? (
        <img src={imageUrl} alt="reference" className="lp-choice-img" />
      ) : null}
      <div className="lp-choice-grid">
        {options.map(ch => {
          const isCorrect = ch === correct;
          const isPicked = ch === selected;
          const cls = "lp-choice-btn"
            + (isPicked && isCorrect  ? " lp-choice-correct" : "")
            + (isPicked && !isCorrect ? " lp-choice-wrong"   : "")
            + (selected && !isPicked && isCorrect ? " lp-choice-reveal" : "");
          return (
            <button key={ch} className={cls} onClick={() => handlePick(ch)}
              style={{ fontFamily: FONT_THAI }}>
              {ch}
            </button>
          );
        })}
      </div>
      {selected && (
        <div className={selected === correct ? "lp-choice-feedback correct" : "lp-choice-feedback wrong"}>
          {selected === correct ? "Correct! ✓" : (
            <span>The answer is {correct}{countdown !== null ? <span className="lp-choice-countdown"> ({countdown})</span> : null}</span>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// LP3 — LessonPlayerModal
//
// Props:
//   lesson     — lesson definition object (from getLessonDef / listLessonsByClassCode)
//   words      — full word bank array (to resolve wordIds → word objects)
//   speakEnglish  — async function(thaiText) — passed from App.jsx (not exported)
//   onComplete — async function() — called after "Practice now!" to trigger LP6
//   onPracticeNow(wordIds) — tells App.jsx to launch Practice Mode with these words
//   onClose    — close without completing
// ---------------------------------------------------------------------------

export function LessonPlayerModal({ lesson, words, speakEnglish, onComplete, onPracticeNow, onClose, removeWrongOption = false, profile = null, avatarCatalog = [], coinsToAward = 0, energy = null, energyMax = S0_ENERGY_MAX, energyCostPer5 = 2, energyCostEvery = 5, onEnergySpend = null }) {
  const steps   = lesson?.steps || [];
  const [index, setIndex]       = useState(0);
  const [ttsPlayed, setTtsPlayed] = useState(false);
  const ttsScheduledRef = useRef(false); // prevents double-fire during React async state gap
  const [animDir, setAnimDir]   = useState("next"); // "next" | "prev" — for slide animation
  const [visible, setVisible]   = useState(true);   // false while transitioning
  const [completing, setCompleting] = useState(false);
  const [showCompletion, setShowCompletion] = useState(false);
  const [correctCounts, setCorrectCounts] = useState({ listening: 0, calligraphy: 0, match: 0, listenWrite: 0, memoryCheck: 0, writeWord: 0, listenWriteWord: 0, matchWriteWord: 0 });
  // #563 — live energy display, decremented at each 5-step threshold
  const [energyDisplay, setEnergyDisplay] = useState(energy);

  const listeningTotal    = React.useMemo(() => steps.filter(s => s.type === "listening").length,    [steps]);
  const calligraphyTotal  = React.useMemo(() => steps.filter(s => s.type === "calligraphy").length,  [steps]);
  const matchTotal        = React.useMemo(() => steps.filter(s => s.type === "image-match").length,  [steps]);
  const listenWriteTotal  = React.useMemo(() => steps.filter(s => s.type === "listen-write").length,  [steps]);
  const memoryCheckTotal  = React.useMemo(() => steps.filter(s => s.type === "memory-check").length,  [steps]);
  const writeWordTotal         = React.useMemo(() => steps.filter(s => s.type === "write-word").length,         [steps]);
  const listenWriteWordTotal   = React.useMemo(() => steps.filter(s => s.type === "listen-write-word").length,  [steps]);
  const matchWriteWordTotal    = React.useMemo(() => steps.filter(s => s.type === "match-write-word").length,   [steps]);

  const step    = steps[index];
  const isLast  = index === steps.length - 1;
  const wordMap = React.useMemo(() => Object.fromEntries(words.map(w => [w.id, w])), [words]);
  const word    = step?.type === "vocab" ? wordMap[step.wordId] : null;
  const isChoiceStep = step?.type === "listening" || step?.type === "image-match";
  const isAutoStep   = isChoiceStep || step?.type === "calligraphy" || step?.type === "listen-write" || step?.type === "memory-check" || step?.type === "write-word" || step?.type === "listen-write-word" || step?.type === "match-write-word";
  const [choiceDone, setChoiceDone] = useState(false);

  // Auto-advance calligraphy/write-word/listen-write-word/match-write-word steps after completion (1200ms to show "Well done!")
  useEffect(() => {
    if ((step?.type === "calligraphy" || step?.type === "write-word" || step?.type === "listen-write-word" || step?.type === "match-write-word") && choiceDone) {
      const t = setTimeout(() => {
        if (isLast) handleComplete(); else navigate("next");
      }, 1200);
      return () => clearTimeout(t);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [choiceDone, step?.type]);

  // Auto-play TTS on vocab, tip, and listening steps
  useEffect(() => {
    if (ttsScheduledRef.current || ttsPlayed) return;
    const text =
      (step?.type === "vocab" && word?.english) ? word.english :
      ((step?.type === "tip" || step?.type === "listening" || step?.type === "image-match" || step?.type === "calligraphy" || step?.type === "listen-write" || step?.type === "memory-check" || step?.type === "write-word" || step?.type === "listen-write-word" || step?.type === "match-write-word") && step?.speakText) ? step.speakText :
      null;
    if (!text) return;
    ttsScheduledRef.current = true;
    const t = setTimeout(() => { speakEnglish?.(text); setTtsPlayed(true); }, 400);
    return () => { clearTimeout(t); ttsScheduledRef.current = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, step?.type, step?.speakText, word?.english, ttsPlayed]);

  function navigate(dir) {
    setAnimDir(dir);
    setVisible(false);
    setTimeout(() => {
      const newIndex = index + (dir === "next" ? 1 : -1);
      // #563 / #705 — deduct energy at each threshold (every N steps, progressive)
      if (dir === "next" && newIndex > 0 && newIndex % energyCostEvery === 0 && onEnergySpend) {
        onEnergySpend(energyCostPer5);
        setEnergyDisplay(e => e !== null ? Math.max(0, e - energyCostPer5) : null);
      }
      setIndex(newIndex);
      setTtsPlayed(false);
      setChoiceDone(false);
      setVisible(true);
    }, 180);
  }

  useEffect(() => {
    if (showCompletion) playVictorySfx();
  }, [showCompletion]);

  async function handleComplete() {
    if (!showCompletion) {
      setShowCompletion(true);
      return;
    }
    setCompleting(true);
    try {
      const tipsInLesson = steps.filter(s => s.type === "tip").length;
      await onComplete?.({ correctCounts, listeningTotal, calligraphyTotal, matchTotal, listenWriteTotal, memoryCheckTotal, writeWordTotal, listenWriteWordTotal, matchWriteWordTotal, tipsInLesson });
    } catch (e) {
      console.error("[LessonPlayerModal] completion callback failed:", e);
    } finally {
      // #564 — always close the modal so any queued celebrations (coins/ticket)
      // become visible even if loadPathData or a later step threw
      setCompleting(false);
      onClose?.();
    }
  }

  if (!lesson) return null;

  const totalSteps = steps.length;

  function autoNext() {
    if (isLast) {
      handleComplete();
    } else {
      navigate("next");
    }
  }

  const catName = profile?.avatar
    ? (avatarCatalog.find(a => a.id === profile.avatar)?.name || null)
    : null;

  return createPortal(
  <div className="lp-player-fullscreen">
      {/* Spacer matching app header height */}
      <div className="lp-player-topbar" />

      {/* Lesson sub-header */}
      <div className="lp-player-header">
        <button className="icon-btn lp-close-btn" onClick={onClose} aria-label="Close"><X size={16} /></button>
        <div className="lp-player-title">{lesson.title}</div>
        <div className="lp-player-count">
          {index + 1} / {totalSteps}
          {energyDisplay !== null && <span className="lp-player-energy">⚡{energyDisplay}/{energyMax}</span>}
        </div>
      </div>

      {/* Progress bar */}
      <div className="lp-progress-bar">
        <div className="lp-progress-fill" style={{ width: `${((index + 1) / totalSteps) * 100}%` }} />
      </div>

      {/* Step content */}
      <div className={`lp-step-content${visible ? " lp-step-in" : " lp-step-out"} lp-slide-${animDir}`}>
        {step?.type === "vocab" && (
          <div className="lp-vocab-card">
            <div className="lp-vocab-english">{word?.english ?? "—"}</div>
            <div className="lp-vocab-roman">{word?.romanization ?? ""}</div>
            <div className="lp-vocab-thai">{word?.thai ?? ""}</div>
            {word?.pos && <div className="lp-vocab-pos">{word.pos}</div>}
            <button
              className="tts-btn lp-tts-btn"
              onClick={() => { speakEnglish?.(word?.english); }}
              aria-label="Play pronunciation"
            >
              <Volume2 size={18} />
            </button>
          </div>
        )}

        {step?.type === "tip" && (
          <div className={`lp-tip-card${step.imageUrl ? " has-image" : ""}`}>
            {step.imageUrl ? (
              <>
                <img src={step.imageUrl} alt="" className="lp-tip-img" />
                <div className="lp-tip-text-col">
                  {step.text && <div className="lp-tip-text">{step.text}</div>}
                  {step.speakText && (
                    <button className="tts-btn lp-listen-round" onClick={() => speakEnglish(step.speakText)} aria-label="Listen again">
                      <Volume2 size={28} />
                    </button>
                  )}
                </div>
              </>
            ) : (
              <>
                <Lightbulb size={32} className="lp-tip-icon" />
                {step.text && <div className="lp-tip-text">{step.text}</div>}
                {step.speakText && (
                  <button className="tts-btn lp-listen-round" onClick={() => speakEnglish(step.speakText)} aria-label="Listen again">
                    <Volume2 size={28} />
                  </button>
                )}
              </>
            )}
          </div>
        )}

        {step?.type === "calligraphy" && (
          <CalligraphyStep key={index} step={step} speakEnglish={speakEnglish} onDone={() => { setChoiceDone(true); setCorrectCounts(c => ({...c, calligraphy: c.calligraphy + 1})); }} />
        )}

        {step?.type === "listening" && (
          <>
            <div className="lp-exercise-header">
              <div className="lp-exercise-title">Listening Check</div>
              <div className="lp-exercise-subtitle">Listen and choose the correct character</div>
            </div>
            <ChoiceStep
              key={index}
              correct={step.char}
              distractors={step.distractors}
              speakEnglish={speakEnglish}
              speakText={step.speakText}
              removeWrongOption={removeWrongOption}
              catName={catName}
              onDone={() => { setChoiceDone(true); setCorrectCounts(c => ({...c, listening: c.listening + 1})); }}
              onAutoNext={autoNext}
            />
          </>
        )}

        {step?.type === "image-match" && (
          <>
            {step.speakText && (
              <button className="tts-btn lp-listen-round" onClick={() => speakEnglish?.(step.speakText)} aria-label="Listen again">
                <Volume2 size={28} />
              </button>
            )}
            <ChoiceStep
              key={index}
              correct={step.char}
              distractors={step.distractors}
              imageUrl={step.imageUrl}
              removeWrongOption={removeWrongOption}
              catName={catName}
              onDone={() => { setChoiceDone(true); setCorrectCounts(c => ({...c, match: c.match + 1})); }}
              onAutoNext={autoNext}
            />
          </>
        )}

        {step?.type === "listen-write" && (
          <ListenWriteStep
            key={index}
            step={step}
            speakEnglish={speakEnglish}
            onDone={(correct) => { setChoiceDone(true); if (correct) setCorrectCounts(c => ({...c, listenWrite: c.listenWrite + 1})); autoNext(); }}
          />
        )}

        {step?.type === "memory-check" && (
          <MemoryCheckStep
            key={index}
            step={step}
            speakEnglish={speakEnglish}
            onDone={(correct) => { setChoiceDone(true); if (correct) setCorrectCounts(c => ({...c, memoryCheck: c.memoryCheck + 1})); autoNext(); }}
          />
        )}

        {step?.type === "write-word" && (
          <WriteWordStep
            key={index}
            step={step}
            speakEnglish={speakEnglish}
            onDone={() => { setChoiceDone(true); setCorrectCounts(c => ({...c, writeWord: c.writeWord + 1})); }}
          />
        )}

        {step?.type === "listen-write-word" && (
          <ListenWriteWordStep
            key={index}
            step={step}
            speakEnglish={speakEnglish}
            onDone={() => { setChoiceDone(true); setCorrectCounts(c => ({...c, listenWriteWord: c.listenWriteWord + 1})); }}
          />
        )}

        {step?.type === "match-write-word" && (
          <MatchWriteWordStep
            key={index}
            step={step}
            speakEnglish={speakEnglish}
            onDone={() => { setChoiceDone(true); setCorrectCounts(c => ({...c, matchWriteWord: c.matchWriteWord + 1})); }}
          />
        )}
      </div>

      {/* Navigation — hidden for auto-advance steps (choice + calligraphy) */}
      {!isAutoStep && (
        <div className="lp-player-nav">
          <button
            className="btn-primary lp-nav-btn"
            onClick={isLast ? handleComplete : () => navigate("next")}
            disabled={completing}
            aria-label={isLast ? "Finish lesson" : "Next step"}
          >
            {isLast
              ? (completing ? "Saving…" : "Finish ✓")
              : <><span>Next</span> <ChevronRight size={18} /></>
            }
          </button>
        </div>
      )}

      {/* Lesson completion screen */}
      {showCompletion && (
        <div className="lp-completion-overlay">
          <div className="lp-completion-card">
            <div className="lp-completion-emoji">🎉</div>
            <div className="lp-completion-title">Lesson Complete!</div>
            <div className="lp-completion-stats">
              {listeningTotal > 0 && (
                <div className="lp-stat-row">
                  <span className="lp-stat-label">🎧 Listening Recognition</span>
                  <span className="lp-stat-value">{correctCounts.listening}/{listeningTotal} <span className="lp-stat-pct">({Math.round(correctCounts.listening / listeningTotal * 100)}%)</span></span>
                </div>
              )}
              {calligraphyTotal > 0 && (
                <div className="lp-stat-row">
                  <span className="lp-stat-label">✍️ Calligraphy</span>
                  <span className="lp-stat-value">{correctCounts.calligraphy}/{calligraphyTotal} <span className="lp-stat-pct">({Math.round(correctCounts.calligraphy / calligraphyTotal * 100)}%)</span></span>
                </div>
              )}
              {matchTotal > 0 && (
                <div className="lp-stat-row">
                  <span className="lp-stat-label">🔍 Match Recognition</span>
                  <span className="lp-stat-value">{correctCounts.match}/{matchTotal} <span className="lp-stat-pct">({Math.round(correctCounts.match / matchTotal * 100)}%)</span></span>
                </div>
              )}
              {writeWordTotal > 0 && (
                <div className="lp-stat-row">
                  <span className="lp-stat-label">✍️📝 Write Word</span>
                  <span className="lp-stat-value">{correctCounts.writeWord}/{writeWordTotal} <span className="lp-stat-pct">({Math.round(correctCounts.writeWord / writeWordTotal * 100)}%)</span></span>
                </div>
              )}
              {listenWriteWordTotal > 0 && (
                <div className="lp-stat-row">
                  <span className="lp-stat-label">👂✍️📝 Listen &amp; Write Word</span>
                  <span className="lp-stat-value">{correctCounts.listenWriteWord}/{listenWriteWordTotal} <span className="lp-stat-pct">({Math.round(correctCounts.listenWriteWord / listenWriteWordTotal * 100)}%)</span></span>
                </div>
              )}
              {matchWriteWordTotal > 0 && (
                <div className="lp-stat-row">
                  <span className="lp-stat-label">🖼️✍️📝 Match &amp; Write Word</span>
                  <span className="lp-stat-value">{correctCounts.matchWriteWord}/{matchWriteWordTotal} <span className="lp-stat-pct">({Math.round(correctCounts.matchWriteWord / matchWriteWordTotal * 100)}%)</span></span>
                </div>
              )}
            </div>
            <button className="btn-primary lp-completion-btn" onClick={handleComplete} disabled={completing}>
              {completing ? "Saving…" : "Collect Reward"}
            </button>
          </div>
        </div>
      )}
  </div>,
  document.body
  );
}

// ---------------------------------------------------------------------------
// LP4 — LessonPathScreen (mapa de fases estilo Candy Crush)
//
// Props:
//   classCode       — student's active class code
//   lessons         — ordered array from listLessonsByClassCode (LP1)
//   progress        — lesson progress map from getLessonProgress (LP1)
//   sectionStats    — Map<sectionIndex, { total, completed, midClaimed, fullClaimed }>
//   onOpenLesson(lesson) — opens LessonPlayerModal (LP3)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// LP7 — Social presence: roster loading + peer badge
// ---------------------------------------------------------------------------

const LP_ROSTER_PREFIX  = "roster:";
const ONLINE_MS      = 5 * 60 * 1000; // 5 min — same threshold as teacher activity toast

// Load peers for this classCode (excluding self).
// Returns array of roster entries that have a lessonNodeIndex set.
export async function loadClassRoster(classCode, selfUsername) {
  const keys = await storageList(LP_ROSTER_PREFIX, true);
  if (!keys.length) return [];
  const entries = await Promise.all(keys.map(k => storageGet(k, true)));
  return entries.filter(e =>
    e &&
    e.username !== selfUsername &&
    e.enabledClassCodes?.includes(classCode) &&
    e.lessonNodeIndex != null
  );
}

// Mirror the student's current lesson node index into the shared roster.
// Called after markLessonComplete. Uses storageGetSafe to avoid blind overwrites.
export async function mirrorLessonNodeIndex(username, nodeIndex) {
  const key = `${LP_ROSTER_PREFIX}${username}`;
  const { value: existing, error } = await storageGetSafe(key, true);
  if (error) { console.error("[mirrorLessonNodeIndex] aborting — read failed for", username); return; }
  await storageSet(key, { ...(existing || {}), username, lessonNodeIndex: nodeIndex, lastActive: Date.now() }, true);
}

// ---------------------------------------------------------------------------
// LP5 — Decorative avatar background for the path map
// ---------------------------------------------------------------------------

// Simple non-cryptographic hash (djb2) for deterministic positioning.
function hashStr(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i);
  return Math.abs(h);
}

// Returns a seeded float in [0, 1) from a hash + salt.
function seededRand(seed, salt) {
  return (hashStr(`${seed}-${salt}`) % 10000) / 10000;
}

// Build a list of decorative avatar placements from a common/uncommon subset.
// Positions are fully deterministic (no Math.random) — no flicker on re-render.
export function getDecorativeAvatars(catalog, monthKey, count = 12) {
  const eligible = catalog.filter(a => a.rarity === "common" || a.rarity === "uncommon");
  if (!eligible.length) return [];

  // Deterministic shuffle seeded on monthKey
  const sorted = [...eligible].sort((a, b) => hashStr(`${monthKey}-${a.id}`) - hashStr(`${monthKey}-${b.id}`));
  const pool   = sorted.slice(0, count);

  return pool.map((avatar, i) => ({
    id:      avatar.id,
    image:   avatar.image,
    // x: 5–90% to stay inside the container
    x:       5 + seededRand(avatar.id, "x") * 85,
    // y: distributed across the full scroll height
    y:       (i / pool.length) * 90 + seededRand(avatar.id, "y") * (90 / pool.length),
    opacity: 0.25 + seededRand(avatar.id, "op") * 0.15,  // 0.25–0.40
    scale:   0.55 + seededRand(avatar.id, "sc") * 0.25,  // 0.55–0.80
    rotate:  (seededRand(avatar.id, "ro") - 0.5) * 30,   // -15° to +15°
  }));
}

function DecorativeBackground({ avatars }) {
  if (!avatars?.length) return null;
  return (
    <div className="lp-deco-layer" aria-hidden="true">
      {avatars.map(a => (
        <img
          key={a.id}
          src={a.image}
          alt=""
          className="lp-deco-avatar"
          style={{
            left:    `${a.x}%`,
            top:     `${a.y}%`,
            opacity:  a.opacity,
            transform: `translateX(-50%) scale(${a.scale}) rotate(${a.rotate}deg)`,
          }}
          onError={e => { e.currentTarget.style.display = "none"; }}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// LP4 — LessonPathScreen (mapa de fases estilo Candy Crush)
// Zigzag x positions: left / center / right cycling per lesson node
const ZIGZAG_X = [20, 50, 80]; // percent of container width

function nodeStatus(lesson, progress, energy, teacherView = false, prevCompleted = true, currentCode = null, allCodes = []) {
  if (teacherView) return progress[lesson.id]?.completedAt ? "completed" : "available";
  if (progress[lesson.id]?.completedAt) return "completed";
  // #725 — classCode-gate: lessons from codes higher than current are always locked
  if (currentCode && allCodes.length > 0) {
    const ci = allCodes.indexOf(currentCode);
    const li = allCodes.indexOf(lesson.classCode);
    if (ci >= 0 && li > ci) return "code-locked";
  }
  if (lesson.locked) return "teacher-locked"; // #704
  if (!prevCompleted) return "locked";
  if (lesson.classCode?.startsWith("S0")) {
    if (!progress[lesson.id]?.available) return "locked";
    if (energy < S0_ENERGY_COST)         return "energy-locked";
  }
  return "available";
}

function SectionSeparator({ sectionIndex, stats, name, nameFont, colorIdx = 0 }) {
  const c = CODE_COLORS[colorIdx % CODE_COLORS.length] || CODE_COLORS[0];
  const pct = stats.total ? stats.completed / stats.total : 0;
  return (
    <div className="lp-section-sep">
      <div className="lp-section-sep-line" style={{ background: `linear-gradient(90deg, transparent, ${c.light}50, transparent)` }} />
      {name && (
        <div className="lp-section-sep-name" style={{ fontFamily: nameFont || FONT_THAI, color: c.light }}>
          {name}
        </div>
      )}
      <div className="lp-section-sep-label">
        <span>Section {sectionIndex}</span>
        <span className="lp-section-sep-pct" style={{ color: c.grad[0] }}>{Math.round(pct * 100)}%</span>
      </div>
    </div>
  );
}

// #725 — visual boundary between classCodes
function CodeSeparator({ classCode, colorIdx = 0 }) {
  const c = CODE_COLORS[colorIdx % CODE_COLORS.length] || CODE_COLORS[0];
  return (
    <div className="lp-code-sep" style={{ "--lp-code-color": c.light }}>
      <div className="lp-code-sep-line" style={{ background: `linear-gradient(90deg, transparent, ${c.light}60, transparent)` }} />
      <div className="lp-code-sep-badge">
        <Lock size={11} style={{ color: c.light, opacity: 0.8 }} />
        <span className="lp-code-sep-label" style={{ color: c.light }}>{classCode}</span>
      </div>
      <div className="lp-code-sep-line" style={{ background: `linear-gradient(90deg, transparent, ${c.light}60, transparent)` }} />
    </div>
  );
}

function PeerBadge({ peer, avatarImage }) {
  const isOnline = peer.lastActive && (Date.now() - peer.lastActive) < ONLINE_MS;
  return (
    <div className="lp-peer-badge" title={peer.username}>
      <div className="lp-peer-avatar-wrap">
        {avatarImage
          ? <img src={avatarImage} alt={peer.username} className="lp-peer-avatar-img" onError={e => { e.currentTarget.style.display = "none"; }} />
          : <div className="lp-peer-avatar-fallback">{peer.username?.[0]?.toUpperCase()}</div>
        }
        <span className={"lp-peer-dot" + (isOnline ? " online" : "")} />
      </div>
      <span className="lp-peer-name">{peer.username}</span>
    </div>
  );
}

function LessonNode({ lesson, status, xPct, onOpen, peers = [], avatarCatalog = [], energyTimeLabel = "", nodeIndex = 0, isFirst = false, nodeButtonRef = null, playerAvatarImage = null, colorIdx = 0 }) {
  const isCompleted     = status === "completed";
  const isAvailable     = status === "available";
  const isLocked        = status === "locked";
  const isEnergyLocked  = status === "energy-locked";
  const isTeacherLocked = status === "teacher-locked"; // #704
  const isCodeLocked    = status === "code-locked";    // #725

  const visiblePeers  = peers.slice(0, 3);
  const overflowCount = peers.length - visiblePeers.length;

  function getAvatarImage(peer) {
    const av = avatarCatalog.find(a => a.id === peer.avatar);
    return av?.image || null;
  }

  return (
    <div className="lp-node-wrap" style={{ left: `${xPct}%`, transform: "translateX(-50%)" }}>
      {visiblePeers.length > 0 && (
        <div className="lp-peer-cluster">
          {visiblePeers.map(p => (
            <PeerBadge key={p.username} peer={p} avatarImage={getAvatarImage(p)} />
          ))}
          {overflowCount > 0 && <div className="lp-peer-overflow">+{overflowCount}</div>}
        </div>
      )}
      <button
        ref={nodeButtonRef}
        className={`lp-node lp-node-${isCodeLocked ? "locked" : status}${isAvailable ? " lp-node-pulse" : ""}`}
        onClick={() => !isLocked && !isEnergyLocked && !isTeacherLocked && !isCodeLocked && onOpen?.(lesson)}
        disabled={isLocked || isEnergyLocked || isTeacherLocked || isCodeLocked}
        aria-label={lesson.title}
        title={isCodeLocked ? "Complete the current level to unlock." : isEnergyLocked ? `Not enough energy — ${energyTimeLabel}` : isTeacherLocked ? "This lesson is locked by your teacher." : lesson.title}
        style={isAvailable ? (() => { const c = CODE_COLORS[colorIdx % CODE_COLORS.length]; return { background: `linear-gradient(145deg, ${c.light}, ${c.dark})`, borderColor: c.grad[0], boxShadow: `0 4px 20px ${c.shadow}, 0 0 0 4px ${c.grad[0]}33` }; })() : undefined}
      >
        {isCompleted                               && <Check size={24} strokeWidth={3} />}
        {(isAvailable || isLocked || isCodeLocked) && <span className="lp-node-inner"><span className="lp-node-num">{nodeIndex + 1}</span><span className="lp-node-paw">{(isLocked || isCodeLocked) ? "🔒" : "🐾"}</span></span>}
        {isTeacherLocked                           && <span className="lp-node-inner"><span className="lp-node-num">{nodeIndex + 1}</span><span className="lp-node-paw">🔒</span></span>}
        {isEnergyLocked                            && <span style={{ fontSize: 20 }}>⚡</span>}
      </button>
      <div className="lp-node-label">{lesson.title}</div>
      {isFirst && <div className="lp-start-badge">START</div>}
      {playerAvatarImage && (
        <img src={playerAvatarImage} alt="you" className="lp-player-avatar-pin" />
      )}
    </div>
  );
}

export function LessonPathScreen({ lessons, progress, sectionStats, sectionMeta = {}, onOpenLesson, decorativeAvatars = [], classCode, selfUsername, avatarCatalog = [], playerAvatarId = null, teacherView = false, energyVersion = 0, energyMax = S0_ENERGY_MAX, currentCode = null, allCodes = [], walkEnabled = true }) {
  const [peers, setPeers] = useState([]);
  const isS0 = (currentCode || classCode)?.startsWith("S0");

  // issue #430 — energy state (S0 only); #562 — energyVersion bumped by parent after spend to refresh immediately
  // #572 — pass energyMax so passive refill respects cat power bonus cap
  const [energy, setEnergy] = useState(energyMax);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!isS0) return;
    getS0Energy(energyMax).then(setEnergy);
    const energyId = setInterval(() => getS0Energy(energyMax).then(setEnergy), 60_000);
    const tickId   = setInterval(() => setNow(Date.now()), 1_000);
    return () => { clearInterval(energyId); clearInterval(tickId); };
  }, [isS0, energyVersion, energyMax]);

  // Compute time until next energy point (mm:ss)
  const secsToNext = energy < energyMax
    ? (15 * 60) - Math.floor((now % (15 * 60 * 1000)) / 1_000)
    : 0;
  const refillMM  = String(Math.floor(secsToNext / 60)).padStart(2, "0");
  const refillSS  = String(secsToNext % 60).padStart(2, "0");
  const energyTimeLabel = energy < energyMax ? `Next ⚡ in ${refillMM}:${refillSS}` : "";

  // LP7 — load class roster, then poll every 60s
  useEffect(() => {
    if (!classCode) return;
    let cancelled = false;
    async function fetchPeers() {
      const roster = await loadClassRoster(classCode, selfUsername);
      if (!cancelled) setPeers(roster);
    }
    fetchPeers();
    const interval = setInterval(fetchPeers, 60_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [classCode, selfUsername]);

  // Build a flat ordered list of lessons (same order as nodeRows below)
  // so we can map lessonNodeIndex → lesson id for peer placement.
  const orderedLessons = React.useMemo(() => {
    const map = new Map();
    lessons.forEach(l => {
      if (!map.has(l.sectionIndex)) map.set(l.sectionIndex, []);
      map.get(l.sectionIndex).push(l);
    });
    const sectionsSorted = Array.from(map.entries()).sort((a, b) => a[0] - b[0]);
    return sectionsSorted.flatMap(([, ls]) => ls);
  }, [lessons]);

  // peers keyed by lessonId they're currently at
  const peersByLesson = React.useMemo(() => {
    const map = new Map();
    peers.forEach(peer => {
      const lesson = orderedLessons[peer.lessonNodeIndex];
      if (!lesson) return;
      if (!map.has(lesson.id)) map.set(lesson.id, []);
      map.get(lesson.id).push(peer);
    });
    return map;
  }, [peers, orderedLessons]);

  // #725 — group lessons by (classCode, sectionIndex), sorted top-to-bottom:
  // lower code index (S0C1 before S0C2) → top; within same code, lower sectionIndex → top
  const sectionGroups = React.useMemo(() => {
    const map = new Map();
    lessons.forEach(l => {
      const key = `${l.classCode}::${l.sectionIndex}`;
      if (!map.has(key)) map.set(key, { classCode: l.classCode, sectionIndex: l.sectionIndex, lessons: [] });
      map.get(key).lessons.push(l);
    });
    return Array.from(map.values()).sort((a, b) => {
      const ai = allCodes.length > 0 ? allCodes.indexOf(a.classCode) : 0;
      const bi = allCodes.length > 0 ? allCodes.indexOf(b.classCode) : 0;
      if (ai !== bi) return ai - bi;
      return a.sectionIndex - b.sectionIndex;
    });
  }, [lessons, allCodes]);

  // Refs for measuring real node button positions for SVG connector lines.
  // Must be declared BEFORE any early return to respect Rules of Hooks (#459).
  const scrollRef = useRef(null);
  const nodeButtonRefs = useRef([]);
  const [svgPoints, setSvgPoints] = useState([]);
  const [svgHeight, setSvgHeight] = useState(0);

  // #795 — cat walk animation between nodes
  const [catWalk, setCatWalk] = useState(null); // null | { x, y, toX, toY, goingLeft, arrived }
  const prevNodeIndexRef  = useRef(null);
  const catWalkRafRef     = useRef(null);
  const pendingWalkRef    = useRef(null); // { fromIdx, toIdx } queued while walkEnabled=false

  // Build flat row list interleaving code-separators, section-separators and nodes
  const rows = React.useMemo(() => {
    const result = [];
    let ni = 0;
    let prevDone = true;
    let prevCode = null;
    sectionGroups.forEach(({ classCode: cc, sectionIndex: secIdx, lessons: secLessons }) => {
      const colorIdx = getCodeColorIndex(cc, allCodes);
      if (prevCode !== null && prevCode !== cc) {
        result.push({ type: "code-separator", classCode: cc, colorIdx });
        prevDone = true; // each code starts its own sequential progression
      }
      const statsKey = allCodes.length > 0 ? `${cc}::${secIdx}` : secIdx;
      const stats = sectionStats?.get(statsKey) || { total: 0, completed: 0, midClaimed: false, fullClaimed: false };
      result.push({ type: "separator", secIdx, stats, classCode: cc, colorIdx });
      secLessons.forEach(lesson => {
        const status = nodeStatus(lesson, progress, energy, teacherView, prevDone, currentCode, allCodes);
        result.push({ type: "node", lesson, xPct: ZIGZAG_X[ni % ZIGZAG_X.length], status, nodeIndex: ni, colorIdx });
        prevDone = status === "completed";
        ni++;
      });
      prevCode = cc;
    });
    return result;
  }, [sectionGroups, progress, energy, teacherView, sectionStats, currentCode, allCodes]);

  const nodeRows = React.useMemo(() => rows.filter(r => r.type === "node"), [rows]);
  const currentNodeIndex = React.useMemo(
    () => nodeRows.find(r => r.status === "available")?.nodeIndex ?? null,
    [nodeRows]
  );

  function _fireCatWalk(fromIdx, toIdx, points) {
    const from = points[fromIdx];
    const to   = points[toIdx];
    if (!from || !to) return;
    // #803 — mount at `from`, then trigger the CSS transition in the next paint
    // frame. Without double-rAF the transition starts at the same tick as mount
    // (no visual from→to delta yet) and the element appears frozen.
    const travelMs = 1200;
    setCatWalk({ x: from.x, y: from.y, toX: to.x, toY: to.y, goingLeft: to.x < from.x, arrived: false });
    catWalkRafRef.current = requestAnimationFrame(() => {
      catWalkRafRef.current = requestAnimationFrame(() => {
        setCatWalk(w => w && !w.arrived ? { ...w, x: w.toX, y: w.toY } : w);
      });
    });
    const t1 = setTimeout(() => setCatWalk(w => w ? { ...w, arrived: true } : null), travelMs);
    const t2 = setTimeout(() => setCatWalk(null), travelMs + 600);
    return () => {
      cancelAnimationFrame(catWalkRafRef.current);
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }

  // Detect node advance — if walkEnabled, fire immediately; otherwise queue.
  useEffect(() => {
    if (currentNodeIndex == null) return;
    const prev = prevNodeIndexRef.current;
    prevNodeIndexRef.current = currentNodeIndex;
    if (prev == null || prev === currentNodeIndex) return;
    if (!walkEnabled) {
      pendingWalkRef.current = { fromIdx: prev, toIdx: currentNodeIndex };
      return;
    }
    return _fireCatWalk(prev, currentNodeIndex, svgPoints);
  }, [currentNodeIndex, svgPoints]); // eslint-disable-line react-hooks/exhaustive-deps

  // Drain pending walk when celebrations clear and svgPoints are fresh.
  useEffect(() => {
    if (!walkEnabled || !pendingWalkRef.current) return;
    const { fromIdx, toIdx } = pendingWalkRef.current;
    pendingWalkRef.current = null;
    return _fireCatWalk(fromIdx, toIdx, svgPoints);
  }, [walkEnabled, svgPoints]); // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => {
    const scrollEl = scrollRef.current;
    if (!scrollEl) return;
    const containerRect = scrollEl.getBoundingClientRect();
    setSvgHeight(scrollEl.scrollHeight);
    const pts = nodeButtonRefs.current.map((btn, i) => {
      if (!btn) return null;
      const r = btn.getBoundingClientRect();
      return {
        x: r.left - containerRect.left + r.width / 2,
        y: r.top  - containerRect.top  + scrollEl.scrollTop + r.height / 2,
        colorIdx: nodeRows[i]?.colorIdx ?? 0,
      };
    }).filter(Boolean);
    setSvgPoints(pts);
  }, [rows]);

  if (!lessons.length) {
    return (
      <div className="lp-path-empty">
        <BookOpen size={40} />
        <p>No lessons available yet.</p>
        <p className="lp-path-empty-sub">Your teacher will add lessons here soon.</p>
      </div>
    );
  }

  return (
    <div className="lp-path-screen">
      {/* issue #430 — energy bar, visible only for S0 class codes */}
      {isS0 && !teacherView && (
        <div className={`lp-energy-bar${energy > energyMax ? " lp-energy-bonus" : ""}`}>
          <div className="lp-energy-top">
            <span className="lp-energy-icon">⚡</span>
            <span className="lp-energy-value">{energy} / {energyMax}</span>
            {energy < energyMax && (
              <span className="lp-energy-refill">{energyTimeLabel}</span>
            )}
          </div>
          <div className="lp-energy-track">
            <div className="lp-energy-fill" style={{ width: `${Math.min(100, (energy / energyMax) * 100)}%` }} />
          </div>
        </div>
      )}
      <div className="lp-path-scroll" ref={scrollRef}>
        <DecorativeBackground avatars={decorativeAvatars} />
        {/* SVG connector lines — pixel positions measured via refs after mount */}
        <svg className="lp-path-svg" aria-hidden="true" style={{ height: svgHeight || "100%" }}>
          <defs>
            {/* per-code solid gradients */}
            {CODE_COLORS.map((c, i) => (
              <linearGradient key={i} id={`lp-path-grad-${i}`} x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%"   stopColor={c.grad[0]} />
                <stop offset="50%"  stopColor={c.grad[1]} />
                <stop offset="100%" stopColor={c.grad[2]} />
              </linearGradient>
            ))}
            {/* cross-code transition gradients (from → to) */}
            {CODE_COLORS.map((ca, ia) =>
              CODE_COLORS.map((cb, ib) => ia !== ib ? (
                <linearGradient key={`${ia}-${ib}`} id={`lp-path-grad-${ia}-${ib}`} x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%"   stopColor={ca.grad[1]} />
                  <stop offset="100%" stopColor={cb.grad[1]} />
                </linearGradient>
              ) : null)
            )}
          </defs>
          {svgPoints.slice(1).map((pt, i) => {
            const ci  = svgPoints[i].colorIdx ?? 0;
            const cj  = pt.colorIdx ?? 0;
            const crossCode = cj !== ci;
            const strokeId  = crossCode
              ? `lp-path-grad-${ci % CODE_COLORS.length}-${cj % CODE_COLORS.length}`
              : `lp-path-grad-${ci % CODE_COLORS.length}`;
            const shadow = crossCode
              ? `drop-shadow(0 0 6px ${CODE_COLORS[ci % CODE_COLORS.length].shadow})`
              : `drop-shadow(0 0 6px ${CODE_COLORS[ci % CODE_COLORS.length].shadow})`;
            return (
              <line key={i}
                x1={svgPoints[i].x} y1={svgPoints[i].y}
                x2={pt.x}           y2={pt.y}
                stroke={`url(#${strokeId})`}
                strokeWidth={crossCode ? 8 : 10}
                strokeLinecap="round"
                strokeDasharray={crossCode ? "14 8" : undefined}
                style={{ filter: shadow }}
              />
            );
          })}
        </svg>

        <div className="lp-path-rows">
          {(() => {
            const playerAvatarImage = playerAvatarId
              ? (avatarCatalog.find(a => a.id === playerAvatarId)?.image || null)
              : null;
            return rows.map((row, ri) => {
              if (row.type === "code-separator") {
                return <CodeSeparator key={`csep-${row.classCode}-${ri}`} classCode={row.classCode} colorIdx={row.colorIdx} />;
              }
              if (row.type === "separator") {
                const metaKey = allCodes.length > 0 ? `${row.classCode}::${row.secIdx}` : row.secIdx;
                return <SectionSeparator key={`sep-${row.classCode}-${row.secIdx}`} sectionIndex={row.secIdx} stats={row.stats} name={sectionMeta[metaKey]?.name} nameFont={sectionMeta[metaKey]?.font} colorIdx={row.colorIdx} />;
              }
              return (
                <div key={row.lesson.id} className="lp-node-row">
                  <LessonNode
                    lesson={row.lesson}
                    status={row.status}
                    xPct={row.xPct}
                    onOpen={onOpenLesson}
                    peers={peersByLesson.get(row.lesson.id) || []}
                    avatarCatalog={avatarCatalog}
                    energyTimeLabel={energyTimeLabel}
                    nodeIndex={row.nodeIndex}
                    isFirst={row.nodeIndex === 0}
                    nodeButtonRef={el => { nodeButtonRefs.current[row.nodeIndex] = el; }}
                    playerAvatarImage={(row.nodeIndex === currentNodeIndex && !catWalk) ? playerAvatarImage : null}
                    colorIdx={row.colorIdx}
                  />
                </div>
              );
            });
          })()}
        </div>

        {catWalk && playerAvatarId && (() => {
          const avatarImg = avatarCatalog.find(a => a.id === playerAvatarId)?.image || null;
          if (!avatarImg) return null;
          return (
            <img
              key="cat-walk"
              src={avatarImg}
              className={`lp-cat-walk${catWalk.arrived ? " lp-cat-walk--arrived" : " lp-cat-walk--moving"}${catWalk.goingLeft ? " lp-cat-walk--flip" : ""}`}
              style={{ left: catWalk.x, top: catWalk.y }}
              alt=""
              aria-hidden="true"
            />
          );
        })()}
      </div>
    </div>
  );
}
