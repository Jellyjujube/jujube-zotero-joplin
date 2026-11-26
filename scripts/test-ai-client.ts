import { AiClient, AiError } from "../src/modules/aiClient";

function response(
  status: number,
  data?: any,
  headers: Record<string, string> = {},
) {
  return {
    status,
    response: data,
    responseText: data ? JSON.stringify(data) : "",
    getResponseHeader: (name: string) =>
      headers[name] || headers[name.toLowerCase()] || "",
  };
}

let lastCall: any = null;
let calls = 0;

const client = new AiClient({
  baseUrl: "https://api.example.test/v1",
  apiKey: "secret-key",
  model: "test-model",
  temperature: 0.1,
  maxTokens: 128,
  extraHeaders: '{"X-Test":"yes"}',
  maxRetries: 2,
  sleepFn: async () => {},
  requestFn: async (method, url, options) => {
    calls++;
    lastCall = { method, url, options };
    if (calls === 1)
      return response(200, {
        choices: [{ message: { content: "hello" } }],
        model: "m1",
      });
    if (calls === 2)
      return response(200, {
        choices: [
          {
            message: {
              content: [
                { type: "text", text: "part1" },
                { type: "text", text: "part2" },
              ],
            },
          },
        ],
        model: "m2",
      });
    if (calls === 3)
      return response(
        429,
        { error: { message: "rate" } },
        { "Retry-After": "0" },
      );
    if (calls === 4)
      return response(200, {
        choices: [{ message: { content: "after-retry" } }],
        model: "m3",
      });
    if (calls === 5)
      return response(401, { error: { message: "bad key secret-key" } });
    if (calls >= 6 && calls <= 8)
      return response(500, { error: { message: "server" } });
    if (calls === 9)
      return response(200, {
        choices: [{ message: { content: "models" } }],
        model: "m4",
      });
    return response(200, { choices: [{ message: { content: "ok" } }] });
  },
});

const messages = [{ role: "user" as const, content: "hi" }];
const first = await client.chat(messages);
if (first.text !== "hello" || first.model !== "m1")
  throw new Error("basic chat failed");
if (lastCall.url !== "https://api.example.test/v1/chat/completions")
  throw new Error(`URL normalization failed: ${lastCall.url}`);
if (lastCall.options.headers.Authorization !== "Bearer secret-key")
  throw new Error("auth header missing");
if (lastCall.options.headers["X-Test"] !== "yes")
  throw new Error("extra header missing");
const parsedBody = JSON.parse(lastCall.options.body);
if (
  parsedBody.model !== "test-model" ||
  parsedBody.stream !== false ||
  parsedBody.max_tokens !== 128
) {
  throw new Error("request body incorrect");
}

const second = await client.chat(messages);
if (second.text !== "part1part2")
  throw new Error("content array parsing failed");

const retried = await client.chat(messages);
if (retried.text !== "after-retry" || retried.attempts !== 2) {
  throw new Error(`retry failed: ${JSON.stringify(retried)}`);
}

try {
  await client.chat(messages);
  throw new Error("401 should fail");
} catch (error) {
  if (!(error instanceof AiError) || error.status !== 401 || error.retryable) {
    throw new Error(`401 classification failed: ${error}`, { cause: error });
  }
  if (String(error.message).includes("secret-key"))
    throw new Error("API key was not redacted", { cause: error });
}

try {
  await client.chat(messages);
  throw new Error("500 should fail");
} catch (error) {
  if (!(error instanceof AiError) || error.status !== 500)
    throw new Error("500 classification failed", { cause: error });
}

let truncationCalls = 0;
const truncationBodies: any[] = [];
const truncationClient = new AiClient({
  baseUrl: "https://api.example.test/v1",
  apiKey: "secret",
  model: "test-model",
  temperature: 0,
  maxTokens: 128,
  maxRetries: 0,
  requestFn: async (_method, _url, options) => {
    truncationCalls++;
    truncationBodies.push(JSON.parse(options.body));
    if (truncationCalls === 1) {
      return response(200, {
        choices: [
          {
            message: { content: "partial" },
            finish_reason: "length",
          },
        ],
      });
    }
    return response(200, {
      choices: [
        {
          message: { content: "complete" },
          finish_reason: "stop",
        },
      ],
    });
  },
});
const truncated = await truncationClient.chat(messages);
if (
  truncated.text !== "complete" ||
  truncationCalls !== 2 ||
  truncationBodies[1].max_tokens !== 256
) {
  throw new Error(
    `truncation retry failed: ${JSON.stringify({ truncated, truncationCalls, bodies: truncationBodies })}`,
  );
}

const modelsClient = new AiClient({
  baseUrl: "https://api.example.test/v1",
  apiKey: "secret",
  model: "test-model",
  temperature: 0,
  maxTokens: 128,
  requestFn: async (_method, url) => {
    if (!url.endsWith("/models")) {
      throw new Error(`unexpected model URL: ${url}`);
    }
    return response(200, {
      data: [
        {
          id: "model-a",
          context_length: 128000,
          max_completion_tokens: 4096,
        },
        { id: "model-b" },
        { id: "model-a" },
      ],
    });
  },
});
const models = await modelsClient.listModels();
if (
  models.length !== 2 ||
  models[0].id !== "model-a" ||
  models[0].contextLength !== 128000 ||
  models[0].maxOutputTokens !== 4096 ||
  models[1].id !== "model-b"
) {
  throw new Error(`listModels failed: ${JSON.stringify(models)}`);
}

const brokenXhr: any = {
  status: 500,
  response: null,
  getResponseHeader: () => "",
};
Object.defineProperty(brokenXhr, "responseText", {
  get() {
    throw new Error("InvalidStateError: responseText is not available");
  },
});
const brokenClient = new AiClient({
  baseUrl: "https://api.example.test/v1",
  apiKey: "secret",
  model: "test-model",
  temperature: 0,
  maxTokens: 128,
  maxRetries: 0,
  requestFn: async () => brokenXhr,
});
try {
  await brokenClient.chat(messages);
  throw new Error("broken XHR should fail");
} catch (error) {
  if (
    !(error instanceof AiError) ||
    error.status !== 500 ||
    String(error.message).includes("InvalidStateError")
  ) {
    throw new Error(`responseText getter handling failed: ${error}`, {
      cause: error,
    });
  }
}

const test = await client.testConnection();
if (!test.ok || test.detail !== "models")
  throw new Error(`testConnection failed: ${JSON.stringify(test)}`);

const bare = new AiClient({
  baseUrl: "api.example.test",
  apiKey: "",
  model: "m",
  temperature: 0,
  maxTokens: 8,
  requestFn: async (_method, url) => {
    lastCall = { url };
    return response(200, { choices: [{ message: { content: "ok" } }] });
  },
});
await bare.chat(messages);
if (lastCall.url !== "https://api.example.test/v1/chat/completions") {
  throw new Error(`bare URL failed: ${lastCall.url}`);
}

console.log("AI client tests: OK");
