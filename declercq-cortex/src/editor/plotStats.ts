// plotStats — Cluster 27 v1.0 pass 2.
//
// Lightweight statistics helpers for the statistical plot types
// (ECDF, Q-Q, Bland-Altman, regression with CI band, residual) and
// trendline overlays. Everything is plain JS — no native deps, no
// runtime allocations beyond the result arrays. Inputs are expected
// to be finite numbers; callers should pre-filter null/NaN.

// =====================================================================
// Descriptive statistics
// =====================================================================

/** Sample mean. Returns NaN for empty input. */
export function mean(values: number[]): number {
  if (values.length === 0) return NaN;
  let s = 0;
  for (const v of values) s += v;
  return s / values.length;
}

/** Sample standard deviation (n - 1). Returns NaN for n < 2. */
export function stdev(values: number[]): number {
  if (values.length < 2) return NaN;
  const m = mean(values);
  let s = 0;
  for (const v of values) s += (v - m) * (v - m);
  return Math.sqrt(s / (values.length - 1));
}

/** Sample median. Returns NaN for empty input. */
export function median(values: number[]): number {
  if (values.length === 0) return NaN;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/** Quantile of a sorted ascending array, in [0, 1]. */
export function quantileSorted(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  if (q <= 0) return sorted[0];
  if (q >= 1) return sorted[sorted.length - 1];
  const idx = q * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

// =====================================================================
// Normal distribution helpers (for Q-Q plot vs normal + CI bands)
// =====================================================================

/**
 * Inverse of the standard-normal CDF (probit function). Uses the
 * Beasley-Springer-Moro approximation; accurate to ~1e-9 in (0, 1).
 * Returns ±Infinity at the endpoints. Source: Wichura 1988 / Acklam.
 */
export function normalInvCdf(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  // Acklam's algorithm — coefficients for the rational approximation.
  const a = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
    1.38357751867269e2, -3.066479806614716e1, 2.506628277459239,
  ];
  const b = [
    -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
    6.680131188771972e1, -1.328068155288572e1,
  ];
  const c = [
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838,
    -2.549732539343734, 4.374664141464968, 2.938163982698783,
  ];
  const d = [
    7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996,
    3.754408661907416,
  ];
  const pLow = 0.02425;
  const pHigh = 1 - pLow;
  let q: number, r: number, x: number;
  if (p < pLow) {
    q = Math.sqrt(-2 * Math.log(p));
    x =
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  } else if (p <= pHigh) {
    q = p - 0.5;
    r = q * q;
    x =
      ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) *
        q) /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  } else {
    q = Math.sqrt(-2 * Math.log(1 - p));
    x =
      -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  return x;
}

// =====================================================================
// Regression
// =====================================================================

export type RegressionKind =
  | "linear"
  | "poly2"
  | "poly3"
  | "exponential"
  | "log"
  | "power"
  // Pass 3.8 — Excel-style "best fit": tries every candidate and
  // returns the one with the highest R². Routed through `findBestFit`
  // by `fitRegression`. The RegressionFit returned has its real
  // `kind` (e.g. "poly2") so the legend equation reads as the
  // chosen curve, not "auto".
  | "auto";

export interface RegressionFit {
  /** Polynomial coefficients in ASCENDING power order (c0 + c1·x + c2·x² ...).
   *  For non-poly kinds, captured-in-c0 transform is documented per-fn. */
  coefficients: number[];
  /** R² (coefficient of determination) against the original y values. */
  r2: number;
  /** Human-readable equation for the legend. */
  equation: string;
  /** Residual standard error (sqrt of mean squared residual); used to
   *  size the prediction-band envelope. */
  residualStdErr: number;
  /** Sample size used. */
  n: number;
  /** The kind of fit, echoed back for downstream branching. */
  kind: RegressionKind;
}

/**
 * Fit a polynomial of degree `degree` to (x, y) pairs by solving the
 * normal equations directly (Gaussian elimination). Handles small
 * matrices (≤ 4×4 typical for our use) without external deps.
 *
 * Returns null when the system is singular (e.g. fewer points than
 * coefficients, or perfectly collinear x values).
 */
