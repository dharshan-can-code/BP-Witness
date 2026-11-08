// BP Witness: main app. Runs the steps (setup → rest → measure → capture → result)
// and the camera loop that checks posture every frame.

import { startCamera, stopCamera, loadPoseModel, detectPose, drawPose, snapshot, TalkDetector } from "./vision.js";
import { checkLegs, checkBack, checkArm, checkFraming, motionAmount, toSquare, Steady, T } from "./checks.js";
import { RULES, LIVE_CHECKS } from "./rules.js";
import { loadReadings, saveReading, clearReadings } from "./storage.js";
import { Coach } from "./coach.js";

const $ = (id) => document.getElementById(id);
const video = $("video");
const overlay = $("overlay");

const REST_MS_REAL = 5 * 60 * 1000;
const REST_MS_DEMO = 30 * 1000;
const MIN_PROBLEM_MS = 1000; // a problem must add up to at least 1 s during the reading to count

const coach = new Coach();

const state = {
  screen: "setup",
  stream: null,
  talk: null,
  running: false,
  cuffArm: "left",
  demo: false,
  restLeftMs: REST_MS_REAL,
  restSkipped: false,
  measureMs: 0,
  problemMs: {},        // check id → milliseconds it was red during the reading
  cuffCheck: null,      // "bare" | "clothing" | null, from the AI cuff check
  checks: Object.fromEntries(LIVE_CHECKS.map((id) => [id, new Steady()])),
  framing: new Steady(),
  lastStatus: {},       // to notice when a check turns red, for spoken coaching
  prevLandmarks: null,
  motion: 0,
  lastTick: 0,
};

// ---------- Screens ----------
const LIVE_SCREENS = ["setup", "rest", "measure", "capture"];

function show(screen) {
  state.screen = screen;
  document.querySelectorAll(".screen").forEach((el) => el.classList.add("hidden"));
  $(`screen-${screen}`).classList.remove("hidden");
  $("camera-panel").classList.toggle("hidden", !(LIVE_SCREENS.includes(screen) && state.stream));
  if (screen === "history") renderHistory();
}

document.querySelectorAll("[data-goto]").forEach((btn) =>
  btn.addEventListener("click", () => {
    if (btn.dataset.goto === "setup") {
      resetSession();
      state.cuffCheck = null; // each new reading needs its own cuff check
      setStatus("cuff-status", "");
    }
    show(btn.dataset.goto);
  })
);

function resetSession() {
  state.restSkipped = false;
  state.measureMs = 0;
  state.problemMs = {};
  state.restLeftMs = state.demo ? REST_MS_DEMO : REST_MS_REAL;
  ["in-sys", "in-dia", "in-pulse"].forEach((id) => ($(id).value = ""));
  setStatus("capture-status", "");
}

// ---------- Setup ----------
$("voice-on").addEventListener("change", (e) => coach.setEnabled(e.target.checked));
$("cuff-arm").addEventListener("change", (e) => (state.cuffArm = e.target.value));

$("btn-start-camera").addEventListener("click", async () => {
  const btn = $("btn-start-camera");
  btn.disabled = true;
  btn.textContent = "Starting…";
  let step = "camera";
  try {
    const { stream, hasMic } = await startCamera(video);
    state.stream = stream;
    state.talk = hasMic ? new TalkDetector(stream) : null;
    state.cuffArm = $("cuff-arm").value;
    $("camera-panel").classList.remove("hidden");
    setCameraMsg("Loading body tracking…");
    step = "model";
    await loadPoseModel();
    setCameraMsg(hasMic ? "" : "No microphone, so talking can't be checked.");
    btn.textContent = "Camera on";
    $("framing").classList.remove("hidden");
    $("cuff-check").classList.remove("hidden");
    $("btn-start-anyway").classList.remove("hidden");
    if (!state.running) {
      state.running = true;
      state.lastTick = 0;
      requestAnimationFrame(tick);
    }
  } catch (err) {
    console.error(err);
    shutDownCamera();
    $("camera-panel").classList.add("hidden");
    $("framing").classList.remove("hidden");
    setStatus(
      "framing-status",
      step === "camera"
        ? "Couldn't start the camera. Allow camera access in your browser and try again."
        : "Couldn't load body tracking. Check your internet connection, then reload the page.",
      "bad"
    );
  }
});

