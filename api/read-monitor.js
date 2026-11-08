// POST { image: "data:image/jpeg;base64,..." } → { readable, systolic, diastolic, pulse }
// Asks Claude to read the numbers off a photo of the blood pressure monitor's screen.

import { askClaudeAboutImage, handle } from "../lib/claude.js";

const PROMPT = `This photo shows the screen of a home blood pressure monitor, held up to a webcam.
Read the numbers on the screen.
- systolic: the top / largest number, often labeled SYS
- diastolic: the middle number, often labeled DIA
- pulse: often labeled PUL, PULSE or shown with a heart symbol
If the screen is blurry, cut off, or you are not sure of a number, set "readable" to false and use null. Never guess.
Reply with only this JSON and nothing else:
{"readable": true, "systolic": 120, "diastolic": 80, "pulse": 70}`;

const inRange = (v, lo, hi) => (Number.isFinite(v) && v >= lo && v <= hi ? Math.round(v) : null);

export default handle(async ({ image }) => {
  const json = await askClaudeAboutImage({ image, prompt: PROMPT, maxTokens: 200 });

  // Sanity-check the numbers so a misread can't produce something impossible
  const systolic = inRange(json.systolic, 50, 260);
  const diastolic = inRange(json.diastolic, 30, 180);
  const pulse = inRange(json.pulse, 30, 220);
  const readable = Boolean(json.readable) && systolic !== null && diastolic !== null && systolic > diastolic;

  return { readable, systolic, diastolic, pulse };
});
