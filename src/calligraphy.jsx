// ---------------------------------------------------------------------------
// Shared calligraphy components — StrokeAnimation and TracingCanvas.
// Extracted from App.jsx so lessonPath.jsx can use them without circular deps.
// Phase 10 (#60, #61). Referenced by App.jsx and lessonPath.jsx.
// ---------------------------------------------------------------------------
import React, { useState, useEffect, useMemo, useRef } from "react";
import { Play, RotateCcw } from "lucide-react";
import { THAI_STROKES } from "./data/thaiStrokes";
import { THAI_VOWEL_TONES } from "./data/thaiVowelTones";
// #356 — merged dataset: vowels/tones extend consonants, consonants take priority on conflict
const ALL_THAI_STROKES = { ...THAI_VOWEL_TONES, ...THAI_STROKES };
import { getStroke } from "perfect-freehand";
import { normalizeStroke, scoreStroke } from "./utils/unistrokeRecognizer";

export const STROKE_MS_PER_UNIT = { normal: 14, slow: 32 };
export const STROKE_PAUSE_MS = 350;

export function buildSmoothStrokePathD(points) {
  if (!points || points.length === 0) return "";
  if (points.length === 1) return `M ${points[0][0]} ${points[0][1]}`;
  let d = `M ${points[0][0]} ${points[0][1]}`;
  for (let i = 1; i < points.length - 1; i++) {
    const [cx, cy] = points[i];
    const [nx, ny] = points[i + 1];
    d += ` Q ${cx} ${cy} ${(cx + nx) / 2} ${(cy + ny) / 2}`;
  }
  const last = points[points.length - 1];
  d += ` L ${last[0]} ${last[1]}`;
  return d;
}

