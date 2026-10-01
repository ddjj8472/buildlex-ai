// Minimal Gemini client: JSON generation and SSE text streaming.
// MOCK_LLM=1 switches to deterministic fakes for local UI testing.

export const MODEL = process.env.GEMINI_MODEL || "gemini-3.1-flash-lite";
/** Lighter model for structured calls (analysis, rerank, evaluation). */
export const FAST_MODEL = process.env.GEMINI_FAST_MODEL || "gemini-flash-lite-latest";
/** Tried in order when the main model is overloaded (comma-separated env). */
export const FALLBACK_MODELS = (process.env.GEMINI_FALLBACK_MODELS || "gemini-flash-latest,gemini-flash-lite-latest").split(",").map(s => s.trim()).filter(Boolean);
const API = (process.env.GEMINI_API_BASE || "https://generativelanguage.googleapis.com/v1beta") + "/models";

export const isMock = () => process.env.MOCK_LLM === "1";
export const hasLLM = () => isMock() || !!process.env.GEMINI_API_KEY;

type Part = { text?: string };
export type InlineImage = { mimeType: string; data: string };
type GeminiResponse = { candidates?: { content?: { parts?: Part[] }; finishReason?: string }[]; error?: { message?: string } };

function headers() {
  return { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY || "" };
}

type JSONOpts = { model?: string; timeoutMs?: number; maxTokens?: number; signal?: AbortSignal; images?: InlineImage[] };

export async function generateJSON<T>(prompt: string, opts: JSONOpts = {}): Promise<T> {
  // Try the requested (fast) model, then the main model, then aliases — but only for
  // quick failures (overload, missing model, empty/invalid JSON). A timeout is final:
  // retrying it would blow the request's time budget.
  const models = [...new Set([opts.model || FAST_MODEL, MODEL, ...FALLBACK_MODELS])].slice(0, 3);
  const deadline = Date.now() + (opts.timeoutMs ?? 12000);
  let last: unknown;
  for (const model of models) {
    const left = deadline - Date.now();
    if (left < 1500) break;
    try { return await generateJSONOnce<T>(prompt, { ...opts, model, timeoutMs: left }); }
    catch (e) {
      last = e;
      const msg = e instanceof Error ? `${e.name} ${e.message}` : String(e);
      if (opts.signal?.aborted || /timeout|abort/i.test(msg)) break;
      if (!/404|429|500|502|503|504|NOT_FOUND|UNAVAILABLE|high demand|RESOURCE_EXHAUSTED|빈 응답|JSON/i.test(msg)) break;
    }
  }
  throw last ?? new Error("시간 부족");
}

async function generateJSONOnce<T>(prompt: string, opts: JSONOpts = {}): Promise<T> {
  const res = await fetch(`${API}/${encodeURIComponent(opts.model || FAST_MODEL)}:generateContent`, {
    method: "POST",
    headers: headers(),
    signal: anySignal(opts.signal, AbortSignal.timeout(opts.timeoutMs ?? 12000)),
    body: JSON.stringify({
      contents: [{ role: "user", parts: [...(opts.images || []).map(i => ({ inlineData: i })), { text: prompt }] }],
      generationConfig: {
        temperature: 0, responseMimeType: "application/json", maxOutputTokens: opts.maxTokens ?? 4096,
        // Optional: cap "thinking" for structured calls (e.g. GEMINI_JSON_THINKING_BUDGET=0 on 2.5 models).
        ...(process.env.GEMINI_JSON_THINKING_BUDGET ? { thinkingConfig: { thinkingBudget: Number(process.env.GEMINI_JSON_THINKING_BUDGET) } } : {}),
      },
    }),
  });
  const data = await res.json() as GeminiResponse;
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${data.error?.message || ""}`.slice(0, 200));
  const cand = data.candidates?.[0];
  const text = cand?.content?.parts?.map(p => p.text || "").join("") || "";
  if (!text.trim()) throw new Error(`빈 응답(${cand?.finishReason || "unknown"})`);
  const cleaned = text.replace(/^```(?:json)?\s*|\s*```$/g, "");
  try { return JSON.parse(cleaned) as T; }
  catch {
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]) as T;
    throw new Error(`JSON 파싱 실패(${cand?.finishReason || ""})`);
  }
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
