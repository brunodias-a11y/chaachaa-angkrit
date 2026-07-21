// Word Writing Activity — Phase 10 (#835–839) + Phase 21 (#840–842)
import { useRef, useState, useEffect } from "react";
import { ENGLISH_STROKES } from './data/englishStrokes.js';

// ---------------------------------------------------------------------------
// #835 — ThaiWordDecomposer
// Decompõe uma string Thai em slots de sílaba prontos para o WordLayoutEngine.
//
// Output por slot:
//   { consonant: "ก", parts: [{ ch, type }], tone: "่" | null }
//
// Types de part: "preposed" | "above" | "below" | "postposed" | "compound"
// ---------------------------------------------------------------------------

const PREPOSED  = new Set(["เ", "แ", "โ", "ใ", "ไ"]);
const ABOVE     = new Set(["ั", "ิ", "ี", "ึ", "ื", "็"]);
const TONE      = new Set(["่", "้", "๊", "๋"]);
const BELOW     = new Set(["ุ", "ู"]);
// ว e ย podem ser vogal final ou consoante final — tratamos como postposed
// dentro de um slot; o lookup de stroke resolve pelo contexto (compound vs consonant)
const POSTPOSED = new Set(["า", "ำ", "ะ", "อ", "ว", "ย", "ๅ"]);
// Especiais funcionam como consoante-âncora do próprio slot
const SPECIAL   = new Set(["ฤ", "ฦ"]);

// English has no multi-char compound vowels; keep Set empty for compatibility.
const COMPOUNDS = new Set();

function charType(ch) {
  if (PREPOSED.has(ch))  return "preposed";
  if (ABOVE.has(ch))     return "above";
  if (TONE.has(ch))      return "tone";
  if (BELOW.has(ch))     return "below";
  if (POSTPOSED.has(ch)) return "postposed";
  if (SPECIAL.has(ch))   return "special";
  return "consonant";
}

// Tenta combinar partes individuais do slot em um composto multi-char.
// Preferência pelo composto mais longo que existe em THAI_VOWEL_TONES.
function resolveCompounds(slot) {
  const preStr   = slot.parts.filter(p => p.type === "preposed").map(p => p.ch).join("");
  const aboveStr = slot.parts.filter(p => p.type === "above").map(p => p.ch).join("");
  const postStr  = slot.parts.filter(p => p.type === "postposed").map(p => p.ch).join("");

  const candidates = [
    preStr + aboveStr + postStr,
    preStr + postStr,
    aboveStr + postStr,
  ]
    .filter(s => s.length > 1 && COMPOUNDS.has(s))
    .sort((a, b) => b.length - a.length); // mais longo primeiro

  if (candidates.length === 0) return;

  const match = candidates[0];
  const matchChars = new Set([...match]);

  // Remove as partes individuais que formam o composto e insere o composto
  slot.parts = slot.parts.filter(p => !matchChars.has(p.ch));
  slot.parts.push({ ch: match, type: "compound" });
}

export function thaiWordDecomposer(word) {
  const chars = [...word]; // spread Unicode-safe (lida com code points >U+FFFF)
  const slots = [];
  let pendingPreposed = [];

  for (const ch of chars) {
    const type = charType(ch);

    if (type === "preposed") {
      pendingPreposed.push(ch);
      continue;
    }

    if (type === "consonant" || type === "special") {
      slots.push({
        consonant: ch,
        parts: pendingPreposed.map(p => ({ ch: p, type: "preposed" })),
        tone: null,
      });
      pendingPreposed = [];
      continue;
    }

    // Diacrítico/vogal sem consoante precedente — descarta silenciosamente
    if (slots.length === 0) continue;

    const slot = slots[slots.length - 1];

    if (type === "tone") {
      slot.tone = ch;
    } else {
      slot.parts.push({ ch, type });
    }
  }

  slots.forEach(resolveCompounds);
  return slots;
}