function startRest() {
  state.cuffArm = $("cuff-arm").value;
  state.demo = $("demo-mode").checked;
  resetSession();
  show("rest");
  coach.say("Sit back with your feet flat and your arm on the table. Rest quietly. I'll tell you when it's time.", { urgent: true });
}
$("btn-start-rest").addEventListener("click", startRest);
$("btn-start-anyway").addEventListener("click", startRest);

$("btn-skip-rest").addEventListener("click", () => {
  state.restSkipped = true;
  startMeasuring();
});

// ---------- AI cuff check ----------
$("btn-check-cuff").addEventListener("click", async () => {
  const btn = $("btn-check-cuff");
  btn.disabled = true;
  setStatus("cuff-status", "Checking your cuff…");
  try {
    const data = await postImage("/api/check-cuff");
    if (!data.cuffVisible) {
      state.cuffCheck = null;
      setStatus("cuff-status", data.explanation || "Couldn't see the cuff. Hold your arm closer to the camera and try again.", "bad");
    } else if (data.overClothing === true) {
      state.cuffCheck = "clothing";
      $("pre-bareArm").checked = false;
      setStatus("cuff-status", (data.explanation || "The cuff looks like it's over clothing.") + " Move it onto bare skin, then check again.", "bad");
      coach.say("Your cuff looks like it's over clothing. Move it onto bare skin.", { urgent: true });
    } else if (data.overClothing === false) {
      state.cuffCheck = "bare";
      $("pre-bareArm").checked = true;
      setStatus("cuff-status", "✅ " + (data.explanation || "The cuff is on bare skin."), "ok");
    } else {
      state.cuffCheck = null;
      setStatus("cuff-status", data.explanation || "Couldn't tell. Try again with better light.", "bad");
    }
  } catch (err) {
    console.error(err);
    setStatus("cuff-status", "The AI check isn't available right now. Use the checkbox below instead.", "bad");
  } finally {
    btn.disabled = false;
  }
});

// ---------- Measure ----------
function startMeasuring() {
  state.measureMs = 0;
  state.problemMs = {};
  show("measure");
  coach.say("Rest done. Press start on your cuff now, and stay still and quiet until it finishes.", { urgent: true });
}

$("btn-measure-done").addEventListener("click", () => {
  show("capture");
  coach.say("Hold your monitor's screen up close to the camera.", { urgent: true });
});

// ---------- Capture: AI reads the monitor ----------
$("btn-snap").addEventListener("click", async () => {
  const btn = $("btn-snap");
  btn.disabled = true;
  setStatus("capture-status", "Reading your monitor…");
  try {
    const data = await postImage("/api/read-monitor");
    if (!data.readable) {
      setStatus("capture-status", "Couldn't read the screen. Hold it closer and steadier, or type the numbers below.", "bad");
      return;
    }
    $("in-sys").value = data.systolic ?? "";
    $("in-dia").value = data.diastolic ?? "";
    $("in-pulse").value = data.pulse ?? "";
    setStatus("capture-status", "Got it. Check the numbers below match your monitor.", "ok");
  } catch (err) {
    console.error(err);
    setStatus("capture-status", "The reader isn't available right now. Type the numbers below.", "bad");
  } finally {
    btn.disabled = false;
  }
});

$("btn-to-result").addEventListener("click", () => {
  const sys = Number($("in-sys").value);
  const dia = Number($("in-dia").value);
  const pulse = Number($("in-pulse").value) || null;
  if (!sys || !dia || sys <= dia) {
    setStatus("capture-status", "Enter the top and bottom numbers (the top one is bigger).", "bad");
    return;
  }
  const reading = buildResult(sys, dia, pulse);
  saveReading(reading);
  renderResult(reading);
  coach.say(reading.trusted ? "Done. This reading was taken correctly." : "Done. I saw some mistakes, so this reading may be off.", { urgent: true });
  shutDownCamera();
  show("result");
});

function shutDownCamera() {
  stopCamera(state.stream);
  state.talk?.close();
  state.stream = null;
  state.talk = null;
  state.running = false;
  state.prevLandmarks = null;
  overlay.getContext("2d").clearRect(0, 0, overlay.width, overlay.height);
  $("btn-start-camera").disabled = false;
  $("btn-start-camera").textContent = "Turn on camera & microphone";
  $("btn-start-rest").disabled = true;
  ["framing", "cuff-check", "btn-start-anyway"].forEach((id) => $(id).classList.add("hidden"));
}

