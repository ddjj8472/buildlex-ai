// Minimal Gemini client: JSON generation and SSE text streaming.
// MOCK_LLM=1 switches to deterministic fakes for local UI testing.
import { AsyncLocalStorage } from "node:async_hooks";

export const MODEL = process.env.GEMINI_MODEL || "gemini-3.1-flash-lite";
/** Lighter model for structured calls (analysis, rerank, evaluation). */
export const FAST_MODEL = process.env.GEMINI_FAST_MODEL || "gemini-flash-lite-latest";
/** Tried in order when the main model is overloaded (comma-separated env). */
export const FALLBACK_MODELS = (process.env.GEMINI_FALLBACK_MODELS || "gemini-flash-latest,gemini-flash-lite-latest").split(",").map(s => s.trim()).filter(Boolean);
/** Larger models for evaluation runs that must not fall back to lite ones (comma-separated env). */
export const STRONG_MODELS = (process.env.GEMINI_STRONG_MODELS || "gemini-3-flash-preview,gemini-flash-latest,gemini-pro-latest").split(",").map(s => s.trim()).filter(Boolean);
const isLite = (m: string) => /lite/i.test(m);
// Evaluation policy for one request: strong = every call goes to STRONG_MODELS, never a lite model.
const policy = new AsyncLocalStorage<{ strong: boolean }>();
export const strongOnly = () => policy.getStore()?.strong === true;
export const withStrongModels = <T,>(on: boolean, fn: () => Promise<T>) => (on ? policy.run({ strong: true }, fn) : fn());
/** The model to call for `m` under the current policy (a lite model maps to the first strong one). */
export const policyModel = (m: string) => (strongOnly() && isLite(m) ? STRONG_MODELS[0] : m);
const API = (process.env.GEMINI_API_BASE || "https://generativelanguage.googleapis.com/v1beta") + "/models";

export const isMock = () => process.env.MOCK_LLM === "1";
export const hasLLM = () => isMock() || !!process.env.GEMINI_API_KEY;

type Part = { text?: string };
export type InlineImage = { mimeType: string; data: string };
type GeminiResponse = { candidates?: { content?: { parts?: Part[] }; finishReason?: string }[]; error?: { message?: string } };

function headers() {
  return { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY || "" };
}

type JSONOpts = { model?: string; timeoutMs?: number; maxTokens?: number; signal?: AbortSignal; images?: InlineImage[]; /** Keep "thinking" short: thinkingLevel "low" on Gemini 3 / *-latest, thinkingBudget 1024 on 2.5. Dropped if the model rejects it. */ thinking?: "low"; temperature?: number; /** Only the given model: no fallback to the main/lighter models. */ only?: boolean; /** Under the strong-models policy, still call the lite model given (evaluation: sub-analyses stay on lite). */ allowLite?: boolean };

export async function generateJSON<T>(prompt: string, opts: JSONOpts = {}): Promise<T> {
  // Try the requested (fast) model, then the main model, then aliases — but only for
  // quick failures (overload, missing model, empty/invalid JSON). A timeout is final:
  // retrying it would blow the request's time budget.
  const models = strongOnly() && !opts.allowLite
    ? (opts.only ? [policyModel(opts.model || FAST_MODEL)] : [...new Set([policyModel(opts.model || FAST_MODEL), ...STRONG_MODELS])].slice(0, 3))
    : opts.only ? [opts.model || FAST_MODEL] : [...new Set([opts.model || FAST_MODEL, MODEL, ...FALLBACK_MODELS])].slice(0, 3);
  const deadline = Date.now() + (opts.timeoutMs ?? 12000);
  let last: unknown;
  for (const model of models) {
    const left = deadline - Date.now();
    if (left < 1500) break;
    try { return await generateJSONOnce<T>(prompt, { ...opts, model, timeoutMs: left }); }
    catch (e) {
      last = e;
      const msg = e instanceof Error ? `${e.name} ${e.message}` : String(e);
      if (opts.thinking && /\b400\b/.test(msg) && /thinking/i.test(msg)) {
        try { return await generateJSONOnce<T>(prompt, { ...opts, thinking: undefined, model, timeoutMs: deadline - Date.now() }); } catch (e2) { last = e2; }
      }
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
        temperature: opts.temperature ?? 0, responseMimeType: "application/json", maxOutputTokens: opts.maxTokens ?? 4096,
        // Optional: cap "thinking" for structured calls (e.g. GEMINI_JSON_THINKING_BUDGET=0 on 2.5 models).
        ...(opts.thinking ? { thinkingConfig: /gemini-2\./.test(opts.model || MODEL) ? { thinkingBudget: 1024 } : { thinkingLevel: opts.thinking } }
          : process.env.GEMINI_JSON_THINKING_BUDGET ? { thinkingConfig: { thinkingBudget: Number(process.env.GEMINI_JSON_THINKING_BUDGET) } } : {}),
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

/**
 * @param opts.firstTokenMs abort when no text has arrived by then. A model that is queued
 *   or stalled otherwise holds the whole request budget and leaves no time for fallbacks.
 */
export async function* streamText(prompt: string, opts: { model?: string; timeoutMs?: number; firstTokenMs?: number; maxTokens?: number; signal?: AbortSignal; /** thinkingLevel "low" (Gemini 3) so a larger model starts streaming sooner. */ thinking?: "low" } = {}): AsyncGenerator<string> {
  const stall = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined = opts.firstTokenMs
    ? setTimeout(() => stall.abort(new Error(`첫 응답 지연(${Math.round(opts.firstTokenMs! / 1000)}초) UNAVAILABLE`)), opts.firstTokenMs)
    : undefined;
  const clear = () => { if (timer) { clearTimeout(timer); timer = undefined; } };
  try {
  if (strongOnly() && isLite(opts.model || MODEL)) throw new Error("평가 모드: lite 모델 사용 안 함");
  const res = await fetch(`${API}/${encodeURIComponent(opts.model || MODEL)}:streamGenerateContent?alt=sse`, {
    method: "POST",
    headers: headers(),
    signal: anySignal(opts.signal, AbortSignal.timeout(opts.timeoutMs ?? 55000), stall.signal),
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      // Deterministic decoding: the same question should get the same legal conclusion.
      generationConfig: { temperature: 0, maxOutputTokens: opts.maxTokens ?? 4000, ...(opts.thinking ? { thinkingConfig: { thinkingLevel: opts.thinking } } : {}) },
    }),
  });
  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => "");
    throw new Error(`Gemini ${res.status}: ${body.slice(0, 200)}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  // The last chunk of a complete answer carries finishReason (STOP, or MAX_TOKENS when the cap is hit).
  // A stream that ends without one was cut off (overload mid-answer): throw so the caller retries
  // instead of returning the fragment as the answer.
  let finish = "";
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
        if (chunk.candidates?.[0]?.finishReason) finish = chunk.candidates[0].finishReason;
        if (text) { clear(); yield text; }
      } catch { /* partial line */ }
    }
  }
  if (!finish) throw new Error("응답 중단(스트림이 끝까지 오지 않음) UNAVAILABLE");
  if (!/^(STOP|MAX_TOKENS)$/.test(finish)) throw new Error(`응답 중단(${finish}) UNAVAILABLE`);
  } catch (e) {
    if (stall.signal.aborted) throw stall.signal.reason;
    throw e;
  } finally { clear(); }
}

function anySignal(...signals: (AbortSignal | undefined)[]): AbortSignal {
  const list = signals.filter((s): s is AbortSignal => !!s);
  return list.length === 1 ? list[0] : AbortSignal.any(list);
}