// ---------------------------------------------------------------------------
// Helpers de lookup de stroke data
// Retorna o entry de stroke do char, independente de qual arquivo ele está.
// ---------------------------------------------------------------------------
const ALL_STROKES = { ...ENGLISH_STROKES };

export function strokesFor(ch) {
  return ALL_STROKES[ch] ?? null;
}

// ---------------------------------------------------------------------------
// #836 — WordLayoutEngine
// Posiciona os strokes de cada slot no canvas em unidades normalizadas.
//
// Output:
//   {
//     groups: [{ char, type, slotIndex, strokes, strokeCount }],
//     totalNormWidth,   // largura total em unidades normalizadas
//     scaleFactor,      // < 1 se a palavra exceder o viewBox padrão
//     needsLandscape,   // true se exceder containerWidth * 0.85 em portrait
//   }
//
// "strokes" em cada group já têm x/y ajustados — prontos para renderizar.
// ---------------------------------------------------------------------------

const VIEWBOX_WIDTH  = 92;   // unidades normalizadas (460px / scale=5)
const SLOT_GAP       = 6;    // espaço entre slots em unidades normalizadas
const PREPOSED_DX    = -30;  // shift x para vogais prepostas (coloca à esq. da consoante)
const CANVAS_SCALE   = 5;    // px por unidade normalizada (igual ao authoring tool)

function shiftStrokes(strokes, dx, dy = 0) {
  if (dx === 0 && dy === 0) return strokes;
  return strokes.map(stroke => stroke.map(([x, y]) => [x + dx, y + dy]));
}

function scaleStrokes(strokes, factor) {
  if (factor === 1) return strokes;
  return strokes.map(stroke => stroke.map(([x, y]) => [x * factor, y * factor]));
}

function strokesBoundingBox(strokesList) {
  let xMin = Infinity, xMax = -Infinity;
  for (const stroke of strokesList) {
    for (const [x] of stroke) {
      if (x < xMin) xMin = x;
      if (x > xMax) xMax = x;
    }
  }
  return { xMin: isFinite(xMin) ? xMin : 0, xMax: isFinite(xMax) ? xMax : 0 };
}

// Monta os grupos de um slot com offsets por tipo de vogal,
// mas SEM o offset cumulativo de slot (aplicado depois).
function buildSlotGroups(slot, slotIndex) {
  const groups = [];

  const push = (ch, type, rawStrokes, dx = 0) => {
    if (!rawStrokes?.length) return;
    groups.push({
      char: ch,
      type,
      slotIndex,
      strokes: shiftStrokes(rawStrokes, dx),
    });
  };

  // Consoante
  const cEntry = strokesFor(slot.consonant);
  if (cEntry) push(slot.consonant, "consonant", cEntry.strokes);

  // Partes (preposed, above, below, postposed, compound)
  for (const part of slot.parts) {
    const entry = strokesFor(part.ch);
    if (!entry) continue;
    const dx = part.type === "preposed" ? PREPOSED_DX : 0;
    push(part.ch, part.type, entry.strokes, dx);
  }

  // Tom
  if (slot.tone) {
    const entry = strokesFor(slot.tone);
    if (entry) push(slot.tone, "tone", entry.strokes);
  }

  return groups;
}