// ---------- Result ----------
function buildResult(sys, dia, pulse) {
  const problems = [];

  for (const id of LIVE_CHECKS) {
    if ((state.problemMs[id] || 0) >= MIN_PROBLEM_MS) {
      problems.push({ id, mistake: RULES[id].mistake, effect: RULES[id].effect, seconds: Math.round(state.problemMs[id] / 1000) });
    }
  }
  document.querySelectorAll(".precheck").forEach((box) => {
    if (!box.checked) problems.push({ id: box.value, mistake: RULES[box.value].mistake, effect: RULES[box.value].effect });
  });
  if (state.restSkipped) problems.push({ id: "rest", mistake: RULES.rest.mistake, effect: RULES.rest.effect });

  return {
    at: new Date().toISOString(),
    systolic: sys,
    diastolic: dia,
    pulse,
    cuffArm: state.cuffArm,
    cuffCheckedByAI: state.cuffCheck === "bare",
    demoMode: state.demo,
    trusted: problems.length === 0,
    problems,
  };
}

function renderResult(r) {
  const list = r.problems
    .map((p) => `<li><b>${p.mistake}</b>${p.seconds ? ` (seen for ${p.seconds}s)` : ""}: typically ${p.effect}</li>`)
    .join("");
  $("result-card").innerHTML = `
    <div class="result ${r.trusted ? "trusted" : "untrusted"}">
      <div class="reading">${r.systolic}/${r.diastolic} <small>mmHg</small></div>
      ${r.pulse ? `<div>Pulse ${r.pulse}</div>` : ""}
      <h3>${r.trusted ? "✅ Taken correctly: your doctor can trust this reading" : "⚠️ Not trusted: this reading may be off"}</h3>
      ${r.trusted ? "<p>No mistakes seen during your rest or reading.</p>" : `<p>What we saw:</p><ul>${list}</ul><p>Fix these and take it again.</p>`}
      ${r.cuffCheckedByAI ? "<p>Cuff position confirmed by AI photo check.</p>" : ""}
      ${r.demoMode ? "<p><i>Demo mode: the rest was shortened to 30 seconds.</i></p>" : ""}
    </div>`;
}

// ---------- History / doctor report ----------
function average(readings) {
  if (!readings.length) return null;
  const avg = (k) => Math.round(readings.reduce((s, r) => s + r[k], 0) / readings.length);
  return { sys: avg("systolic"), dia: avg("diastolic"), n: readings.length };
}

function renderHistory() {
  const all = loadReadings();
  const trusted = average(all.filter((r) => r.trusted));
  const untrusted = average(all.filter((r) => !r.trusted));

  let insight = "";
  if (trusted) insight += `<p><b>Trusted readings average ${trusted.sys}/${trusted.dia}</b> (${trusted.n} reading${trusted.n > 1 ? "s" : ""}).</p>`;
  if (untrusted) insight += `<p>Readings with mistakes average ${untrusted.sys}/${untrusted.dia} (${untrusted.n}).</p>`;
  if (trusted && untrusted) {
    const diff = untrusted.sys - trusted.sys;
    if (diff > 0) insight += `<p>Your readings with mistakes run <b>${diff} points higher</b> on the top number.</p>`;
  }
  $("insights").innerHTML = insight ? `<div class="card-inset">${insight}</div>` : "";

  const rows = all
    .map((r) => {
      const when = new Date(r.at).toLocaleString();
      const problems = r.problems.map((p) => p.mistake).join("; ") || "None";
      return `<tr><td>${when}</td><td>${r.systolic}/${r.diastolic}</td><td>${r.pulse ?? ""}</td><td>${r.trusted ? "✅" : "⚠️"}</td><td>${problems}</td></tr>`;
    })
    .join("");
  $("history-table").querySelector("tbody").innerHTML = rows || `<tr><td colspan="5">No readings yet.</td></tr>`;
}

$("btn-print").addEventListener("click", () => window.print());
$("btn-clear").addEventListener("click", () => {
  if (confirm("Delete all saved readings on this device?")) {
    clearReadings();
    renderHistory();
  }
});

