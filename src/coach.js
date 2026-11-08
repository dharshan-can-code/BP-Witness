// Spoken coaching. Says fixes out loud ("Uncross your legs") so people don't have to read the screen.
// Uses the browser's built-in voice, so nothing is sent anywhere.

const MIN_GAP_MS = 5000;     // never talk more often than this
const REPEAT_GAP_MS = 15000; // don't repeat the same line sooner than this

export class Coach {
  constructor() {
    this.enabled = "speechSynthesis" in window;
    this.lastSpokeAt = 0;
    this.lastLine = {};
    this.speakingUntil = 0;
  }

  setEnabled(on) {
    this.enabled = on && "speechSynthesis" in window;
    if (!this.enabled) window.speechSynthesis?.cancel();
  }

  // urgent lines (step changes) skip the gap rules
  say(text, { urgent = false } = {}) {
    if (!this.enabled || !text) return;
    const now = performance.now();
    if (!urgent) {
      if (now - this.lastSpokeAt < MIN_GAP_MS) return;
      if (now - (this.lastLine[text] ?? -Infinity) < REPEAT_GAP_MS) return;
    } else {
      window.speechSynthesis.cancel();
    }
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 0.95;
    const done = () => (this.speakingUntil = performance.now() + 700);
    u.onend = done;
    u.onerror = done;
    window.speechSynthesis.speak(u);
    this.lastSpokeAt = now;
    this.lastLine[text] = now;
    // Rough length of the sentence, in case the browser never fires onend
    this.speakingUntil = now + text.length * 90 + 1500;
  }

  // True while the app's own voice is playing, so the talking check can ignore it
  isSpeaking() {
    return window.speechSynthesis?.speaking || performance.now() < this.speakingUntil;
  }
}