export function wordLayoutEngine(slots, { containerWidth = 460 } = {}) {
  if (!slots.length) return { groups: [], totalNormWidth: 0, scaleFactor: 1, needsLandscape: false };

  // Passo 1 — grupos por slot sem offset cumulativo
  const slotGroups = slots.map((slot, i) => buildSlotGroups(slot, i));

  // Passo 2 — bounding box e largura de cada slot
  const slotWidths = slotGroups.map(groups => {
    const allStrokes = groups.flatMap(g => g.strokes);
    if (!allStrokes.length) return SLOT_GAP;
    const { xMin, xMax } = strokesBoundingBox(allStrokes);
    return (xMax - xMin) + SLOT_GAP;
  });

  // Passo 3 — offsets cumulativos
  const cumX = slotGroups.map((_, i) =>
    slotWidths.slice(0, i).reduce((s, w) => s + w, 0)
  );

  // O primeiro slot pode ter xMin > 0 (consoante começa em x≈12).
  // Normaliza para que o layout todo comece em x=0.
  const firstAllStrokes = slotGroups[0].flatMap(g => g.strokes);
  const globalXMin = firstAllStrokes.length
    ? strokesBoundingBox(firstAllStrokes).xMin
    : 0;
  const normalizeX = -globalXMin;

  // Passo 4 — aplica offset cumulativo + normalização e calcula strokeCount
  const positioned = slotGroups.flatMap((groups, i) =>
    groups.map(g => ({
      ...g,
      strokes: shiftStrokes(g.strokes, cumX[i] + normalizeX),
      strokeCount: g.strokes.length,
    }))
  );

  const totalNormWidth = slotWidths.reduce((s, w) => s + w, 0);

  // Passo 5 — auto-scale se a palavra exceder o viewBox padrão
  const scaleFactor = totalNormWidth > VIEWBOX_WIDTH
    ? VIEWBOX_WIDTH / totalNormWidth
    : 1;

  const finalGroups = scaleFactor < 1
    ? positioned.map(g => ({ ...g, strokes: scaleStrokes(g.strokes, scaleFactor) }))
    : positioned;

  const totalPx = totalNormWidth * scaleFactor * CANVAS_SCALE;
  const needsLandscape = totalPx > containerWidth * 0.85;

  return { groups: finalGroups, totalNormWidth, scaleFactor, needsLandscape };
}

// ---------------------------------------------------------------------------
// #837 — DTWMatcher
// Calcula a similaridade entre uma stroke desenhada e uma stroke de referência.
//
// Ambas as strokes devem estar em unidades normalizadas (mesma escala).
// Retorna score 0–1: 1 = idênticas, 0 = completamente diferentes.
//
// API:
//   dtwMatcher(drawnStroke, refStroke, { maxDist?, n? }) → score
//   resampleStroke(points, n)   — exportado para testes e preview
// ---------------------------------------------------------------------------

const RESAMPLE_N   = 16;   // pontos por stroke — igual ao authoring tool
const MAX_DTW_DIST = 200;  // distância DTW que mapeia para score 0 (tunável)

// Reamostrar uma stroke para n pontos equidistantes ao longo do comprimento de arco.
export function resampleStroke(pts, n = RESAMPLE_N) {
  if (!pts || pts.length === 0) return [];
  if (pts.length === 1) return Array(n).fill(pts[0]);

  // Distâncias cumulativas ao longo do caminho
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i][0] - pts[i - 1][0];
    const dy = pts[i][1] - pts[i - 1][1];
    cum.push(cum[i - 1] + Math.sqrt(dx * dx + dy * dy));
  }
  const total = cum[cum.length - 1];
  if (total === 0) return Array(n).fill(pts[0]);

  const result = [];
  for (let k = 0; k < n; k++) {
    const target = (k / (n - 1)) * total;

    // Busca binária do segmento que contém target
    let lo = 0, hi = cum.length - 2;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cum[mid + 1] < target) lo = mid + 1;
      else hi = mid;
    }

    const segLen = cum[lo + 1] - cum[lo];
    const t = segLen > 0 ? (target - cum[lo]) / segLen : 0;
    result.push([
      pts[lo][0] + t * (pts[lo + 1][0] - pts[lo][0]),
      pts[lo][1] + t * (pts[lo + 1][1] - pts[lo][1]),
    ]);
  }
  return result;
}