export function getSvgPathFromStroke(stroke) {
  if (!stroke.length) return "";
  const d = stroke.reduce(
    (acc, [x0, y0], i, arr) => {
      const [x1, y1] = arr[(i + 1) % arr.length];
      acc.push(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
      return acc;
    },
    ["M", ...stroke[0], "Q"]
  );
  d.push("Z");
  return d.join(" ");
}

export const TRACE_FREEHAND_OPTS = { size: 3.5, thinning: 0.6, smoothing: 0.55, streamlining: 0.5 };
const TRACE_PASS_THRESHOLD = 0.68;
const TRACE_PASS_THRESHOLD_OVERRIDES = {
  "ส": { 1: 0.58 },
  "ศ": { 1: 0.58 },
  "ษ": { 1: 0.63 },
  "ญ": { 1: 0.64 },
};
export function getTracePassThreshold(char, strokeIdx) {
  return TRACE_PASS_THRESHOLD_OVERRIDES[char]?.[strokeIdx] ?? TRACE_PASS_THRESHOLD;
}
const TRACE_MAX_ATTEMPTS_BEFORE_HINT = 3;
const TRACE_RESAMPLE_N = 64;

export function StrokeAnimation({ char, size = 180, speed = "normal", showGlyphGuide = true, onComplete }) {
  const strokes = ALL_THAI_STROKES[char]?.strokes || [];
  const pathData = useMemo(() => strokes.map(buildSmoothStrokePathD), [strokes]);
  const pathRefs = useRef([]);
  const dotRef = useRef(null);
  const timerRef = useRef(null);
  const rafIdRef = useRef(null);
  const [playToken, setPlayToken] = useState(0);
  const [activeSpeed, setActiveSpeed] = useState(speed);
  const [isPlaying, setIsPlaying] = useState(false);
  const [hasPlayedOnce, setHasPlayedOnce] = useState(false);

  useEffect(() => {
    if (!strokes.length) return undefined;
    let cancelled = false;
    setIsPlaying(true);

    function wait(ms) {
      return new Promise((resolve) => { timerRef.current = setTimeout(resolve, ms); });
    }
    function playStroke(i) {
      return new Promise((resolve) => {
        const path = pathRefs.current[i];
        if (!path) { resolve(); return; }
        const length = path.getTotalLength();
        path.style.transition = "none";
        path.style.strokeDasharray = `${length}`;
        path.style.strokeDashoffset = `${length}`;
        path.getBoundingClientRect();
        const duration = Math.max(260, length * STROKE_MS_PER_UNIT[activeSpeed]);
        path.style.transition = `stroke-dashoffset ${duration}ms linear`;
        path.style.strokeDashoffset = "0";
        const start = performance.now();
        function tick(now) {
          if (cancelled) return;
          const t = Math.min(1, (now - start) / duration);
          if (dotRef.current) {
            const p = path.getPointAtLength(t * length);
            dotRef.current.setAttribute("cx", p.x);
            dotRef.current.setAttribute("cy", p.y);
            dotRef.current.style.opacity = t < 1 ? "1" : "0";
          }
          if (t < 1) { rafIdRef.current = requestAnimationFrame(tick); }
          else resolve();
        }
        rafIdRef.current = requestAnimationFrame(tick);
      });
    }
    async function playAll() {
      for (let i = 0; i < strokes.length; i++) {
        if (cancelled) return;
        // eslint-disable-next-line no-await-in-loop
        await playStroke(i);
        if (cancelled) return;
        if (i < strokes.length - 1) {
          // eslint-disable-next-line no-await-in-loop
          await wait(STROKE_PAUSE_MS);
        }
      }
      if (!cancelled) { setIsPlaying(false); setHasPlayedOnce(true); onComplete?.(); }
    }
    playAll();
    return () => {
      cancelled = true;
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [char, playToken, activeSpeed]);

  const viewBox = "-5 0 95 125";
  const aspect = 125 / 95;

  return (
    <div className="stroke-anim-wrap">
      <svg viewBox={viewBox} width={size} height={Math.round(size * aspect)} className="stroke-anim-svg">
        {showGlyphGuide && (
          <text x="42.5" y="100" fontSize="100" textAnchor="middle" className="stroke-anim-glyph-guide">{char}</text>
        )}
        {pathData.map((d, i) => (
          <path
            key={i}
            ref={(el) => { pathRefs.current[i] = el; }}
            d={d}
            fill="none"
            className="stroke-anim-path"
          />
        ))}
        <circle ref={dotRef} r="4.5" className="stroke-anim-dot" style={{ opacity: 0 }} />
      </svg>
      <div className="stroke-anim-controls">
        <button
          className="icon-btn"
          onClick={() => setPlayToken((t) => t + 1)}
          disabled={isPlaying}
          title={hasPlayedOnce ? "Replay" : "Play"}
        >
          {hasPlayedOnce ? <RotateCcw size={16} /> : <Play size={16} />}
        </button>
        <div className="stroke-anim-speed">
          <button
            className={activeSpeed === "normal" ? "stroke-anim-speed-btn active" : "stroke-anim-speed-btn"}
            onClick={() => setActiveSpeed("normal")}
          >Normal</button>
          <button
            className={activeSpeed === "slow" ? "stroke-anim-speed-btn active" : "stroke-anim-speed-btn"}
            onClick={() => setActiveSpeed("slow")}
          >Slow</button>
        </div>
      </div>
    </div>
  );
}

export function TracingCanvas({ char, size = 260, onComplete }) {
  const strokes = ALL_THAI_STROKES[char]?.strokes || [];
  const viewBox = "-5 0 95 125";
  const aspect = 125 / 95;

  const svgRef = useRef(null);
  const ghostPathRefs = useRef([]);
  const isDrawingRef = useRef(false);
  const rawPointsRef = useRef([]);

  const [strokeIndex, setStrokeIndex] = useState(0);
  const [passedStrokes, setPassedStrokes] = useState([]);
  const [drawingPoints, setDrawingPoints] = useState([]);
  const [flashState, setFlashState] = useState(null);
  const [attemptCount, setAttemptCount] = useState(0);
  const [showReplayHint, setShowReplayHint] = useState(false);
  const passedScoresRef = useRef([]); // Issue #414 — collect per-stroke scores for avg

  useEffect(() => {
    setStrokeIndex(0);
    setPassedStrokes([]);
    setDrawingPoints([]);
    setFlashState(null);
    setAttemptCount(0);
    setShowReplayHint(false);
    passedScoresRef.current = [];
  }, [char]);

  const isDone = strokeIndex >= strokes.length;

  function svgPointFromEvent(e) {
    const svg = svgRef.current;
    const ctm = svg.getScreenCTM();
    if (!ctm) return [0, 0];
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const p = pt.matrixTransform(ctm.inverse());
    return [p.x, p.y];
  }

  function handlePointerDown(e) {
    if (isDone || flashState || showReplayHint) return;
    e.target.setPointerCapture?.(e.pointerId);
    isDrawingRef.current = true;
    const [x, y] = svgPointFromEvent(e);
    rawPointsRef.current = [[x, y, e.pressure || 0.5]];
    setDrawingPoints(rawPointsRef.current);
  }
  function handlePointerMove(e) {
    if (!isDrawingRef.current) return;
    const [x, y] = svgPointFromEvent(e);
    rawPointsRef.current = [...rawPointsRef.current, [x, y, e.pressure || 0.5]];
    setDrawingPoints(rawPointsRef.current);
  }
  function handlePointerUp() {
    if (!isDrawingRef.current) return;
    isDrawingRef.current = false;
    const raw = rawPointsRef.current;
    if (raw.length < 4) { setDrawingPoints([]); return; }
    evaluateStroke(raw);
  }

  function evaluateStroke(rawPoints) {
    const ghostPath = ghostPathRefs.current[strokeIndex];
    if (!ghostPath) return;
    const length = ghostPath.getTotalLength();
    const templatePoints = [];
    for (let i = 0; i < TRACE_RESAMPLE_N; i++) {
      const p = ghostPath.getPointAtLength((i / (TRACE_RESAMPLE_N - 1)) * length);
      templatePoints.push([p.x, p.y]);
    }
    const drawnXY = rawPoints.map(([x, y]) => [x, y]);
    const score = scoreStroke(normalizeStroke(drawnXY), normalizeStroke(templatePoints));
    const passed = score >= getTracePassThreshold(char, strokeIndex);
    const outlineD = getSvgPathFromStroke(getStroke(rawPoints, TRACE_FREEHAND_OPTS));

    if (passed) {
      passedScoresRef.current = [...passedScoresRef.current, score];
      setPassedStrokes((prev) => [...prev, outlineD]);
      setFlashState("pass");
      setAttemptCount(0);
      setShowReplayHint(false);
      setTimeout(() => {
        setFlashState(null);
        setDrawingPoints([]);
        setStrokeIndex((i) => {
          const next = i + 1;
          if (next >= strokes.length) {
            const scores = passedScoresRef.current;
            const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 1;
            onComplete?.(avg);
          }
          return next;
        });
      }, 550);
    } else {
      setFlashState("fail");
      setAttemptCount((c) => {
        const next = c + 1;
        if (next >= TRACE_MAX_ATTEMPTS_BEFORE_HINT) setShowReplayHint(true);
        return next;
      });
      setTimeout(() => { setFlashState(null); setDrawingPoints([]); }, 550);
    }
  }

  const currentInkD = useMemo(() => {
    if (drawingPoints.length < 2) return "";
    return getSvgPathFromStroke(getStroke(drawingPoints, TRACE_FREEHAND_OPTS));
  }, [drawingPoints]);

  return (
    <div className="tracing-canvas-wrap">
      <svg
        ref={svgRef}
        viewBox={viewBox}
        width={size}
        height={Math.round(size * aspect)}
        className={"tracing-canvas-svg" + (flashState ? ` tracing-flash-${flashState}` : "")}
        style={{ touchAction: "none" }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      >
        <text x="4" y="100" fontSize="100" className="stroke-anim-glyph-guide">{char}</text>
        {strokes.map((pts, i) => (
          <path
            key={i}
            ref={(el) => { ghostPathRefs.current[i] = el; }}
            d={buildSmoothStrokePathD(pts)}
            fill="none"
            className={
              i === strokeIndex ? "tracing-ghost-active" : i < strokeIndex ? "tracing-ghost-done" : "tracing-ghost-pending"
            }
          />
        ))}
        {passedStrokes.map((d, i) => (
          <path key={`passed-${i}`} d={d} className="tracing-ink-passed" />
        ))}
        {currentInkD && (
          <path d={currentInkD} className={"tracing-ink-live" + (flashState === "fail" ? " tracing-ink-fail" : "")} />
        )}
      </svg>

      <div className="tracing-canvas-status">
        {isDone ? (
          <div className="tracing-complete">
            <img src="/mascote-studying.png" alt="" className="tracing-mascot tracing-mascot-sm" />
            <span>Great job! ✓</span>
          </div>
        ) : (
          <span className="page-sub">Stroke {strokeIndex + 1} / {strokes.length}</span>
        )}
      </div>

      {showReplayHint && !isDone && (
        <div className="tracing-hint-overlay">
          <img src="/mascote-crying.png" alt="" className="tracing-mascot" />
          <p className="page-sub">Having trouble? Let's watch the strokes again.</p>
          <StrokeAnimation char={char} size={140} />
          <button className="save-btn" onClick={() => { setShowReplayHint(false); setAttemptCount(0); }}>
            Got it, let me try
          </button>
        </div>
      )}
    </div>
  );
}
