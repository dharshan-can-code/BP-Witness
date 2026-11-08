// Posture checks. Each takes MediaPipe pose landmarks (x, y from 0 to 1, y grows downward)
// and returns { status: "ok" | "bad" | "unknown", detail }.
// "unknown" means the camera can't see the body parts it needs. That is never counted as a mistake.
//
// All tuning numbers live in T. Test with real people and adjust them.

export const T = {
  minVisibility: 0.5,     // ignore landmarks MediaPipe isn't confident about
  maxTorsoLeanDeg: 20,    // more than this from vertical = leaning forward
  maxAnkleHeightDiff: 0.35, // ankles at different heights, as a fraction of shin length
  maxKneeHeightDiff: 0.3,   // knees at different heights (knee over knee)
  minAnkleCross: 0.15,      // ankles swapped sides, as a fraction of shin length
  maxForearmDown: 0.85,     // forearm pointing almost straight down = arm hanging
  maxCuffDrop: 0.5,         // cuff lower than this fraction of shoulder-to-hip = too low
  maxMotion: 0.012,         // average movement per frame (fraction of torso length)
  holdMs: 1500,             // a problem must last this long before it is flagged
  clearMs: 600,             // and must be gone this long before it turns green again
};

// MediaPipe pose landmark numbers
const P = {
  left: { shoulder: 11, elbow: 13, wrist: 15, hip: 23, knee: 25, ankle: 27 },
  right: { shoulder: 12, elbow: 14, wrist: 16, hip: 24, knee: 26, ankle: 28 },
};

// MediaPipe gives x as a fraction of the frame's width and y as a fraction of its height.
// On a 16:9 camera those units differ, which bends every angle and distance.
// This rescales x so both axes use the same unit (fractions of the frame height).
export function toSquare(lm, aspect) {
  return lm.map((p) => ({ ...p, x: p.x * aspect }));
}

const visible = (lm, ids) => ids.every((i) => lm[i] && (lm[i].visibility ?? 1) >= T.minVisibility);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const ok = (detail = "") => ({ status: "ok", detail });
const bad = (detail) => ({ status: "bad", detail });
const unknown = (detail) => ({ status: "unknown", detail });

export function checkLegs(lm) {
  const L = P.left, R = P.right;
  if (!visible(lm, [L.knee, R.knee, L.ankle, R.ankle])) return unknown("Can't see your legs");

  const shin = (dist(lm[L.knee], lm[L.ankle]) + dist(lm[R.knee], lm[R.ankle])) / 2;
  if (shin < 0.02) return unknown("Move the camera so your legs are bigger");

  const ankleHeightDiff = Math.abs(lm[L.ankle].y - lm[R.ankle].y) / shin;
  if (ankleHeightDiff > T.maxAnkleHeightDiff) return bad("One foot looks off the floor");

  const kneeHeightDiff = Math.abs(lm[L.knee].y - lm[R.knee].y) / shin;
  if (kneeHeightDiff > T.maxKneeHeightDiff) return bad("Legs look crossed at the knee");

  const kneeDx = lm[L.knee].x - lm[R.knee].x;
  const ankleDx = lm[L.ankle].x - lm[R.ankle].x;
  const swapped = Math.sign(kneeDx) !== Math.sign(ankleDx);
  if (swapped && Math.abs(ankleDx) / shin > T.minAnkleCross) return bad("Ankles look crossed");

  return ok();
}

export function checkBack(lm) {
  const L = P.left, R = P.right;
  if (!visible(lm, [L.shoulder, R.shoulder, L.hip, R.hip])) return unknown("Can't see your upper body");

  const s = mid(lm[L.shoulder], lm[R.shoulder]);
  const h = mid(lm[L.hip], lm[R.hip]);
  const leanDeg = (Math.atan2(Math.abs(s.x - h.x), Math.abs(h.y - s.y)) * 180) / Math.PI;
  if (leanDeg > T.maxTorsoLeanDeg) return bad(`Leaning ${Math.round(leanDeg)}°. Sit back`);
  return ok();
}