// DTW clássico sobre sequências de pontos 2D.
// Retorna o custo total ao longo do caminho ótimo.
function dtwDistance(a, b) {
  const m = a.length, n = b.length;
  // Usa dois arrays (linha anterior e atual) para economizar memória
  let prev = new Float32Array(n).fill(Infinity);
  let curr = new Float32Array(n).fill(Infinity);

  const d = (p, q) => {
    const dx = p[0] - q[0], dy = p[1] - q[1];
    return Math.sqrt(dx * dx + dy * dy);
  };

  prev[0] = d(a[0], b[0]);
  for (let j = 1; j < n; j++) prev[j] = prev[j - 1] + d(a[0], b[j]);

  for (let i = 1; i < m; i++) {
    curr[0] = prev[0] + d(a[i], b[0]);
    for (let j = 1; j < n; j++) {
      curr[j] = d(a[i], b[j]) + Math.min(prev[j], curr[j - 1], prev[j - 1]);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n - 1];
}

// Ponto de entrada principal do #837.
export function dtwMatcher(drawnStroke, refStroke, { maxDist = MAX_DTW_DIST, n = RESAMPLE_N } = {}) {
  if (!drawnStroke?.length || !refStroke?.length) return 0;

  const a = resampleStroke(drawnStroke, n);
  const b = resampleStroke(refStroke,   n);

  const dist = dtwDistance(a, b);
  return Math.max(0, 1 - dist / maxDist);
}

// ---------------------------------------------------------------------------
// #838 — StrokeOrderTracker
// ---------------------------------------------------------------------------
// Recebe os `groups` produzidos por wordLayoutEngine (cada group tem .strokes
// já posicionadas no sistema normalizado) e rastreia o progresso traço-a-traço.
//
// Estado por char-group (criado em _buildState):
//   { char, type, slotIndex, strokes, strokeCount,
//     strokesDone, wrongOrderAttempts, errors, status }
//   status: "pending" | "active" | "done"
//
// onNewStroke(drawnStroke) retorna:
//   { accepted, correct, error, hint, hintStroke?, hintChar?,
//     charDone?, slotDone?, done, unrecognized? }

const SOT_THRESHOLD = 0.72; // score mínimo DTW para reconhecer um traço

export class StrokeOrderTracker {
  constructor(groups, { threshold = SOT_THRESHOLD, maxDist = MAX_DTW_DIST } = {}) {
    this.threshold = threshold;
    this.maxDist   = maxDist;
    this._state    = groups.map(g => ({
      char:               g.char,
      type:               g.type,
      slotIndex:          g.slotIndex,
      strokes:            g.strokes,      // arrays de pontos, já posicionados
      strokeCount:        g.strokeCount,
      strokesDone:        0,
      wrongOrderAttempts: 0,
      errors:             0,
      status:             "pending",
    }));
    this._slotRanges = this._buildSlotRanges();
  }

  // Calcula o intervalo x de cada slot para atribuição espacial.
  _buildSlotRanges() {
    const ranges = {};
    for (const s of this._state) {
      if (!ranges[s.slotIndex]) ranges[s.slotIndex] = { xMin: Infinity, xMax: -Infinity };
      for (const stroke of s.strokes) {
        for (const [x] of stroke) {
          if (x < ranges[s.slotIndex].xMin) ranges[s.slotIndex].xMin = x;
          if (x > ranges[s.slotIndex].xMax) ranges[s.slotIndex].xMax = x;
        }
      }
    }
    return ranges;
  }

  _centroid(stroke) {
    let sx = 0, sy = 0;
    for (const [x, y] of stroke) { sx += x; sy += y; }
    return [sx / stroke.length, sy / stroke.length];
  }

  // Retorna o slotIndex mais próximo do centroide, ou null se fora de todos.
  _assignSlot(cx) {
    const MARGIN = 10;
    let best = null, bestDist = Infinity;
    for (const [idxStr, r] of Object.entries(this._slotRanges)) {
      if (cx < r.xMin - MARGIN || cx > r.xMax + MARGIN) continue;
      const dist = Math.abs(cx - (r.xMin + r.xMax) / 2);
      if (dist < bestDist) { bestDist = dist; best = Number(idxStr); }
    }
    return best;
  }

  // Melhor match entre todos os traços pendentes dos char-groups candidatos.
  // Só considera strokes com índice >= strokesDone (traços ainda não feitos).
  _findBestMatch(drawnStroke, candidates) {
    let bestScore = -1, bestState = null, bestStrokeIdx = -1;
    for (const s of candidates) {
      for (let si = s.strokesDone; si < s.strokes.length; si++) {
        const score = dtwMatcher(drawnStroke, s.strokes[si], { maxDist: this.maxDist });
        if (score > bestScore) { bestScore = score; bestState = s; bestStrokeIdx = si; }
      }
    }
    return bestScore >= this.threshold ? { state: bestState, strokeIdx: bestStrokeIdx, score: bestScore } : null;
  }

  onNewStroke(drawnStroke) {
    if (!drawnStroke?.length) {
      return { accepted: false, correct: false, error: false, hint: false };
    }

    const [cx] = this._centroid(drawnStroke);
    const slotIndex = this._assignSlot(cx);

    // Candidatos: chars do slot atribuído (ou qualquer char, se slotIndex=null)
    const candidates = this._state.filter(s =>
      s.status !== "done" && (slotIndex === null || s.slotIndex === slotIndex)
    );

    if (!candidates.length) {
      return { accepted: false, correct: false, error: false, hint: false };
    }

    const match = this._findBestMatch(drawnStroke, candidates);

    if (!match) {
      return { accepted: false, correct: false, error: false, hint: false, unrecognized: true };
    }

    const { state: s, strokeIdx } = match;
    const inOrder = strokeIdx === s.strokesDone;
    s.status = "active";

    if (inOrder) {
      s.strokesDone++;
      s.wrongOrderAttempts = 0;
      return this._accepted(s, true, false);
    }

    // Ordem errada — 2 chances
    if (s.wrongOrderAttempts === 0) {
      s.wrongOrderAttempts++;
      return {
        accepted:   false,
        correct:    false,
        error:      false,
        hint:       true,
        hintStroke: s.strokes[s.strokesDone],
        hintChar:   s.char,
        done:       false,
        charDone:   null,
        slotDone:   null,
      };
    }

    // Segunda rejeição → registra erro e aceita assim mesmo
    s.wrongOrderAttempts = 0;
    s.errors++;
    s.strokesDone++;
    return this._accepted(s, false, true);
  }

  _accepted(s, correct, error) {
    const charDone = s.strokesDone === s.strokeCount;
    if (charDone) s.status = "done";

    const slotDone = charDone &&
      this._state.filter(g => g.slotIndex === s.slotIndex).every(g => g.status === "done");

    const done = this._state.every(g => g.status === "done");

    return {
      accepted: true,
      correct,
      error,
      hint:     false,
      charDone: charDone  ? s.char       : null,
      slotDone: slotDone  ? s.slotIndex  : null,
      done,
    };
  }

  // Snapshot imutável para React re-render.
  getSnapshot() {
    return this._state.map(s => ({ ...s }));
  }

  // Próximo traço sugerido para hint visual passivo no canvas.
  getNextHint() {
    const active = this._state.find(s => s.status === "active" && s.strokesDone < s.strokeCount);
    if (active) return { char: active.char, stroke: active.strokes[active.strokesDone] };
    const pending = this._state.find(s => s.status === "pending");
    if (pending) return { char: pending.char, stroke: pending.strokes[0] };
    return null;
  }

  // Resumo dos resultados ao concluir.
  getResults() {
    return {
      totalErrors: this._state.reduce((sum, g) => sum + g.errors, 0),
      chars: this._state.map(g => ({
        char:      g.char,
        type:      g.type,
        slotIndex: g.slotIndex,
        errors:    g.errors,
        done:      g.status === "done",
      })),
    };
  }
}

// ---------------------------------------------------------------------------
// #839 — WordWritingCanvas
// ---------------------------------------------------------------------------
// Componente React que integra os 4 layers anteriores num canvas interativo.
//
// Props:
//   word           {string}   — palavra Thai a escrever
//   containerWidth {number}   — largura disponível em px (para needsLandscape)
//   onComplete     {function} — callback(results) ao concluir todos os traços
//
// Coordenadas: pointer events → canvas pixel → unidade normalizada (÷ WW_SCALE)
// Canvas px width  = WW_W_NORM × WW_SCALE = 92 × 5 = 460 px
// Canvas px height = computado do bounding box real dos grupos + padding

const WW_SCALE  = 5;   // px por unidade normalizada
const WW_W_NORM = 92;  // largura do viewbox em unidades norm.

export function WordWritingCanvas({ word, containerWidth = 460, onComplete }) {
  const canvasRef  = useRef(null);
  const trackerRef = useRef(null);
  const layoutRef  = useRef(null);

  const [snapshot,         setSnapshot]         = useState([]);
  const [completedStrokes, setCompletedStrokes] = useState([]); // {points,correct,error}
  const [activeStroke,     setActiveStroke]     = useState(null);
  const [hintState,        setHintState]        = useState(null); // {hintStroke,hintChar}
  const [needsLandscape,   setNeedsLandscape]   = useState(false);
  const [isDone,           setIsDone]           = useState(false);

  // Inicializa tracker e layout quando a palavra muda
  useEffect(() => {
    if (!word) return;
    const slots  = thaiWordDecomposer(word);
    const layout = wordLayoutEngine(slots, { containerWidth });
    layoutRef.current  = layout;
    trackerRef.current = new StrokeOrderTracker(layout.groups);
    setNeedsLandscape(layout.needsLandscape);
    setSnapshot(trackerRef.current.getSnapshot());
    setCompletedStrokes([]);
    setActiveStroke(null);
    setHintState(null);
    setIsDone(false);
  }, [word, containerWidth]);

  // Redesenha o canvas quando qualquer estado visual muda
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !layoutRef.current) return;
    const ctx    = canvas.getContext("2d");
    const S      = WW_SCALE;
    const groups = layoutRef.current.groups;

    // Ajusta altura ao bounding box real dos grupos
    const allY = groups.flatMap(g => g.strokes.flatMap(s => s.map(([, y]) => y)));
    if (allY.length) canvas.height = Math.ceil(Math.max(...allY) + 16) * S;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 1 — Traços de referência (guias acinzentadas)
    for (const g of groups) {
      const st   = snapshot.find(s => s.char === g.char && s.slotIndex === g.slotIndex);
      const done = st?.strokesDone ?? 0;
      for (let si = 0; si < g.strokes.length; si++) {
        if (si < done) continue; // coberto pelos completados
        ctx.strokeStyle = si === done ? "rgba(0,0,0,0.13)" : "rgba(0,0,0,0.05)";
        ctx.lineWidth   = 2.5;
        ctx.lineCap     = "round";
        ctx.lineJoin    = "round";
        ctx.setLineDash([]);
        _path(ctx, g.strokes[si], S);
      }
    }

    // 2 — Traços completados (verde=correto, vermelho=erro)
    for (const cs of completedStrokes) {
      ctx.strokeStyle = cs.error ? "#c53030" : "#276749";
      ctx.lineWidth   = 3.5;
      ctx.lineCap     = "round";
      ctx.lineJoin    = "round";
      ctx.setLineDash([]);
      _path(ctx, cs.points, S);
    }

    // 3 — Traço ativo em andamento (azul)
    if (activeStroke?.length > 1) {
      ctx.strokeStyle = "#2b6cb0";
      ctx.lineWidth   = 3.5;
      ctx.lineCap     = "round";
      ctx.lineJoin    = "round";
      ctx.setLineDash([]);
      _path(ctx, activeStroke, S);
    }

    // 4 — Hint tracejado (amarelo) quando ordem errada na 1ª tentativa
    if (hintState?.hintStroke?.length) {
      ctx.strokeStyle = "#d69e2e";
      ctx.lineWidth   = 3;
      ctx.lineCap     = "round";
      ctx.lineJoin    = "round";
      ctx.setLineDash([7, 5]);
      _path(ctx, hintState.hintStroke, S);
      ctx.setLineDash([]);
    }
  }, [snapshot, completedStrokes, activeStroke, hintState]);

  // Converte coordenadas de pointer event → unidade normalizada
  function _toNorm(e) {
    const canvas = canvasRef.current;
    const rect   = canvas.getBoundingClientRect();
    return [
      (e.clientX - rect.left) * (canvas.width  / rect.width)  / WW_SCALE,
      (e.clientY - rect.top)  * (canvas.height / rect.height) / WW_SCALE,
    ];
  }

  // Desenha um array de pontos como polyline
  function _path(ctx, pts, S) {
    if (!pts?.length) return;
    ctx.beginPath();
    ctx.moveTo(pts[0][0] * S, pts[0][1] * S);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0] * S, pts[i][1] * S);
    ctx.stroke();
  }

  function handlePointerDown(e) {
    if (isDone) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setActiveStroke([_toNorm(e)]);
  }

  function handlePointerMove(e) {
    if (!activeStroke) return;
    setActiveStroke(prev => [...prev, _toNorm(e)]);
  }

  function handlePointerUp() {
    if (!activeStroke?.length) return;
    const stroke = activeStroke;
    setActiveStroke(null);

    const result = trackerRef.current.onNewStroke(stroke);
    setSnapshot(trackerRef.current.getSnapshot());

    if (result.accepted) {
      setCompletedStrokes(prev => [...prev, {
        points:  stroke,
        correct: result.correct,
        error:   result.error,
      }]);
      setHintState(null);
      if (result.done) {
        setIsDone(true);
        onComplete?.(trackerRef.current.getResults());
      }
    } else if (result.hint) {
      setHintState({ hintStroke: result.hintStroke, hintChar: result.hintChar });
    }
    // unrecognized → silencioso (traço ativo já desapareceu)
  }

  return (
    <div className="ww-root" style={{ position: "relative", display: "inline-block" }}>

      {/* Overlay: solicita modo paisagem em mobile */}
      {needsLandscape && !isDone && (
        <div style={{
          position: "absolute", inset: 0, zIndex: 10,
          display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center", gap: 8, padding: 16,
          background: "rgba(255,255,255,0.93)", borderRadius: 8,
          textAlign: "center",
        }}>
          <span style={{ fontSize: 32 }}>📱↔️</span>
          <p style={{ margin: 0, fontSize: 14, color: "#4a5568" }}>
            Vire o dispositivo para o modo paisagem para escrever esta palavra.
          </p>
        </div>
      )}

      {/* Banner: palavra concluída */}
      {isDone && (
        <div style={{
          position: "absolute", top: 8, left: "50%", transform: "translateX(-50%)",
          background: "#276749", color: "#fff",
          padding: "4px 16px", borderRadius: 20,
          fontSize: 13, fontWeight: 600, zIndex: 10, whiteSpace: "nowrap",
        }}>
          Palavra concluída!
        </div>
      )}

      {/* Label de hint: indica por qual char começar */}
      {hintState && !isDone && (
        <div style={{
          position: "absolute", top: 8, right: 8, zIndex: 10,
          background: "#f6e05e", color: "#744210",
          padding: "3px 10px", borderRadius: 12,
          fontSize: 12, fontWeight: 600,
        }}>
          Comece por: {hintState.hintChar}
        </div>
      )}

      <canvas
        ref={canvasRef}
        width={WW_W_NORM * WW_SCALE}
        height={110 * WW_SCALE}
        className="ww-canvas"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        style={{
          display:     "block",
          touchAction: "none",
          cursor:      isDone ? "default" : "crosshair",
          border:      "1px solid #e2e8f0",
          borderRadius: 8,
          maxWidth:    "100%",
        }}
      />
    </div>
  );
}