export function fitPolynomial(
  xs: number[],
  ys: number[],
  degree: number,
): RegressionFit | null {
  const n = Math.min(xs.length, ys.length);
  const k = degree + 1; // number of coefficients
  if (n < k) return null;
  // Build the (k × k) normal-equation matrix A and (k × 1) vector b.
  // A[i][j] = Σ x^(i+j), b[i] = Σ x^i · y.
  const A: number[][] = Array.from({ length: k }, () =>
    Array<number>(k).fill(0),
  );
  const b: number[] = Array<number>(k).fill(0);
  // Precompute powers of x up to 2k - 2 for efficiency.
  for (let p = 0; p < n; p++) {
    const x = xs[p];
    const y = ys[p];
    const pow: number[] = Array<number>(2 * k - 1);
    pow[0] = 1;
    for (let i = 1; i < pow.length; i++) pow[i] = pow[i - 1] * x;
    for (let i = 0; i < k; i++) {
      b[i] += pow[i] * y;
      for (let j = 0; j < k; j++) {
        A[i][j] += pow[i + j];
      }
    }
  }
  const coeffs = solveLinearSystem(A, b);
  if (!coeffs) return null;
  // Compute R² and residual SE.
  const yMean = mean(ys);
  let ssRes = 0;
  let ssTot = 0;
  for (let i = 0; i < n; i++) {
    const yi = ys[i];
    const yhat = evaluatePolynomial(coeffs, xs[i]);
    ssRes += (yi - yhat) * (yi - yhat);
    ssTot += (yi - yMean) * (yi - yMean);
  }
  const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 1;
  const residualStdErr = n > k ? Math.sqrt(ssRes / (n - k)) : 0;
  return {
    coefficients: coeffs,
    r2,
    equation: polynomialEquation(coeffs),
    residualStdErr,
    n,
    kind: degree === 1 ? "linear" : degree === 2 ? "poly2" : "poly3",
  };
}

/**
 * Exponential fit y = a · e^(b·x). Linearised via log(y) = log(a) + b·x
 * and solved as a linear regression. Requires y > 0.
 */
export function fitExponential(
  xs: number[],
  ys: number[],
): RegressionFit | null {
  const validX: number[] = [];
  const validLogY: number[] = [];
  for (let i = 0; i < xs.length; i++) {
    if (ys[i] > 0 && Number.isFinite(ys[i]) && Number.isFinite(xs[i])) {
      validX.push(xs[i]);
      validLogY.push(Math.log(ys[i]));
    }
  }
  const lin = fitPolynomial(validX, validLogY, 1);
  if (!lin) return null;
  const [logA, b] = lin.coefficients;
  const a = Math.exp(logA);
  // Recompute R² on the original (un-transformed) scale.
  let ssRes = 0;
  let ssTot = 0;
  const yMean = mean(ys);
  for (let i = 0; i < xs.length; i++) {
    const yhat = a * Math.exp(b * xs[i]);
    ssRes += (ys[i] - yhat) * (ys[i] - yhat);
    ssTot += (ys[i] - yMean) * (ys[i] - yMean);
  }
  const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 1;
  return {
    coefficients: [a, b],
    r2,
    equation: `y = ${formatNum(a)} · e^(${formatNum(b)}·x)`,
    residualStdErr: lin.residualStdErr, // approximate (log-scale)
    n: validX.length,
    kind: "exponential",
  };
}

/** Log fit y = a + b · ln(x). Requires x > 0. */
export function fitLog(xs: number[], ys: number[]): RegressionFit | null {
  const validLogX: number[] = [];
  const validY: number[] = [];
  for (let i = 0; i < xs.length; i++) {
    if (xs[i] > 0 && Number.isFinite(xs[i]) && Number.isFinite(ys[i])) {
      validLogX.push(Math.log(xs[i]));
      validY.push(ys[i]);
    }
  }
  const lin = fitPolynomial(validLogX, validY, 1);
  if (!lin) return null;
  return {
    coefficients: lin.coefficients,
    r2: lin.r2,
    equation: `y = ${formatNum(lin.coefficients[0])} + ${formatNum(lin.coefficients[1])}·ln(x)`,
    residualStdErr: lin.residualStdErr,
    n: validLogX.length,
    kind: "log",
  };
}

