// Camera, microphone and MediaPipe body tracking. Everything here runs on the user's device:
// video and audio never leave the browser.

// MediaPipe is loaded only when the camera starts, so the page still works (and can show
// a clear error) if the library can't be downloaded.
const MEDIAPIPE_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";
let mp = null; // { PoseLandmarker, FilesetResolver, DrawingUtils }

const WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const POSE_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";

let poseLandmarker = null;
let drawer = null;

export async function startCamera(videoEl) {
  let stream;
  let hasMic = true;
  // "ideal" lets phones and older webcams fall back to whatever size they support
  const video = { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" };
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video,
      audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: false },
    });
  } catch (err) {
    // Microphone refused? Try again with the camera only.
    stream = await navigator.mediaDevices.getUserMedia({ video });
    hasMic = false;
  }
  videoEl.srcObject = stream;
  await new Promise((resolve) => {
    if (videoEl.readyState >= 2) resolve();
    else videoEl.onloadeddata = () => resolve();
  });
  return { stream, hasMic };
}

export function stopCamera(stream) {
  stream?.getTracks().forEach((t) => t.stop());
}

export async function loadPoseModel() {
  if (poseLandmarker) return poseLandmarker;
  mp = mp ?? (await import(MEDIAPIPE_URL));
  const { PoseLandmarker, FilesetResolver } = mp;
  const vision = await FilesetResolver.forVisionTasks(WASM_URL);
  const options = (delegate) => ({
    baseOptions: { modelAssetPath: POSE_MODEL_URL, delegate },
    runningMode: "VIDEO",
    numPoses: 1,
  });
  try {
    poseLandmarker = await PoseLandmarker.createFromOptions(vision, options("GPU"));
  } catch (err) {
    console.warn("GPU not available, using CPU", err);
    poseLandmarker = await PoseLandmarker.createFromOptions(vision, options("CPU"));
  }
  return poseLandmarker;
}

// Returns the 33 body landmarks for the person in frame, or null if nobody is visible
export function detectPose(videoEl, timestampMs) {
  if (!poseLandmarker || videoEl.readyState < 2) return null;
  const result = poseLandmarker.detectForVideo(videoEl, timestampMs);
  return result?.landmarks?.[0] ?? null;
}

// Draws the skeleton, plus a dot on the cuff colored green/red by the arm check
export function drawPose(canvasEl, videoEl, landmarks, cuffArm, armStatus) {
  if (canvasEl.width !== videoEl.videoWidth) {
    canvasEl.width = videoEl.videoWidth;
    canvasEl.height = videoEl.videoHeight;
  }
  const ctx = canvasEl.getContext("2d");
  ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
  if (!landmarks) return;
  if (!mp) return;
  if (!drawer) drawer = new mp.DrawingUtils(ctx);

  drawer.drawConnectors(landmarks, mp.PoseLandmarker.POSE_CONNECTIONS, { color: "#7dd3fc", lineWidth: 3 });
  drawer.drawLandmarks(landmarks, { radius: 3, color: "#ffffff", lineWidth: 1 });

  const [s, e] = cuffArm === "left" ? [11, 13] : [12, 14];
  if (landmarks[s] && landmarks[e]) {
    const x = ((landmarks[s].x + landmarks[e].x) / 2) * canvasEl.width;
    const y = ((landmarks[s].y + landmarks[e].y) / 2) * canvasEl.height;
    ctx.beginPath();
    ctx.arc(x, y, 14, 0, Math.PI * 2);
    ctx.fillStyle = armStatus === "bad" ? "rgba(214,69,69,0.85)" : armStatus === "ok" ? "rgba(31,157,85,0.85)" : "rgba(150,150,150,0.7)";
    ctx.fill();
  }
}

// Grabs the current camera frame as a JPEG (not mirrored, so the monitor's numbers read correctly)
export function snapshot(videoEl, quality = 0.85) {
  const c = document.createElement("canvas");
  c.width = videoEl.videoWidth;
  c.height = videoEl.videoHeight;
  c.getContext("2d").drawImage(videoEl, 0, 0);
  return c.toDataURL("image/jpeg", quality);
}

// ---------- Talking detection with the microphone ----------
// Tune this with your own cuff: raise it if the pump hum gets flagged as talking.
const TALK_MIN_VARIATION = 0.35;

// Measures loudness. Calibrates to the room's background noise for the first 2 seconds,
// then flags sustained sound well above that level as talking.
export class TalkDetector {
  constructor(stream) {
    this.ctx = new AudioContext();
    this.ctx.resume?.();
    const source = this.ctx.createMediaStreamSource(stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    source.connect(this.analyser);
    this.buf = new Float32Array(this.analyser.fftSize);
    this.startedAt = performance.now();
    this.ambient = [];
    this.threshold = null;
    this.recent = []; // [time, rms]
  }

  level() {
    this.analyser.getFloatTimeDomainData(this.buf);
    let sum = 0;
    for (const v of this.buf) sum += v * v;
    return Math.sqrt(sum / this.buf.length);
  }

  // Returns { status, detail } like the posture checks.
  // `ignore` is true while the app itself is speaking, so its own voice isn't counted as talking.
  update(now, ignore = false) {
    const rms = this.level();
    if (this.threshold === null) {
      this.ambient.push(rms);
      if (now - this.startedAt < 2000) return { status: "unknown", detail: "Listening to room noise…" };
      const sorted = [...this.ambient].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)] || 0.005;
      this.threshold = Math.max(median * 3, 0.02);
    }
    if (ignore) {
      this.recent = [];
      return { status: "ok", detail: "" };
    }

    this.recent.push([now, rms]);
    while (this.recent.length && now - this.recent[0][0] > 1200) this.recent.shift();
    if (this.recent.length < 10) return { status: "ok", detail: "" };

    const levels = this.recent.map(([, v]) => v);
    const loudShare = levels.filter((v) => v > this.threshold).length / levels.length;
    // Speech goes up and down with every syllable. The cuff's pump is a steady hum.
    // So we also require the loudness to vary a lot (coefficient of variation).
    const mean = levels.reduce((a, b) => a + b, 0) / levels.length;
    const sd = Math.sqrt(levels.reduce((a, b) => a + (b - mean) ** 2, 0) / levels.length);
    const variation = mean > 0 ? sd / mean : 0;

    const talking = loudShare > 0.3 && variation > TALK_MIN_VARIATION;
    return talking ? { status: "bad", detail: "Sounds like talking" } : { status: "ok", detail: "" };
  }

  close() {
    this.ctx.close();
  }
}
