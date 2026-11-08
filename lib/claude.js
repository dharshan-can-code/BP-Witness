// Shared helper for the serverless functions in /api.
// Sends one image plus a prompt to Claude and returns the JSON object Claude replies with.
// The API key comes from the ANTHROPIC_API_KEY environment variable and never reaches the browser.

const MODEL = process.env.ANTHROPIC_MODEL || "claude-haiku-5-5";
const MAX_IMAGE_CHARS = 4_000_000; // Vercel limits request bodies to about 4.5 MB

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// "data:image/jpeg;base64,AAAA" → { mediaType: "image/jpeg", data: "AAAA" }
export function parseDataUrl(image) {
  if (typeof image !== "string" || !image.startsWith("data:image/")) {
    throw new HttpError(400, "Send { image: <data URL> }");
  }
  if (image.length > MAX_IMAGE_CHARS) throw new HttpError(413, "Image too large");
  const match = image.match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/);
  if (!match) throw new HttpError(400, "Unsupported image format");
  return { mediaType: match[1], data: match[2] };
}

export async function askClaudeAboutImage({ image, prompt, maxTokens = 300 }) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new HttpError(500, "Server is missing ANTHROPIC_API_KEY");
  const { mediaType, data } = parseDataUrl(image);

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data } },
            { type: "text", text: prompt },
          ],
        },
      ],
    }),
  });

  if (!res.ok) {
    console.error("Claude API error", res.status, await res.text());
    throw new HttpError(502, "The AI service failed");
  }
  const body = await res.json();
  const text = body.content?.find((c) => c.type === "text")?.text ?? "";
  const jsonText = text.match(/\{[\s\S]*\}/)?.[0];
  if (!jsonText) throw new HttpError(502, "The AI gave an unexpected answer");
  return JSON.parse(jsonText);
}

// Wraps a handler so errors become clean JSON responses
export function handle(fn) {
  return async (req, res) => {
    if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });
    try {
      return res.status(200).json(await fn(req.body ?? {}));
    } catch (err) {
      console.error(err);
      const status = err instanceof HttpError ? err.status : 500;
      return res.status(status).json({ error: err instanceof HttpError ? err.message : "Something went wrong" });
    }
  };
}