/** Power fit y = a · x^b. Requires x, y > 0. */
export function fitPower(xs: number[], ys: number[]): RegressionFit | null {
  const validLogX: number[] = [];
  const validLogY: number[] = [];
  for (let i = 0; i < xs.length; i++) {
    if (
      xs[i] > 0 &&
      ys[i] > 0 &&
      Number.isFinite(xs[i]) &&
      Number.isFinite(ys[i])
    ) {
      validLogX.push(Math.log(xs[i]));
      validLogY.push(Math.log(ys[i]));
    }
  }
  const lin = fitPolynomial(validLogX, validLogY, 1);
  if (!lin) return null;
  const [logA, b] = lin.coefficients;
  const a = Math.exp(logA);
  let ssRes = 0;
  let ssTot = 0;
  const yMean = mean(ys);
  for (let i = 0; i < xs.length; i++) {
    if (xs[i] <= 0) continue;
    const yhat = a * Math.pow(xs[i], b);
    ssRes += (ys[i] - yhat) * (ys[i] - yhat);
    ssTot += (ys[i] - yMean) * (ys[i] - yMean);
  }
  const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 1;
  return {
    coefficients: [a, b],
    r2,
    equation: `y = ${formatNum(a)} · x^${formatNum(b)}`,
    residualStdErr: lin.residualStdErr,
    n: validLogX.length,
    kind: "power",
  };
}

/** Dispatcher: pick the right fitter for the requested regression kind. */
export function fitRegression(
  xs: number[],
  ys: number[],
  kind: RegressionKind,
): RegressionFit | null {
  switch (kind) {
    case "linear":
      return fitPolynomial(xs, ys, 1);
    case "poly2":
      return fitPolynomial(xs, ys, 2);
    case "poly3":
      return fitPolynomial(xs, ys, 3);
    case "exponential":
      return fitExponential(xs, ys);
    case "log":
      return fitLog(xs, ys);
    case "power":
      return fitPower(xs, ys);
    case "auto":
      return findBestFit(xs, ys);
  }
}

/**
 * Pass 3.8 — Excel-style "best fit". Tries every candidate kind, drops
 * the ones that fail to converge (singular system, domain violations
 * like log of a negative number), and returns the one with the
 * highest R². Ties broken by simplicity (linear > poly2 > poly3 >
 * everything else). Returns null when no candidate produces a fit
 * (e.g. fewer than 2 valid points).
 */
export function findBestFit(xs: number[], ys: number[]): RegressionFit | null {
  // Simplicity ranking (lower = preferred when R² is tied).
  const SIMPLICITY: Record<Exclude<RegressionKind, "auto">, number> = {
    linear: 0,
    poly2: 1,
    poly3: 2,
    exponential: 3,
    log: 4,
    power: 5,
  };
  const candidates: Array<Exclude<RegressionKind, "auto">> = [
    "linear",
    "poly2",
    "poly3",
    "exponential",
    "log",
    "power",
  ];
  let best: RegressionFit | null = null;
  for (const kind of candidates) {
    const fit = fitRegression(xs, ys, kind);
    if (!fit) continue;
    if (!Number.isFinite(fit.r2)) continue;
    if (
      !best ||
      fit.r2 > best.r2 + 1e-6 ||
      (Math.abs(fit.r2 - best.r2) < 1e-6 &&
        SIMPLICITY[kind] <
          SIMPLICITY[best.kind as Exclude<RegressionKind, "auto">])
    ) {
      best = fit;
    }
  }
  return best;
}

/** Evaluate a polynomial (ASCending coefficient order) at x. */
export function evaluatePolynomial(coeffs: number[], x: number): number {
  // Horner's method.
  let y = 0;
  for (let i = coeffs.length - 1; i >= 0; i--) y = y * x + coeffs[i];
  return y;
}

/** Evaluate the regression fit at x for any RegressionKind. */
export function evaluateFit(fit: RegressionFit, x: number): number {
  switch (fit.kind) {
    case "linear":
    case "poly2":
    case "poly3":
      return evaluatePolynomial(fit.coefficients, x);
    case "exponential": {
      const [a, b] = fit.coefficients;
      return a * Math.exp(b * x);
    }
    case "log": {
      const [a, b] = fit.coefficients;
      return a + b * Math.log(x);
    }
    case "power": {
      const [a, b] = fit.coefficients;
      return a * Math.pow(x, b);
    }
  }
}

// =====================================================================
// Linear-system solver (Gaussian elimination with partial pivoting)
// =====================================================================

