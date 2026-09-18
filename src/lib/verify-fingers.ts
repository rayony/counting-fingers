import { createServerFn } from "@tanstack/react-start";

export type VerifyOk = {
  ok: true;
  fingersUp: number;
  confidence: number;
  reason: string;
  ms: number;
};

export type VerifyErr = {
  ok: false;
  error: string;
};

const MAX_B64_CHARS = 700_000;
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 16;
const hits: number[] = [];

function rateOk() {
  const now = Date.now();
  while (hits.length && now - hits[0]! > WINDOW_MS) hits.shift();
  if (hits.length >= MAX_PER_WINDOW) return false;
  hits.push(now);
  return true;
}

function extractJson(text: string): {
  fingers_up?: number;
  confidence?: number;
  reason?: string;
} | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]) as {
      fingers_up?: number;
      confidence?: number;
      reason?: string;
    };
  } catch {
    return null;
  }
}

function textFromResponsesBody(body: unknown): string {
  if (!body || typeof body !== "object") return "";
  const rec = body as Record<string, unknown>;
  if (typeof rec.output_text === "string") return rec.output_text;
  const output = rec.output;
  if (!Array.isArray(output)) return "";
  const parts: string[] = [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const content = (item as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const c of content) {
      if (!c || typeof c !== "object") continue;
      const t = c as { type?: string; text?: string };
      if ((t.type === "output_text" || t.type === "text") && typeof t.text === "string") {
        parts.push(t.text);
      }
    }
  }
  return parts.join("\n");
}

export const verifyFingers = createServerFn({ method: "POST" })
  .validator((data: { imageDataUrl: string; localCount: 1 | 2 }) => {
    if (typeof data?.imageDataUrl !== "string") throw new Error("Missing image");
    if (!data.imageDataUrl.startsWith("data:image/jpeg;base64,")) {
      throw new Error("Image must be a JPEG capture");
    }
    if (data.imageDataUrl.length > MAX_B64_CHARS) throw new Error("Image too large");
    if (data.localCount !== 1 && data.localCount !== 2) throw new Error("Invalid count");
    return data;
  })
  .handler(async ({ data }): Promise<VerifyOk | VerifyErr> => {
    const apiKey = process.env.XAI_API_KEY;
    if (!apiKey) return { ok: false, error: "AI double-check is not available" };
    if (!rateOk()) return { ok: false, error: "Too many checks — wait a moment" };

    const prompt = [
      "You are verifying a phone selfie crop of one hand.",
      `A local detector guessed ${data.localCount} raised finger(s).`,
      "Count how many fingers are clearly extended (not curled).",
      "Ignore faces, rooms, and extra people. Use the nearest hand only.",
      'Return ONLY JSON: {"fingers_up":0-5,"confidence":0-100,"reason":"max 8 words"}',
    ].join(" ");

    const started = Date.now();
    const payload = {
      model: "grok-4.5",
      store: false,
      temperature: 0,
      max_output_tokens: 120,
      input: [
        {
          role: "user",
          content: [
            { type: "input_image", image_url: data.imageDataUrl, detail: "low" },
            { type: "input_text", text: prompt },
          ],
        },
      ],
    };

    async function call(url: string, body: unknown) {
      return fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      });
    }

    let res = await call("https://api.x.ai/v1/responses", payload);
    let rawText = "";

    if (res.ok) {
      const body: unknown = await res.json();
      rawText = textFromResponsesBody(body);
    } else {
      // Fallback: OpenAI-compatible chat completions, still store:false.
      res = await call("https://api.x.ai/v1/chat/completions", {
        model: "grok-4.5",
        store: false,
        temperature: 0,
        max_tokens: 120,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image_url",
                image_url: { url: data.imageDataUrl, detail: "low" },
              },
              { type: "text", text: prompt },
            ],
          },
        ],
      });
      if (!res.ok) {
        return { ok: false, error: `xAI API error ${res.status}` };
      }
      const body = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      rawText = body.choices?.[0]?.message?.content ?? "";
    }

    const parsed = extractJson(rawText);
    if (!parsed || typeof parsed.fingers_up !== "number") {
      return { ok: false, error: "Could not read Grok's count" };
    }

    const fingersUp = Math.max(0, Math.min(5, Math.round(parsed.fingers_up)));
    let confidence = Number(parsed.confidence ?? 70);
    if (!Number.isFinite(confidence)) confidence = 70;
    if (confidence <= 1) confidence = Math.round(confidence * 100);
    confidence = Math.max(0, Math.min(100, Math.round(confidence)));

    return {
      ok: true,
      fingersUp,
      confidence,
      reason: String(parsed.reason ?? "").slice(0, 80),
      ms: Date.now() - started,
    };
  });
