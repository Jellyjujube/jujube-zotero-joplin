import {
  normalizeChatCompletionsUrl,
  normalizeModelsUrl,
  parseExtraHeaders,
} from "./aiConfig";
import { AiMessage, AiModelInfo } from "./aiTypes";
import { logInfo, logWarn } from "../utils/logger";

export type AiRequestFn = (
  method: string,
  url: string,
  options: any,
) => Promise<any>;

export interface AiClientConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
  extraHeaders?: Record<string, string> | string;
  timeoutMs?: number;
  maxRetries?: number;
  requestFn?: AiRequestFn;
  sleepFn?: (ms: number) => Promise<void>;
}

export interface AiChatResult {
  text: string;
  model: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
  };
  finishReason?: string;
  truncated: boolean;
  latencyMs: number;
  attempts: number;
}

export class AiError extends Error {
  code:
    "config" | "http" | "network" | "timeout" | "empty" | "parse" | "truncated";
  status?: number;
  retryable: boolean;

  constructor(
    message: string,
    code: AiError["code"],
    options: { status?: number; retryable?: boolean } = {},
  ) {
    super(message);
    this.name = "AiError";
    this.code = code;
    this.status = options.status;
    this.retryable = Boolean(options.retryable);
  }
}

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

function redact(value: string, apiKey: string): string {
  let text = String(value || "");
  if (apiKey) {
    text = text.split(apiKey).join("[redacted]");
  }
  return text.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]");
}

function responseData(response: any): any {
  if (response?.response !== undefined && response?.response !== null) {
    return response.response;
  }
  const text = safeResponseText(response);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function responseHeader(response: any, name: string): string {
  try {
    return String(
      response?.getResponseHeader?.(name) ||
        response?.getResponseHeader?.(name.toLowerCase()) ||
        "",
    );
  } catch {
    return "";
  }
}

function safeResponseText(response: any): string {
  try {
    return String(response?.responseText || "");
  } catch {
    return "";
  }
}

function errorDetail(response: any): string {
  const data = response?.response;
  if (typeof data === "string") return data;
  if (data?.error?.message) return String(data.error.message);
  if (data && typeof data === "object") {
    try {
      return JSON.stringify(data);
    } catch {
      return "";
    }
  }
  return safeResponseText(response);
}

function extractContent(data: any): string {
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part: any) => (typeof part === "string" ? part : part?.text || ""))
      .join("");
  }
  return "";
}

export class AiClient {
  private apiKey: string;
  private requestFn: AiRequestFn;
  private sleepFn: (ms: number) => Promise<void>;

  constructor(private config: AiClientConfig) {
    this.apiKey = String(config.apiKey || "").trim();
    this.requestFn =
      config.requestFn ||
      ((method, url, options) => Zotero.HTTP.request(method, url, options));
    this.sleepFn =
      config.sleepFn ||
      ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;
    const extra =
      typeof this.config.extraHeaders === "string"
        ? parseExtraHeaders(this.config.extraHeaders)
        : { headers: this.config.extraHeaders || {} };
    for (const [name, value] of Object.entries(extra.headers)) {
      if (name.toLowerCase() === "authorization" && this.apiKey) continue;
      headers[name] = value;
    }
    return headers;
  }

  private retryDelay(response: any, attempt: number): number {
    const retryAfter = responseHeader(response, "Retry-After");
    if (retryAfter) {
      const seconds = Number(retryAfter);
      if (Number.isFinite(seconds) && seconds >= 0) {
        return Math.min(30000, seconds * 1000);
      }
      const date = Date.parse(retryAfter);
      if (Number.isFinite(date)) {
        return Math.min(30000, Math.max(0, date - Date.now()));
      }
    }
    const base = Math.min(8000, 1000 * 2 ** Math.min(attempt, 4));
    return base + Math.floor(Math.random() * 250);
  }

