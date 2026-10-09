import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { once } from "node:events";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { createAssistantMessageEventStream, getModel, type AssistantMessage } from "@earendil-works/pi-ai/compat";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type ExtensionFactory,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import retry from "../src/retry.js";

const model = { ...getModel("openai", "gpt-4o")!, api: "openai-responses" as const, provider: "pi-retry-test", id: "fixture", baseUrl: "http://127.0.0.1:1" };

function response(failed: boolean, errorText = 'API error (502): {"retry_after":0.1}'): AssistantMessage {
  return {
    role: "assistant", api: model.api, provider: model.provider, model: model.id,
    content: failed ? [] : [{ type: "text", text: "recovered" }],
    stopReason: failed ? "error" : "stop",
    ...(failed ? { errorMessage: errorText } : {}),
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    timestamp: Date.now(),
  };
}

async function setup(t: TestContext, extension: ExtensionFactory, options: {
  maxRetries?: number; http?: boolean; config?: unknown; delayMs?: number; retryAfter?: number;
  ui?: boolean; rawBody?: boolean; repeatMessageEnd?: boolean; errorText?: string;
} = {}) {
  const directory = mkdtempSync(join("/var/tmp", "pi-retry-lifecycle-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  writeFileSync(join(directory, "settings.json"), JSON.stringify({
    retry: { enabled: true, maxRetries: options.maxRetries ?? 1, baseDelayMs: options.delayMs ?? 30 },
    compaction: { enabled: false },
  }));
  writeFileSync(join(directory, "pi-retry.json"), JSON.stringify(options.config ?? {}));
  const settingsManager = SettingsManager.create(directory, directory);
  const runtime = await ModelRuntime.create({
    authPath: join(directory, "auth.json"),
    modelsPath: null,
    modelsStorePath: join(directory, "models-cache.json"),
    allowModelNetwork: false,
  });
  const requests: number[] = [];
  let baseUrl = model.baseUrl;
  if (options.http) {
    const server = createServer((_request, response) => {
      requests.push(performance.now());
      response.writeHead(502, { "content-type": "application/json" });
      const body = { detail: "Temporary origin failure", status: 502, retry_after: options.retryAfter ?? 0.1 };
      response.end(JSON.stringify(options.rawBody ? body : { error: body }));
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    t.after(() => { server.closeAllConnections(); server.close(); });
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    baseUrl = `http://127.0.0.1:${address.port}/v1`;
  }
  runtime.registerProvider(model.provider, {
    api: model.api, baseUrl, apiKey: "test-only-not-a-real-key", models: [{ ...model, baseUrl }],
    ...(options.http ? {} : { streamSimple: () => {
      requests.push(performance.now());
      const stream = createAssistantMessageEventStream();
      queueMicrotask(() => {
        const message = response(requests.length === 1, options.errorText);
        stream.push({ type: "start", partial: message });
        if (message.stopReason === "error") stream.push({ type: "error", reason: "error", error: message });
        else stream.push({ type: "done", reason: "stop", message });
      });
      return stream;
    } }),
  });
  let ui: ExtensionContext["ui"] | undefined;
  const statuses: (string | undefined)[] = [];
  const loader = new DefaultResourceLoader({
    cwd: directory, agentDir: directory, settingsManager,
    noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
    systemPrompt: "Local retry lifecycle test.",
    extensionFactories: [(pi) => {
      pi.on("session_start", (_event, ctx) => { ui = ctx.ui; });
      return extension(pi);
    }, (pi) => {
      const observed = new Proxy(pi, {
        get(target, key, receiver) {
          if (key !== "on" || !options.repeatMessageEnd) return Reflect.get(target, key, receiver);
          return (event: string, handler: (...args: unknown[]) => unknown, ...rest: unknown[]) => {
            const wrapped = event !== "message_end" ? handler : async (...args: unknown[]) => {
              const result = await handler(...args);
              const input = args[0] as { message: { role: string; stopReason?: string } };
              if (input.message.role === "assistant" && input.message.stopReason === "error") {
                await sleep(100);
                await handler(...args);
              }
              return result;
            };
            return Reflect.apply(target.on, target, [event, wrapped, ...rest]);
          };
        },
      });
      retry(observed, directory);
    }],
  });
  await loader.reload();
  const { session } = await createAgentSession({
    cwd: directory, agentDir: directory, model: { ...model, baseUrl }, modelRuntime: runtime,
    settingsManager, sessionManager: SessionManager.inMemory(directory),
    resourceLoader: loader, tools: [], thinkingLevel: "off",
  });
  t.after(() => session.dispose());
  await session.bindExtensions({});
  if (options.ui) {
    assert.ok(ui);
    await session.bindExtensions({ uiContext: { ...ui, setStatus: (_key, value) => { statuses.push(value); } } });
  }
  return { session, requests, statuses };
}

test("native retry removes the failed response before the next extension context boundary", async (t) => {
  let failedAt = 0;
  const boundaries: { at: number; hasFailure: boolean; historyHasFailure: boolean }[] = [];
  const { session, requests } = await setup(t, (pi) => {
    pi.on("message_end", (event) => {
      if (event.message.role === "assistant" && event.message.stopReason === "error") failedAt = performance.now();
    });
    pi.on("context", (event, ctx) => {
      boundaries.push({ at: performance.now(),
        hasFailure: event.messages.some((m) => m.role === "assistant" && m.stopReason === "error"),
        historyHasFailure: ctx.sessionManager.getBranch().some((e) =>
          e.type === "message" && e.message.role === "assistant" && e.message.stopReason === "error"),
      });
    });
  });
  await session.prompt("Exercise the fake provider.");
  assert.equal(requests.length, 2);
  assert.equal(boundaries.length, 2);
  assert.equal(boundaries[1].hasFailure, false);
  assert.equal(boundaries[1].historyHasFailure, true);
  assert.ok(boundaries[1].at - failedAt >= 25, "native backoff must precede the context boundary");
});

test("an extension continuation after exhaustion retains the failure in context", async (t) => {
  const failurePresent: boolean[] = [];
  let queued = false;
  const { session, requests } = await setup(t, (pi) => {
    pi.on("context", (event) => {
      failurePresent.push(event.messages.some((m) => m.role === "assistant" && m.stopReason === "error"));
    });
    pi.on("agent_end", (event) => {
      if (!queued && event.messages.some((m) => m.role === "assistant" && m.stopReason === "error")) {
        queued = true;
        pi.sendMessage({ customType: "gate-continuation", content: "Continue the isolated check.", display: false },
          { triggerTurn: true, deliverAs: "followUp" });
      }
    });
  }, { maxRetries: 0, config: { include: [{ match: "502", waitMs: 1000 }] } });
  await session.prompt("Fail without native retries.");
  assert.equal(requests.length, 2);
  assert.deepEqual(failurePresent, [false, true]);
  assert.ok(requests[1] - requests[0] < 500, "exhaustion must not delay a separate continuation");
});

test("cancelling an awaited context boundary prevents the retry request", { timeout: 5000 }, async (t) => {
  let reached!: () => void;
  const waiting = new Promise<void>((resolve) => { reached = resolve; });
  let calls = 0;
  let observedAbort = false;
  const errors: string[] = [];
  const { session, requests, statuses } = await setup(t, (pi) => {
    pi.on("message_end", (event) => {
      if (event.message.role === "assistant" && event.message.errorMessage) errors.push(event.message.errorMessage);
    });
    pi.on("context", async (_event, ctx) => {
      if (++calls !== 2) return;
      reached();
      ctx.signal?.addEventListener("abort", () => { observedAbort = true; }, { once: true });
    });
  }, { http: true, retryAfter: 1, ui: true });
  const prompt = session.prompt("Cancel before the second provider request.");
  await waiting;
  await sleep(20);
  await session.abort();
  await prompt;
  assert.equal(observedAbort, true, `errors seen: ${JSON.stringify(errors)}`);
  assert.equal(requests.length, 1);
  assert.ok(statuses.some((value) => value?.includes("Retry cooldown")));
  assert.equal(statuses.at(-1), undefined);
});

test("queued fresh input has an observable message boundary before its own request", async (t) => {
  let userMessages = 0;
  let queued = false;
  const generations: number[] = [];
  const { session, requests } = await setup(t, (pi) => {
    pi.on("message_start", (event) => {
      if (event.message.role === "user") userMessages++;
    });
    pi.on("context", () => { generations.push(userMessages); });
    pi.on("agent_end", (event) => {
      if (!queued && event.messages.some((m) => m.role === "assistant" && m.stopReason === "error")) {
        queued = true;
        pi.sendUserMessage("A fresh user request.", { deliverAs: "followUp" });
      }
    });
  }, { config: { include: [{ match: "502", waitMs: 250 }] } });
  await session.prompt("Fail once, then process the queued request.");
  assert.equal(requests.length, 3);
  assert.deepEqual(generations, [1, 1, 2]);
  assert.ok(requests[2] - requests[1] < 200, "fresh input must not inherit the previous cooldown");
});

for (const example of [
  { name: "user override with an SDK-visible body", rawBody: false, waitMs: 250, retryAfter: 0.6, native: 100, expected: 250 },
  { name: "user override with a top-level body stripped by the SDK", rawBody: true, waitMs: 250, retryAfter: 0.6, native: 100, expected: 250 },
  { name: "visible server hint without an include match", rawBody: false, retryAfter: 0.25, native: 100, expected: 250 },
  { name: "native fallback when the SDK omits the body", rawBody: true, retryAfter: 0.6, native: 100, expected: 100 },
  { name: "explicit zero overrides a visible server hint", rawBody: false, waitMs: 0, retryAfter: 0.6, native: 100, expected: 100 },
  { name: "duplicate observation keeps the original deadline", rawBody: false, waitMs: 250, retryAfter: 0.6, native: 100, expected: 250, repeatMessageEnd: true },
  { name: "native backoff longer than the selected interval", rawBody: false, waitMs: 100, retryAfter: 0.6, native: 300, expected: 300 },
]) {
  test(`actual HTTP retry timing: ${example.name}`, async (t) => {
    let failedAt = 0;
    let originalError = "";
    const { session, requests, statuses } = await setup(t, (pi) => {
      pi.on("message_end", (event) => {
        if (!failedAt && event.message.role === "assistant" && event.message.stopReason === "error") {
          failedAt = performance.now();
          originalError = event.message.errorMessage ?? "";
        }
      });
    }, { http: true, ui: true, delayMs: example.native, retryAfter: example.retryAfter, rawBody: example.rawBody,
      repeatMessageEnd: example.repeatMessageEnd,
      config: { include: example.waitMs === undefined ? [] : [{ match: "502", waitMs: example.waitMs }] } });
    await session.prompt("Retry this local HTTP failure.");
    assert.equal(requests.length, 2);
    const interval = requests[1] - failedAt;
    assert.ok(interval >= example.expected - 1, `retry too early: ${interval}ms`);
    assert.ok(interval < example.expected + 90, `waits were added or precedence changed: ${interval}ms`);
    if (example.rawBody) assert.match(originalError, /no body/);
    else assert.match(originalError, /retry_after/);
    if (example.expected > example.native) {
      assert.ok(statuses.some((value) => value?.includes("Retry cooldown")));
      assert.equal(statuses.at(-1), undefined);
    } else assert.deepEqual(statuses, []);
    t.diagnostic(`Observed ${Math.round(interval)}ms from finalized error; body ${example.rawBody ? "omitted by SDK" : "visible"}`);
  });
}

for (const example of [
  { waitMs: 0, body: ' {"retry_after":0.3}', expected: 300 },
  { waitMs: 1000, body: ' {"retry_after":0.3}', expected: 300 },
  { waitMs: 1000, body: "", expected: 30 },
]) {
  test(`classification-only marker does not select waitMs=${example.waitMs}, server hint=${Boolean(example.body)}`, async (t) => {
    let failedAt = 0;
    const { session, requests } = await setup(t, (pi) => {
      pi.on("message_end", (event) => {
        if (event.message.role === "assistant" && event.message.stopReason === "error") failedAt = performance.now();
      });
    }, { errorText: `custom transient failure${example.body}`, config: { include: [
      "custom transient failure", { match: "provider returned error", waitMs: example.waitMs },
    ] } });
    await session.prompt("Exercise marker isolation.");
    assert.equal(requests.length, 2);
    const interval = requests[1] - failedAt;
    assert.ok(interval >= example.expected - 1, `synthetic marker suppressed the server wait: ${interval}ms`);
    assert.ok(interval < example.expected + 150, `synthetic marker imposed an unrelated wait: ${interval}ms`);
  });
}

test("each failed retry establishes a fresh minimum interval", async (t) => {
  const failures: number[] = [];
  const { session, requests } = await setup(t, (pi) => {
    pi.on("message_end", (event) => {
      if (event.message.role === "assistant" && event.message.stopReason === "error") failures.push(performance.now());
    });
  }, { http: true, maxRetries: 2, delayMs: 20, retryAfter: 0.1 });
  await session.prompt("Exercise two retries.");
  assert.equal(requests.length, 3);
  for (let i = 1; i < requests.length; i++) {
    assert.ok(requests[i] - failures[i - 1] >= 99, "each new failure must receive its own interval");
    assert.ok(requests[i] - failures[i - 1] < 190, "native backoff must count toward each interval");
  }
});

for (const action of ["reload", "dispose"] as const) {
  test(`${action} releases an active cooldown without sending the canceled request`, { timeout: 5000 }, async (t) => {
    let reached!: () => void;
    const waiting = new Promise<void>((resolve) => { reached = resolve; });
    let calls = 0;
    const { session, requests, statuses } = await setup(t, (pi) => {
      pi.on("context", () => { if (++calls === 2) reached(); });
    }, { ui: true, config: { include: [{ match: "502", waitMs: 1000 }] } });
    const prompt = session.prompt("Replace this waiting runtime.");
    await waiting;
    await sleep(20);
    if (action === "reload") await session.reload();
    else session.dispose();
    await Promise.allSettled([prompt]);
    assert.equal(requests.length, 1);
    assert.equal(statuses.at(-1), undefined);
  });
}

test("a long configured cooldown is cancellable without overflowing a platform timer", { timeout: 5000 }, async (t) => {
  let reached!: () => void;
  const waiting = new Promise<void>((resolve) => { reached = resolve; });
  let calls = 0;
  const warnings: string[] = [];
  const onWarning = (warning: Error) => { if (warning.name === "TimeoutOverflowWarning") warnings.push(warning.message); };
  process.on("warning", onWarning);
  t.after(() => { process.off("warning", onWarning); });
  const { session, requests } = await setup(t, (pi) => {
    pi.on("context", () => { if (++calls === 2) reached(); });
  }, { config: { include: [{ match: "502", waitMs: Number.MAX_SAFE_INTEGER }] } });
  const prompt = session.prompt("Cancel this long cooldown.");
  await waiting;
  await sleep(20);
  await session.abort();
  await prompt;
  assert.equal(requests.length, 1);
  assert.deepEqual(warnings, []);
});