// ---------- The camera loop ----------
function tick(now) {
  if (!state.running) return;
  const dt = state.lastTick ? Math.min(now - state.lastTick, 250) : 0;
  state.lastTick = now;

  const raw = detectPose(video, now);
  const results = {};

  if (raw) {
    const lm = toSquare(raw, video.videoWidth / video.videoHeight || 16 / 9);
    results.legs = checkLegs(lm);
    results.back = checkBack(lm);
    results.arm = checkArm(lm, state.cuffArm);
    // Smooth the motion number so one jumpy frame doesn't count as moving
    state.motion = state.motion * 0.8 + motionAmount(lm, state.prevLandmarks) * 0.2;
    results.still = state.motion > T.maxMotion ? { status: "bad", detail: "You're moving" } : { status: "ok", detail: "" };
    state.prevLandmarks = lm;
  } else {
    for (const id of ["legs", "back", "arm", "still"]) results[id] = { status: "unknown", detail: "No one in view" };
    state.prevLandmarks = null;
  }
  results.talking = state.talk ? state.talk.update(now, coach.isSpeaking()) : { status: "unknown", detail: "No microphone" };

  for (const id of LIVE_CHECKS) state.checks[id].update(results[id], now);
  state.framing.update(checkFraming(raw, state.cuffArm), now);

  drawPose(overlay, video, raw, state.cuffArm, state.checks.arm.status);
  renderChecklist();
  speakNewProblems();
  runStep(dt);

  requestAnimationFrame(tick);
}

function runStep(dt) {
  const anyBad = LIVE_CHECKS.some((id) => state.checks[id].status === "bad");
  const framingOk = state.framing.status === "ok";
  const badFixes = () => LIVE_CHECKS.filter((id) => state.checks[id].status === "bad").map((id) => RULES[id].fix).join(" ");

  if (state.screen === "setup") {
    setStatus("framing-status", (framingOk ? "✅ " : "📷 ") + state.framing.detail, framingOk ? "ok" : "bad");
    $("btn-start-rest").disabled = !framingOk;
    setCameraMsg(framingOk ? "" : state.framing.detail);
  } else {
    setCameraMsg(framingOk ? "" : state.framing.detail);
  }

  if (state.screen === "rest") {
    if (!framingOk) {
      setStatus("rest-status", "Paused: " + state.framing.detail, "bad");
    } else if (anyBad) {
      setStatus("rest-status", "Paused: " + badFixes(), "bad");
    } else {
      state.restLeftMs = Math.max(0, state.restLeftMs - dt);
      setStatus("rest-status", "Good. Keep resting quietly.", "ok");
    }
    $("rest-timer").textContent = formatTime(state.restLeftMs);
    if (state.restLeftMs <= 0) startMeasuring();
  }

  if (state.screen === "measure") {
    state.measureMs += dt;
    for (const id of LIVE_CHECKS) {
      if (state.checks[id].status === "bad") state.problemMs[id] = (state.problemMs[id] || 0) + dt;
    }
    $("measure-timer").textContent = formatTime(state.measureMs);
    setStatus("measure-status", anyBad ? badFixes() : "Looking good. Stay still and quiet.", anyBad ? "bad" : "ok");
  }
}

// Speak a fix the moment a check turns red, during rest and measuring only
function speakNewProblems() {
  for (const id of LIVE_CHECKS) {
    const now = state.checks[id].status;
    if (now === "bad" && state.lastStatus[id] !== "bad" && (state.screen === "rest" || state.screen === "measure")) {
      coach.say(RULES[id].fix);
    }
    state.lastStatus[id] = now;
  }
}

function renderChecklist() {
  const html = LIVE_CHECKS.map((id) => {
    const c = state.checks[id];
    const icon = c.status === "ok" ? "✅" : c.status === "bad" ? "❌" : "…";
    return `<li class="${c.status}"><span>${icon} ${RULES[id].label}</span><small>${c.status === "ok" ? "" : c.detail}</small></li>`;
  }).join("");
  const list = $("checklist");
  if (list.innerHTML !== html) list.innerHTML = html;
}

// ---------- Small helpers ----------
async function postImage(url) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image: snapshot(video) }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function formatTime(ms) {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function setStatus(id, text, kind = "") {
  const el = $(id);
  if (el.textContent !== text) el.textContent = text;
  const cls = `status ${kind}`.trim();
  if (el.className !== cls) el.className = cls;
}

function setCameraMsg(text) {
  const el = $("camera-msg");
  if (el.textContent !== text) el.textContent = text;
}

renderChecklist();
show("setup");