function solveLinearSystem(A: number[][], b: number[]): number[] | null {
  const n = A.length;
  // Build augmented matrix [A | b].
  const M: number[][] = A.map((row, i) => [...row, b[i]]);
  // Forward elimination with partial pivoting.
  for (let i = 0; i < n; i++) {
    let pivot = i;
    for (let r = i + 1; r < n; r++) {
      if (Math.abs(M[r][i]) > Math.abs(M[pivot][i])) pivot = r;
    }
    if (pivot !== i) [M[i], M[pivot]] = [M[pivot], M[i]];
    if (Math.abs(M[i][i]) < 1e-12) return null; // singular
    for (let r = i + 1; r < n; r++) {
      const factor = M[r][i] / M[i][i];
      for (let c = i; c <= n; c++) M[r][c] -= factor * M[i][c];
    }
  }
  // Back-substitution.
  const x = Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = M[i][n];
    for (let c = i + 1; c < n; c++) s -= M[i][c] * x[c];
    x[i] = s / M[i][i];
  }
  return x;
}

// =====================================================================
// Confidence band for regression — simple ± k · residualStdErr envelope
// =====================================================================

/**
 * Generate a (lower, upper) prediction band around a regression fit
 * across a domain. Uses a SIMPLE constant-width envelope at
 * `kSigma · residualStdErr` (default k = 1.96 ≈ 95% Gaussian
 * confidence). Not as tight as the proper hat-matrix-based CI, but
 * close enough for visual purposes and ~10x cheaper to compute.
 */
export function regressionBand(
  fit: RegressionFit,
  xs: number[],
  kSigma: number = 1.96,
  pointCount: number = 40,
): Array<{ x: number; y: number; lo: number; hi: number }> {
  if (xs.length === 0) return [];
  let xMin = Infinity;
  let xMax = -Infinity;
  for (const x of xs) {
    if (x < xMin) xMin = x;
    if (x > xMax) xMax = x;
  }
  if (!Number.isFinite(xMin) || xMin === xMax) return [];
  const out: Array<{ x: number; y: number; lo: number; hi: number }> = [];
  const margin = kSigma * fit.residualStdErr;
  for (let i = 0; i < pointCount; i++) {
    const t = i / (pointCount - 1);
    const x = xMin + t * (xMax - xMin);
    const y = evaluateFit(fit, x);
    out.push({ x, y, lo: y - margin, hi: y + margin });
  }
  return out;
}

// =====================================================================
// Bland-Altman helpers
// =====================================================================

export interface BlandAltmanStats {
  /** Mean of the differences (bias). */
  meanDiff: number;
  /** SD of the differences. */
  sdDiff: number;
  /** 95% limits of agreement (mean ± 1.96·sd). */
  lower: number;
  upper: number;
  /** Per-pair points: x = (m1+m2)/2, y = m1 − m2. */
  points: Array<{ x: number; y: number }>;
}

export function blandAltman(m1: number[], m2: number[]): BlandAltmanStats {
  const n = Math.min(m1.length, m2.length);
  const diffs: number[] = [];
  const points: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(m1[i]) || !Number.isFinite(m2[i])) continue;
    const d = m1[i] - m2[i];
    diffs.push(d);
    points.push({ x: (m1[i] + m2[i]) / 2, y: d });
  }
  const md = mean(diffs);
  const sd = stdev(diffs);
  return {
    meanDiff: md,
    sdDiff: sd,
    lower: md - 1.96 * sd,
    upper: md + 1.96 * sd,
    points,
  };
}

// =====================================================================
// Formatting helpers
// =====================================================================

export function formatNum(n: number, digits: number = 4): string {
  if (!Number.isFinite(n)) return "—";
  if (n === 0) return "0";
  const abs = Math.abs(n);
  if (abs < 0.001 || abs >= 1e6) return n.toExponential(2);
  // Strip trailing zeros for clean display.
  return parseFloat(n.toFixed(digits)).toString();
}

function polynomialEquation(coeffs: number[]): string {
  const parts: string[] = [];
  for (let i = coeffs.length - 1; i >= 0; i--) {
    const c = coeffs[i];
    if (Math.abs(c) < 1e-12) continue;
    const sign =
      parts.length === 0 ? (c < 0 ? "-" : "") : c < 0 ? " - " : " + ";
    const magnitude = formatNum(Math.abs(c));
    const term =
      i === 0 ? magnitude : i === 1 ? `${magnitude}·x` : `${magnitude}·x^${i}`;
    parts.push(sign + term);
  }
  if (parts.length === 0) return "y = 0";
  return "y = " + parts.join("");
}
