/**
 * LLM provider abstraction — supports:
 *   - "glm":       GLM via z-ai SDK (default in sandbox, no key needed)
 *   - "deepseek":  DeepSeek API (set DEEPSEEK_API_KEY)
 *   - "nemotron":  NVIDIA NIM API for Nemotron (set NEMOTRON_API_KEY) — strong reasoner, free tier
 *   - "openai":    Any OpenAI-compatible endpoint (set OPENAI_API_KEY + OPENAI_BASE_URL)
 *   - "openrouter":OpenRouter — access many models with one key (set OPENROUTER_API_KEY)
 *
 * The LLM is the DECISIVE overlay — it's called rarely (only when HMM is
 * uncertain or a position decision is needed), not every cycle. This keeps
 * token usage low even with a strong model.
 *
 * Includes rate limiting + dedup to prevent 429s.
 */

// Lazy-load ZAI SDK only when GLM is actually used — avoids loading the SDK
// (and its heavy dependencies) on every server cold start.
let _ZAIModule: any = null;
async function getZaiModule(): Promise<any> {
  if (_ZAIModule) return _ZAIModule;
  _ZAIModule = await import("z-ai-web-dev-sdk");
  return _ZAIModule;
}

export type Provider = "glm" | "deepseek" | "nemotron" | "openai" | "openrouter";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  model?: string;
  reasoning?: boolean;
}

export interface ChatResult {
  content: string;
  reasoningContent?: string;
  latencyMs: number;
  provider: Provider;
  model: string;
  tokensUsed?: number;
}

/** Provider endpoint configuration. */
interface ProviderConfig {
  baseUrl: string;
  apiKey: string;
  defaultModel: string;
  reasoningModel: string;
}

const PROVIDER_CONFIGS: Record<Provider, ProviderConfig> = {
  glm: {
    baseUrl: "https://internal-api.z.ai/v1",
    apiKey: "",
    defaultModel: "glm-4.6",
    reasoningModel: "glm-4.6",
  },
  deepseek: {
    baseUrl: "https://api.deepseek.com/v1",
    apiKey: process.env.DEEPSEEK_API_KEY || "",
    defaultModel: "deepseek-chat",
    reasoningModel: "deepseek-reasoner",
  },
  nemotron: {
    baseUrl: "https://integrate.api.nvidia.com/v1",
    apiKey: process.env.NEMOTRON_API_KEY || "",
    defaultModel: "nvidia/llama-3.1-nemotron-70b-instruct",
    reasoningModel: "nvidia/llama-3.1-nemotron-70b-instruct",
  },
  openai: {
    baseUrl: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
    apiKey: process.env.OPENAI_API_KEY || "",
    defaultModel: "gpt-4o-mini",
    reasoningModel: "o3-mini",
  },
  openrouter: {
    baseUrl: "https://openrouter.ai/api/v1",
    apiKey: process.env.OPENROUTER_API_KEY || "",
    defaultModel: "meta-llama/llama-3.1-8b-instruct",
    reasoningModel: "nvidia/llama-3.1-nemotron-70b-instruct",
  },
};

// Cached ZAI SDK instance for GLM.
let _zai: any = null;
async function getZai(): Promise<any> {
  if (_zai) return _zai;
  const mod = await getZaiModule();
  _zai = await mod.default.create();
  return _zai;
}

/** Simple in-flight dedup — if the same prompt is being generated, wait for it. */
const inFlight = new Map<string, Promise<ChatResult>>();

/** Rate limiter — min ms between LLM calls. Prevents 429 storms. */
let _lastCallTs = 0;
const MIN_CALL_INTERVAL_MS = 1500; // max 1 call per 1.5s

async function rateLimit(): Promise<void> {
  const now = Date.now();
  const wait = MIN_CALL_INTERVAL_MS - (now - _lastCallTs);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  _lastCallTs = Date.now();
}

export async function chat(
  messages: ChatMessage[],
  opts: ChatOptions & { provider: Provider; configuredModel?: string },
): Promise<ChatResult> {
  const provider = opts.provider;
  const cfg = PROVIDER_CONFIGS[provider];

  if (provider !== "glm" && !cfg.apiKey) {
    throw new Error(
      `${provider.toUpperCase()}_API_KEY not set. Set it in .env to use ${provider}.`,
    );
  }

  const model = opts.model || opts.configuredModel || (opts.reasoning ? cfg.reasoningModel : cfg.defaultModel);

  // Dedup identical in-flight requests.
  const dedupKey = `${provider}:${model}:${JSON.stringify(messages).slice(0, 200)}`;
  const existing = inFlight.get(dedupKey);
  if (existing) return existing;

  const promise = doChat(messages, opts, model, provider, cfg).finally(() => {
    inFlight.delete(dedupKey);
  });
  inFlight.set(dedupKey, promise);
  return promise;
}

