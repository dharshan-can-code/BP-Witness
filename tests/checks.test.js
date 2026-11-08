// Run with: npm test   (needs Node.js 18 or newer)
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkLegs, checkBack, checkArm, checkFraming, toSquare, Steady, T } from "../src/checks.js";

// A person sitting correctly, seen from the side. Coordinates are already "square" (same unit on both axes).
function goodPose() {
  const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 1 }));
  const set = (i, x, y) => (lm[i] = { x, y, visibility: 1 });
  set(0, 0.5, 0.18);                         // nose
  set(11, 0.5, 0.3); set(12, 0.52, 0.3);     // shoulders
  set(13, 0.53, 0.45); set(14, 0.55, 0.45);  // elbows
  set(15, 0.65, 0.46); set(16, 0.67, 0.46);  // wrists, forearms flat on a table
  set(23, 0.5, 0.55); set(24, 0.52, 0.55);   // hips
  set(25, 0.65, 0.57); set(26, 0.66, 0.57);  // knees
  set(27, 0.66, 0.8); set(28, 0.67, 0.8);    // ankles, feet flat
  return lm;
}

test("correct posture passes every check", () => {
  const lm = goodPose();
  assert.equal(checkLegs(lm).status, "ok");
  assert.equal(checkBack(lm).status, "ok");
  assert.equal(checkArm(lm, "left").status, "ok");
  assert.equal(checkArm(lm, "right").status, "ok");
});

test("arm hanging straight down is flagged", () => {
  const lm = goodPose();
  lm[15] = { x: 0.53, y: 0.6, visibility: 1 };
  assert.equal(checkArm(lm, "left").status, "bad");
});

test("cuff far below heart height is flagged", () => {
  const lm = goodPose();
  lm[13] = { x: 0.55, y: 0.82, visibility: 1 };
  assert.equal(checkArm(lm, "left").status, "bad");
});

test("one foot off the floor is flagged", () => {
  const lm = goodPose();
  lm[27] = { x: 0.66, y: 0.65, visibility: 1 };
  assert.equal(checkLegs(lm).status, "bad");
});

test("crossed ankles are flagged", () => {
  const lm = goodPose();
  lm[27] = { x: 0.68, y: 0.8, visibility: 1 };
  lm[28] = { x: 0.64, y: 0.8, visibility: 1 };
  assert.equal(checkLegs(lm).status, "bad");
});

test("leaning forward is flagged", () => {
  const lm = goodPose();
  lm[11] = { x: 0.62, y: 0.32, visibility: 1 };
  lm[12] = { x: 0.64, y: 0.32, visibility: 1 };
  assert.equal(checkBack(lm).status, "bad");
});

test("hidden legs give 'unknown', never a mistake", () => {
  const lm = goodPose();
  lm[27] = { ...lm[27], visibility: 0.1 };
  assert.equal(checkLegs(lm).status, "unknown");
});

test("framing: whole body in view is ok, missing feet is not", () => {
  const lm = goodPose();
  assert.equal(checkFraming(lm, "left").status, "ok");
  lm[27] = { ...lm[27], visibility: 0.1 };
  assert.equal(checkFraming(lm, "left").status, "bad");
  assert.equal(checkFraming(null, "left").status, "bad");
});

test("toSquare stretches x by the camera's aspect ratio", () => {
  const out = toSquare([{ x: 0.5, y: 0.5, visibility: 1 }], 16 / 9);
  assert.ok(Math.abs(out[0].x - 0.5 * (16 / 9)) < 1e-9);
  assert.equal(out[0].y, 0.5);
});

test("Steady waits before flagging, so one glitchy frame doesn't count", () => {
  const s = new Steady();
  s.update({ status: "ok", detail: "" }, 0);
  s.update({ status: "bad", detail: "x" }, 100);
  assert.equal(s.status, "ok");
  s.update({ status: "bad", detail: "x" }, 100 + T.holdMs);
  assert.equal(s.status, "bad");
});
