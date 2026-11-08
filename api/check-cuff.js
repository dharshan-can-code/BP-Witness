// POST { image: "data:image/jpeg;base64,..." } → { cuffVisible, overClothing, explanation }
// Asks Claude whether the blood pressure cuff is on bare skin or over a sleeve.
// A cuff over clothing is one of the biggest causes of wrong home readings.

import { askClaudeAboutImage, handle } from "../lib/claude.js";

const PROMPT = `This webcam photo should show a person's upper arm with a home blood pressure cuff on it.
Answer three things:
1. cuff_visible: is a blood pressure cuff clearly visible on the upper arm?
2. over_clothing: is the cuff wrapped over a sleeve or other clothing (true), directly on bare skin (false), or can't you tell (null)?
3. explanation: one short, friendly sentence for the person, under 20 words.
If the photo is too dark, blurry or far away to judge, set cuff_visible to false.
Reply with only this JSON and nothing else:
{"cuff_visible": true, "over_clothing": false, "explanation": "The cuff is on bare skin. Nice."}`;

export default handle(async ({ image }) => {
  const json = await askClaudeAboutImage({ image, prompt: PROMPT, maxTokens: 200 });
  const cuffVisible = json.cuff_visible === true;
  return {
    cuffVisible,
    overClothing: cuffVisible && typeof json.over_clothing === "boolean" ? json.over_clothing : null,
    explanation: typeof json.explanation === "string" ? json.explanation.slice(0, 200) : "",
  };
});
