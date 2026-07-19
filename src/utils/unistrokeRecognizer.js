// $1 Unistroke Recognizer (Wobbrock, Wilson & Li, 2007) — Issue #61.
//
// Adapted here to SCORE one drawn stroke against one reference stroke (not
// classify among many candidate templates, which is the algorithm's usual
// job). Pure math, no DOM/React — testable standalone.
//
// Deliberately keeps the algorithm's classic ±45° rotation search instead of
// making it fully rotation-invariant: Thai consonant strokes are direction/
// orientation sensitive (a stroke drawn upside-down, or rotated 90°, must
// fail), while natural hand tilt of a few degrees either way should still
// pass. See docs/decisions.md ADR-020 for threshold calibration notes.

const N_RESAMPLE_POINTS = 64;
const SQUARE_SIZE = 250;
const ANGLE_RANGE = 45 * (Math.PI / 180);
const ANGLE_PRECISION = 2 * (Math.PI / 180);
const PHI = 0.5 * (-1 + Math.sqrt(5)); // golden ratio, for the golden-section search

function distance(a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  return Math.sqrt(dx * dx + dy * dy);
}

function pathLength(points) {
  let d = 0;
  for (let i = 1; i < points.length; i++) d += distance(points[i - 1], points[i]);
  return d;
}

// Resamples an arbitrary-length point array into exactly `n` evenly
// (arc-length) spaced points.
export function resample(points, n = N_RESAMPLE_POINTS) {
  if (!points || points.length < 2) return null;
  const I = pathLength(points) / (n - 1);
  if (I === 0) return null; // degenerate (all points identical) — nothing to resample
  let D = 0;
  const newPoints = [points[0]];
  const pts = points.slice();
  for (let i = 1; i < pts.length; i++) {
    const d = distance(pts[i - 1], pts[i]);
    if (D + d >= I) {
      const t = (I - D) / d;
      const q = [
        pts[i - 1][0] + t * (pts[i][0] - pts[i - 1][0]),
        pts[i - 1][1] + t * (pts[i][1] - pts[i - 1][1]),
      ];
      newPoints.push(q);
      pts.splice(i, 0, q);
      D = 0;
    } else {
      D += d;
    }
  }
  // Occasionally falls a rounding-error short of n points — pad with the last point.
  while (newPoints.length < n) newPoints.push(points[points.length - 1]);
  return newPoints.slice(0, n);
}

function centroid(points) {
  let x = 0;
  let y = 0;
  points.forEach(([px, py]) => { x += px; y += py; });
  return [x / points.length, y / points.length];
}

function rotateBy(points, radians) {
  const c = centroid(points);
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return points.map(([x, y]) => [
    (x - c[0]) * cos - (y - c[1]) * sin + c[0],
    (x - c[0]) * sin + (y - c[1]) * cos + c[1],
  ]);
}

function boundingBox(points) {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

function scaleToSquare(points, size = SQUARE_SIZE) {
  const box = boundingBox(points);
  const w = box.maxX - box.minX || 1;
  const h = box.maxY - box.minY || 1;
  return points.map(([x, y]) => [(x - box.minX) * (size / w), (y - box.minY) * (size / h)]);
}

function translateToOrigin(points) {
  const c = centroid(points);
  return points.map(([x, y]) => [x - c[0], y - c[1]]);
}

function pathDistance(pts1, pts2) {
  let d = 0;
  for (let i = 0; i < pts1.length; i++) d += distance(pts1[i], pts2[i]);
  return d / pts1.length;
}

function distanceAtAngle(points, template, radians) {
  return pathDistance(rotateBy(points, radians), template);
}

// Golden-section search for the rotation (within [a, b]) that minimizes the
// point-to-point distance between `points` and `template`.
function distanceAtBestAngle(points, template, a, b, threshold) {
  let x1 = PHI * a + (1 - PHI) * b;
  let f1 = distanceAtAngle(points, template, x1);
  let x2 = (1 - PHI) * a + PHI * b;
  let f2 = distanceAtAngle(points, template, x2);
  while (Math.abs(b - a) > threshold) {
    if (f1 < f2) {
      b = x2; x2 = x1; f2 = f1;
      x1 = PHI * a + (1 - PHI) * b;
      f1 = distanceAtAngle(points, template, x1);
    } else {
      a = x1; x1 = x2; f1 = f2;
      x2 = (1 - PHI) * a + PHI * b;
      f2 = distanceAtAngle(points, template, x2);
    }
  }
  return Math.min(f1, f2);
}

// Runs the normalization pipeline on a raw [x,y] point array: resample →
// scale-to-square → translate-to-origin.
//
// NOTE — deliberately SKIPS the classic $1 "rotate to indicative angle"
// step. That step subtracts each stroke's own centroid→first-point angle,
// which is a *rigid* transform: it always exactly cancels out whatever
// rotation was applied to a point set, for ANY shape, symmetric or not
// (rotating a point set by θ rotates its centroid→first-point vector by
// that same θ). Two independently "zeroed" copies of the same shape end up
// aligned regardless of how far apart their original orientations were —
// which is exactly what a shape-classifier wants, but exactly what we don't
// want: a Thai stroke drawn upside-down or rotated 90° must fail, since
// stroke direction/orientation is part of correct calligraphy. Skipping
// this step keeps absolute orientation meaningful; scoreStroke()'s ±45°
// search then only tolerates natural hand tilt, not arbitrary rotation.
// Returns null if the input is too degenerate to normalize (e.g. a single
// point, or a zero-length stroke — treat as "no match").
export function normalizeStroke(rawPoints) {
  const resampled = resample(rawPoints);
  if (!resampled) return null;
  const scaled = scaleToSquare(resampled);
  return translateToOrigin(scaled);
}

// Scores a normalized drawn stroke against a normalized template stroke.
// Returns 0..1 (1 = perfect match). Both inputs must already be normalized
// via normalizeStroke() and have the same point count.
export function scoreStroke(normalizedDrawn, normalizedTemplate) {
  if (!normalizedDrawn || !normalizedTemplate) return 0;
  const d = distanceAtBestAngle(normalizedDrawn, normalizedTemplate, -ANGLE_RANGE, ANGLE_RANGE, ANGLE_PRECISION);
  const halfDiagonal = 0.5 * Math.sqrt(SQUARE_SIZE * SQUARE_SIZE + SQUARE_SIZE * SQUARE_SIZE);
  return Math.max(0, 1 - d / halfDiagonal);
}