export function checkArm(lm, cuffArm) {
  const A = P[cuffArm];
  if (!visible(lm, [A.shoulder, A.elbow, A.wrist, A.hip])) return unknown("Can't see your cuff arm");

  const S = lm[A.shoulder], E = lm[A.elbow], W = lm[A.wrist], H = lm[A.hip];
  const torso = H.y - S.y;
  if (torso < 0.05) return unknown("Can't measure your torso");

  // Forearm pointing nearly straight down = arm hanging, not resting on a table
  const forearm = dist(E, W);
  const forearmDown = forearm > 0 ? (W.y - E.y) / forearm : 0;
  if (forearmDown > T.maxForearmDown) return bad("Arm is hanging. Rest it on the table");

  // Middle of the upper arm (where the cuff sits) should be roughly level with the heart
  const cuffDrop = ((S.y + E.y) / 2 - S.y) / torso;
  if (cuffDrop > T.maxCuffDrop) return bad("Cuff is below heart height. Raise your arm");

  return ok();
}

// Is the camera placed so every check can work? Uses RAW landmarks (0 to 1 on both axes).
// Returns { status, detail } where detail tells the person what to change.
export function checkFraming(rawLm, cuffArm) {
  if (!rawLm) return bad("Can't see you yet. Sit where the camera sees your whole body.");
  const A = P[cuffArm];
  const needed = [P.left.shoulder, P.right.shoulder, P.left.hip, P.right.hip,
    P.left.knee, P.right.knee, P.left.ankle, P.right.ankle, A.elbow, A.wrist];
  if (!visible(rawLm, [P.left.shoulder, P.right.shoulder])) return bad("Can't see your shoulders. Tilt the camera up.");
  if (!visible(rawLm, [P.left.ankle, P.right.ankle])) return bad("Can't see your feet. Move the camera back or tilt it down.");
  if (!visible(rawLm, [A.elbow, A.wrist])) return bad(`Can't see your ${cuffArm} arm. Turn so the cuff arm faces the camera.`);
  if (!visible(rawLm, needed)) return bad("Part of your body is hidden. Move the camera back.");

  const top = Math.min(rawLm[0]?.y ?? 1, rawLm[P.left.shoulder].y, rawLm[P.right.shoulder].y);
  const bottom = Math.max(rawLm[P.left.ankle].y, rawLm[P.right.ankle].y);
  if (top < 0.02 || bottom > 0.98) return bad("You're at the edge of the picture. Move the camera back a little.");
  if (bottom - top < 0.35) return bad("You look small in the picture. Move the camera closer.");
  return ok("Camera position looks good");
}

// Average movement of the main body points since the last frame, relative to torso size
const MOTION_POINTS = [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];
export function motionAmount(lm, prev) {
  if (!prev) return 0;
  const torso = Math.abs(mid(lm[23], lm[24]).y - mid(lm[11], lm[12]).y) || 0.3;
  let sum = 0, n = 0;
  for (const i of MOTION_POINTS) {
    if (lm[i] && prev[i]) { sum += dist(lm[i], prev[i]); n++; }
  }
  return n ? sum / n / torso : 0;
}

// Turns jumpy frame-by-frame results into steady ones.
// A check only turns red after it has been bad for T.holdMs, so one glitchy frame doesn't flag you.
export class Steady {
  constructor() {
    this.status = "unknown";
    this.detail = "";
    this.since = 0;
    this.pending = null;
  }
  update(result, now) {
    if (result.status === this.status) {
      this.pending = null;
      this.detail = result.detail;
      return this;
    }
    if (!this.pending || this.pending.status !== result.status) {
      this.pending = { status: result.status, at: now };
    }
    const wait = result.status === "bad" ? T.holdMs : T.clearMs;
    if (now - this.pending.at >= wait || this.status === "unknown") {
      this.status = result.status;
      this.detail = result.detail;
      this.since = now;
      this.pending = null;
    }
    return this;
  }
}
