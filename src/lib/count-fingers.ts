export type Point = { x: number; y: number };

const TIP = { thumb: 4, index: 8, middle: 12, ring: 16, pinky: 20 } as const;
const PIP = { thumb: 3, index: 6, middle: 10, ring: 14, pinky: 18 } as const;
const MCP = { thumb: 2, index: 5, middle: 9, ring: 13, pinky: 17 } as const;
const WRIST = 0;

function dist(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n));
}

function extended(landmarks: Point[], tip: number, pip: number, mcp: number, lenient: boolean) {
  const wrist = landmarks[WRIST];
  const t = landmarks[tip];
  const p = landmarks[pip];
  const m = landmarks[mcp];
  if (!wrist || !t || !p || !m) return false;
  const tipW = dist(t, wrist);
  const pipW = dist(p, wrist);
  const mcpW = dist(m, wrist);
  const beyondPip = tipW > pipW * (lenient ? 1.02 : 1.08);
  const beyondMcp = tipW > mcpW * (lenient ? 1.08 : 1.18);
  return beyondPip && beyondMcp;
}

/** 0–1 how straight/extended a finger is (wrist–tip vs wrist–mcp). */
function strength(landmarks: Point[], tip: number, mcp: number) {
  const wrist = landmarks[WRIST];
  const t = landmarks[tip];
  const m = landmarks[mcp];
  if (!wrist || !t || !m) return 0;
  const ratio = dist(t, wrist) / Math.max(dist(m, wrist), 1e-6);
  return clamp((ratio - 1) / 0.65, 0, 1);
}

export function countRaisedFingers(landmarks: Point[]): number {
  if (landmarks.length < 21) return 0;

  const strict = {
    thumb: extended(landmarks, TIP.thumb, PIP.thumb, MCP.thumb, false),
    index: extended(landmarks, TIP.index, PIP.index, MCP.index, false),
    middle: extended(landmarks, TIP.middle, PIP.middle, MCP.middle, false),
    ring: extended(landmarks, TIP.ring, PIP.ring, MCP.ring, false),
    pinky: extended(landmarks, TIP.pinky, PIP.pinky, MCP.pinky, false),
  };

  let n =
    Number(strict.thumb) +
    Number(strict.index) +
    Number(strict.middle) +
    Number(strict.ring) +
    Number(strict.pinky);

  if (n === 0) {
    n =
      Number(extended(landmarks, TIP.thumb, PIP.thumb, MCP.thumb, true)) +
      Number(extended(landmarks, TIP.index, PIP.index, MCP.index, true)) +
      Number(extended(landmarks, TIP.middle, PIP.middle, MCP.middle, true)) +
      Number(extended(landmarks, TIP.ring, PIP.ring, MCP.ring, true)) +
      Number(extended(landmarks, TIP.pinky, PIP.pinky, MCP.pinky, true));
  }

  if (n === 3 && strict.index && strict.middle && !strict.thumb) {
    n = 2;
  }

  return n;
}

export function qualifyingCount(n: number): 1 | 2 | null {
  if (n === 1 || n === 2) return n;
  return null;
}

/** Local 0–100 score for a 1- or 2-finger pose. Higher = clearer raise, others more folded. */
export function poseConfidence(landmarks: Point[], count: 1 | 2): number {
  if (landmarks.length < 21) return 0;
  const thumb = strength(landmarks, TIP.thumb, MCP.thumb);
  const index = strength(landmarks, TIP.index, MCP.index);
  const middle = strength(landmarks, TIP.middle, MCP.middle);
  const ring = strength(landmarks, TIP.ring, MCP.ring);
  const pinky = strength(landmarks, TIP.pinky, MCP.pinky);

  const target = count === 1 ? index : (index + middle) / 2;
  const extra = count === 1 ? (middle + ring + pinky + thumb) / 4 : (ring + pinky + thumb) / 3;
  const clarity = target * (1 - extra * 0.75);

  const wrist = landmarks[WRIST];
  const span = wrist ? dist(wrist, landmarks[MCP.middle] ?? wrist) : 0;
  const size = clamp((span - 0.08) / 0.22, 0, 1);

  return Math.round(clamp(clarity * 78 + size * 22, 1, 99));
}