async function doChat(
  messages: ChatMessage[],
  opts: ChatOptions,
  model: string,
  provider: Provider,
  cfg: ProviderConfig,
): Promise<ChatResult> {
  // Rate limit to avoid 429s.
  await rateLimit();

  if (provider === "glm") {
    return glmChat(messages, opts, model);
  }

  const start = Date.now();
  const body: any = {
    model,
    messages,
    temperature: opts.temperature ?? 0.4,
    max_tokens: opts.maxTokens ?? 700,
    stream: false,
  };

  if (provider === "openai" && opts.reasoning && model.startsWith("o")) {
    body.reasoning_effort = "medium";
    delete body.temperature;
  }

  // Retry with exponential backoff for 429s.
  let lastErr: any = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${cfg.apiKey}`,
          ...(provider === "openrouter"
            ? { "HTTP-Referer": "https://markov-desk.local", "X-Title": "Markov Desk" }
            : {}),
        },
        body: JSON.stringify(body),
      });

      if (res.status === 429) {
        lastErr = new Error(`${provider} rate limited (429)`);
        const waitMs = Math.min(3000 * Math.pow(2, attempt), 12000);
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        throw new Error(`${provider} API ${res.status}: ${errText.slice(0, 200)}`);
      }

      const json = await res.json();
      const choice = json?.choices?.[0]?.message;
      return {
        content: choice?.content ?? "",
        reasoningContent: choice?.reasoning_content,
        latencyMs: Date.now() - start,
        provider,
        model,
        tokensUsed: json?.usage?.total_tokens,
      };
    } catch (e: any) {
      lastErr = e;
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
        continue;
      }
    }
  }
  throw lastErr ?? new Error(`${provider} chat failed`);
}

async function glmChat(
  messages: ChatMessage[],
  opts: ChatOptions,
  model: string,
): Promise<ChatResult> {
  const start = Date.now();
  const zai = await getZai();

  const body: any = {
    messages,
    temperature: opts.temperature ?? 0.4,
    max_tokens: opts.maxTokens ?? 700,
  };
  if (model) body.model = model;
  if (opts.reasoning) body.thinking = { type: "enabled" };

  let lastErr: any = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const completion: any = await zai.chat.completions.create(body);
      const content: string =
        completion?.choices?.[0]?.message?.content ??
        completion?.message?.content ??
        (typeof completion === "string" ? completion : "");
      return {
        content,
        reasoningContent: completion?.choices?.[0]?.message?.reasoning_content,
        latencyMs: Date.now() - start,
        provider: "glm",
        model: model || "glm-default",
        tokensUsed: completion?.usage?.total_tokens,
      };
    } catch (e: any) {
      lastErr = e;
      // 429 → wait longer
      const msg = String(e?.message || e);
      if (msg.includes("429") || msg.includes("Too many")) {
        const waitMs = Math.min(3000 * Math.pow(2, attempt), 15000);
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }
      // Other errors — one retry
      if (attempt < 1) {
        await new Promise((r) => setTimeout(r, 1000));
        continue;
      }
    }
  }
  throw lastErr ?? new Error("GLM chat failed");
}

/** Check which providers are configured (for UI display). */
export function availableProviders(): Provider[] {
  const out: Provider[] = ["glm"];
  if (process.env.DEEPSEEK_API_KEY) out.push("deepseek");
  if (process.env.NEMOTRON_API_KEY) out.push("nemotron");
  if (process.env.OPENAI_API_KEY) out.push("openai");
  if (process.env.OPENROUTER_API_KEY) out.push("openrouter");
  return out;
}

/** Human-readable description for the UI. */
export function providerDescription(p: Provider): { label: string; cost: string; strength: string } {
  const map: Record<Provider, { label: string; cost: string; strength: string }> = {
    glm: { label: "GLM 4.6", cost: "Free (sandbox)", strength: "Good general reasoner" },
    deepseek: { label: "DeepSeek", cost: "$0.14/1M tokens", strength: "Best for trading reflection (deepseek-reasoner)" },
    nemotron: { label: "Nemotron 70B", cost: "Free tier (NVIDIA NIM)", strength: "Strong reasoner, free" },
    openai: { label: "OpenAI", cost: "$0.15-15/1M tokens", strength: "GPT-4o-mini cheap, o3-mini strong" },
    openrouter: { label: "OpenRouter", cost: "Varies by model", strength: "Access 100+ models, one key" },
  };
  return map[p];
}