  async chat(messages: AiMessage[]): Promise<AiChatResult> {
    const baseUrl = String(this.config.baseUrl || "").trim();
    const model = String(this.config.model || "").trim();
    if (!baseUrl) {
      throw new AiError("AI Base URL is empty", "config");
    }
    if (!model) {
      throw new AiError("AI model is empty", "config");
    }
    const url = normalizeChatCompletionsUrl(baseUrl);
    const headers = this.headers();
    const maxRetries = Math.max(0, Math.floor(this.config.maxRetries ?? 2));
    const timeout = Math.max(5000, Math.floor(this.config.timeoutMs ?? 120000));
    const started = Date.now();
    let lastError: AiError | null = null;
    let maxTokens = Math.max(1, Math.floor(this.config.maxTokens));
    let lengthRetryUsed = false;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      let response: any;
      const body = JSON.stringify({
        model,
        messages,
        temperature: this.config.temperature,
        max_tokens: maxTokens,
        stream: false,
      });
      logInfo(
        `AI request model=${model} max_tokens=${maxTokens} attempt=${attempt + 1}`,
      );
      try {
        response = await this.requestFn("POST", url, {
          body,
          headers,
          responseType: "json",
          successCodes: false,
          timeout,
        });
      } catch (caught) {
        const message = redact(
          caught instanceof Error ? caught.message : String(caught),
          this.apiKey,
        );
        lastError = new AiError(`AI request failed: ${message}`, "network", {
          retryable: true,
        });
        await logWarn(`AI network error attempt=${attempt + 1}: ${message}`);
        if (attempt < maxRetries) {
          await this.sleepFn(this.retryDelay(null, attempt));
          continue;
        }
        throw lastError;
      }

      const status = Number(response?.status || 0);
      if (status >= 200 && status < 300) {
        const data = responseData(response);
        if (!data) {
          throw new AiError("AI response is not valid JSON", "parse");
        }
        const text = extractContent(data);
        if (!String(text || "").trim()) {
          throw new AiError("AI response was empty", "empty");
        }
        const finishReason = String(data?.choices?.[0]?.finish_reason || "");
        if (finishReason === "length") {
          if (!lengthRetryUsed && maxTokens < 16384) {
            lengthRetryUsed = true;
            maxTokens = Math.min(16384, maxTokens * 2);
            await logWarn(
              `AI output hit max_tokens; retrying with max_tokens=${maxTokens}`,
            );
            attempt--;
            continue;
          }
          throw new AiError(
            "AI output was truncated by max_tokens",
            "truncated",
          );
        }
        await logInfo(
          `AI response status=${status} model=${String(data.model || model)} finish=${finishReason || "-"} prompt_tokens=${data.usage?.prompt_tokens ?? "-"} completion_tokens=${data.usage?.completion_tokens ?? "-"} latency_ms=${Date.now() - started}`,
        );
        return {
          text: String(text).trim(),
          model: String(data.model || model),
          usage: data.usage
            ? {
                promptTokens: data.usage.prompt_tokens,
                completionTokens: data.usage.completion_tokens,
              }
            : undefined,
          finishReason: finishReason || undefined,
          truncated: false,
          latencyMs: Date.now() - started,
          attempts: attempt + 1,
        };
      }

      const detail = redact(errorDetail(response), this.apiKey);
      lastError = new AiError(
        `AI API failed (HTTP ${status})${detail ? `: ${detail}` : ""}`,
        "http",
        { status, retryable: RETRYABLE_STATUS.has(status) },
      );
      await logWarn(`AI HTTP error status=${status} attempt=${attempt + 1}`);
      if (lastError.retryable && attempt < maxRetries) {
        await this.sleepFn(this.retryDelay(response, attempt));
        continue;
      }
      throw lastError;
    }
    throw lastError || new AiError("AI request failed", "http");
  }

  async listModels(): Promise<AiModelInfo[]> {
    const url = normalizeModelsUrl(this.config.baseUrl);
    if (!url) throw new AiError("AI Base URL is empty", "config");
    const response = await this.requestFn("GET", url, {
      headers: this.headers(),
      responseType: "json",
      successCodes: false,
      timeout: Math.min(30000, this.config.timeoutMs ?? 30000),
    });
    const status = Number(response?.status || 0);
    if (status < 200 || status >= 300) {
      const detail = redact(errorDetail(response), this.apiKey);
      throw new AiError(
        `AI model list failed (HTTP ${status})${detail ? `: ${detail}` : ""}`,
        "http",
        { status },
      );
    }
    const data = responseData(response);
    const raw = Array.isArray(data?.data)
      ? data.data
      : Array.isArray(data?.models)
        ? data.models
        : Array.isArray(data)
          ? data
          : [];
    const seen = new Set<string>();
    const result: AiModelInfo[] = [];
    for (const item of raw) {
      const id = String(item?.id ?? item?.name ?? item?.model ?? "").trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const pickNumber = (...values: unknown[]) => {
        for (const value of values) {
          const number = Number(value);
          if (Number.isFinite(number) && number > 0) return number;
        }
        return undefined;
      };
      result.push({
        id,
        contextLength: pickNumber(
          item?.context_length,
          item?.context_window,
          item?.max_context_length,
          item?.max_input_tokens,
          item?.top_provider?.context_length,
          item?.model_info?.["general.context_length"],
          item?.model_info?.["llama.context_length"],
        ),
        maxOutputTokens: pickNumber(
          item?.max_completion_tokens,
          item?.max_output_tokens,
          item?.top_provider?.max_completion_tokens,
          item?.model_info?.["general.max_output_tokens"],
        ),
      });
    }
    await logInfo(`AI models fetched: ${result.length}`);
    return result;
  }

  async testConnection(): Promise<{
    ok: true;
    model: string;
    detail?: string;
  }> {
    const modelsUrl = normalizeModelsUrl(this.config.baseUrl);
    if (modelsUrl) {
      try {
        const response = await this.requestFn("GET", modelsUrl, {
          headers: this.headers(),
          responseType: "json",
          successCodes: false,
          timeout: Math.min(30000, this.config.timeoutMs ?? 30000),
        });
        const status = Number(response?.status || 0);
        if (status >= 200 && status < 300) {
          return {
            ok: true,
            model: this.config.model,
            detail: "models",
          };
        }
      } catch {
        // Some OpenAI-compatible servers do not expose /models.
      }
    }

    const result = await this.chat([
      { role: "user", content: "Reply with the single word OK." },
    ]);
    return {
      ok: true,
      model: result.model || this.config.model,
      detail: "chat",
    };
  }
}
