// Minimal Gemini client: JSON generation and SSE text streaming.
// MOCK_LLM=1 switches to deterministic fakes for local UI testing.

export const MODEL = process.env.GEMINI_MODEL || "gemini-3.1-flash-lite";
export const FAST_MODEL = process.env.GEMINI_FAST_MODEL || MODEL;
const API = (process.env.GEMINI_API_BASE || "https://generativelanguage.googleapis.com/v1beta") + "/models";

export const isMock = () => process.env.MOCK_LLM === "1";
export const hasLLM = () => isMock() || !!process.env.GEMINI_API_KEY;

type Part = { text?: string };
type GeminiResponse = { candidates?: { content?: { parts?: Part[] }; finishReason?: string }[]; error?: { message?: string } };

function headers() {
  return { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY || "" };
}

export async function generateJSON<T>(prompt: string, opts: { model?: string; timeoutMs?: number; maxTokens?: number; signal?: AbortSignal } = {}): Promise<T> {
  const res = await fetch(`${API}/${encodeURIComponent(opts.model || FAST_MODEL)}:generateContent`, {
    method: "POST",
    headers: headers(),
    signal: anySignal(opts.signal, AbortSignal.timeout(opts.timeoutMs ?? 12000)),
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0, responseMimeType: "application/json", maxOutputTokens: opts.maxTokens ?? 1500 },
    }),
  });
  const data = await res.json() as GeminiResponse;
  if (!res.ok) throw new Error(data.error?.message || `Gemini ${res.status}`);
  const text = data.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("") || "";
  return JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, "")) as T;
}

export async function* streamText(prompt: string, opts: { model?: string; timeoutMs?: number; maxTokens?: number; signal?: AbortSignal } = {}): AsyncGenerator<string> {
  const res = await fetch(`${API}/${encodeURIComponent(opts.model || MODEL)}:streamGenerateContent?alt=sse`, {
    method: "POST",
    headers: headers(),
    signal: anySignal(opts.signal, AbortSignal.timeout(opts.timeoutMs ?? 55000)),
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.15, maxOutputTokens: opts.maxTokens ?? 3000 },
    }),
  });
  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => "");
    throw new Error(`Gemini ${res.status}: ${body.slice(0, 200)}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line.startsWith("data:")) continue;
      const json = line.slice(5).trim();
      if (!json || json === "[DONE]") continue;
      try {
        const chunk = JSON.parse(json) as GeminiResponse;
        const text = chunk.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("") || "";
        if (text) yield text;
      } catch { /* partial line */ }
    }
  }
}

function anySignal(...signals: (AbortSignal | undefined)[]): AbortSignal {
  const list = signals.filter((s): s is AbortSignal => !!s);
  return list.length === 1 ? list[0] : AbortSignal.any(list);
}
