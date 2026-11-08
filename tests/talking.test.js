// Run with: npm test
// Feeds the talking detector fake microphone levels instead of a real microphone.
import { test } from "node:test";
import assert from "node:assert/strict";

let micLevel = 0;
let audioState = "running";

globalThis.document = { addEventListener() {}, removeEventListener() {} };
globalThis.AudioContext = class {
  get state() { return audioState; }
  resume() {}
  close() {}
  createMediaStreamSource() { return { connect() {} }; }
  createAnalyser() {
    return { fftSize: 0, getFloatTimeDomainData: (buf) => buf.fill(micLevel) };
  }
};

const { TalkDetector } = await import("../src/vision.js");

// Runs the detector at 60 frames a second. `levelAt(ms)` gives the mic loudness at each moment.
function run(detector, fromMs, toMs, levelAt) {
  let result;
  for (let t = fromMs; t < toMs; t += 16) {
    micLevel = levelAt(t);
    result = detector.update(t);
  }
  return result;
}

const quietRoom = () => 0.002;
// Quiet speech from 2 m away: loud on syllables, silent between them
const quietSpeech = (t) => (Math.floor(t / 150) % 2 ? 0.012 : 0.002);
const pumpHum = () => 0.03;

function calibrated() {
  audioState = "running";
  const d = new TalkDetector({});
  run(d, 0, 2100, quietRoom);
  return d;
}

test("quiet speech from across the room counts as talking", () => {
  assert.equal(run(calibrated(), 2100, 4000, quietSpeech).status, "bad");
});

test("a silent room is not talking", () => {
  assert.equal(run(calibrated(), 2100, 4000, quietRoom).status, "ok");
});

test("the cuff's steady pump hum is not talking", () => {
  assert.equal(run(calibrated(), 2100, 4000, pumpHum).status, "ok");
});

test("a paused microphone says so instead of reporting silence", () => {
  audioState = "suspended";
  const d = new TalkDetector({});
  const r = run(d, 0, 3000, quietSpeech);
  assert.equal(r.status, "unknown");
  assert.match(r.detail, /Microphone paused/);
});
