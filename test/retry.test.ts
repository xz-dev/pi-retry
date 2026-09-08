import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import {
  isContextOverflow,
  isRetryableAssistantError,
  type AssistantMessage,
} from "@earendil-works/pi-ai";
import {
  RETRY_MARKER,
  classifyError,
  classifyErrorForContext,
  loadConfig,
  normalizeContextOverflow,
  type RetryConfig,
} from "../src/retry.js";

function errorMessage(errorMessage: string): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: "openai-responses",
    provider: "openai",
    model: "gpt-test",
    usage: {
      input: 1,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 1,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "error",
    errorMessage,
    timestamp: Date.now(),
  };
}

function temporaryAgentDir(t: TestContext): string {
  const directory = mkdtempSync(join(tmpdir(), "pi-retry-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

const expectedDefaults = {
  include: [
    "OpenAI API error (520): 520 status code (no body)",
    "OpenAI API error (522): 522 status code (no body)",
    "OpenAI API error (530): 530 status code (no body)",
    "unknown certificate verification error",
    "upstream_error: Upstream request failed",
    "Upstream stream failed before completion.",
    "Service temporarily unavailable due to resource pressure. Retry shortly.",
    "are cooling down (reset after 5s)",
    "Responses WebSocket closed (1006): Connection ended",
    "Connection error.",
  ],
  compact: ["Reduce the prompt or route to a model with a larger input limit"],
};

test("uses built-in recovery rules without creating a configuration file", (t) => {
  const agentDir = temporaryAgentDir(t);
  const config = loadConfig(agentDir);
  assert.deepEqual(config, expectedDefaults);
  assert.equal(existsSync(join(agentDir, "pi-retry.json")), false);
  assert.ok(
    classifyError(
      errorMessage("Error: OpenAI API error (520): 520 status code (no body)"),
      config,
      true,
    ),
  );
  const overflow = normalizeContextOverflow(errorMessage(config.compact[0]), config.compact);
  assert.ok(overflow);
  assert.equal(isContextOverflow(overflow), true);
});

test("partial configuration appends rules unless both default lists are cleared", (t) => {
  const agentDir = temporaryAgentDir(t);
  const configPath = join(agentDir, "pi-retry.json");
  const cases: { input: unknown; expected: RetryConfig }[] = [
    { input: {}, expected: expectedDefaults },
    { input: { include: [], compact: [] }, expected: expectedDefaults },
    { input: { clearDefaults: false }, expected: expectedDefaults },
    { input: { unused: true }, expected: expectedDefaults },
    {
      input: { compact: ["custom overflow"] },
      expected: { include: expectedDefaults.include, compact: [...expectedDefaults.compact, "custom overflow"] },
    },
    { input: { clearDefaults: true }, expected: { include: [], compact: [] } },
    {
      input: { clearDefaults: true, include: ["custom transient error"] },
      expected: { include: ["custom transient error"], compact: [] },
    },
    {
      input: { clearDefaults: true, compact: ["custom overflow"] },
      expected: { include: [], compact: ["custom overflow"] },
    },
    {
      input: { clearDefaults: true, include: ["  ", " TRANSIENT.FAILURE "], compact: ["  ", " overflow "] },
      expected: { include: ["TRANSIENT.FAILURE"], compact: ["overflow"] },
    },
  ];

  for (const { input, expected } of cases) {
    const json = JSON.stringify(input);
    writeFileSync(configPath, json);
    const config = loadConfig(agentDir);
    assert.deepEqual(config, expected, json);
    assert.equal(readFileSync(configPath, "utf8"), json);
    assert.equal(
      Boolean(classifyError(errorMessage(expectedDefaults.include[0]), config, true)),
      expected.include.includes(expectedDefaults.include[0]),
      json,
    );
    assert.equal(
      Boolean(normalizeContextOverflow(errorMessage(expectedDefaults.compact[0]), config.compact)),
      expected.compact.includes(expectedDefaults.compact[0]),
      json,
    );
  }
  const normalized = loadConfig(agentDir);
  assert.ok(classifyError(errorMessage("transient.failure"), normalized, true));
  assert.equal(classifyError(errorMessage("transientXfailure"), normalized, true), undefined);
});

test("loaded rule lists do not mutate defaults or later loads", (t) => {
  const agentDir = temporaryAgentDir(t);
  for (const configured of [false, true]) {
    if (configured) writeFileSync(join(agentDir, "pi-retry.json"), "{}");
    const config = loadConfig(agentDir);
    config.include.length = 0;
    config.compact.push("unexpected overflow");
    assert.deepEqual(loadConfig(agentDir), expectedDefaults);
  }
});

test("configured include strings append to defaults and match case-insensitively", (t) => {
  const agentDir = temporaryAgentDir(t);
  writeFileSync(
    join(agentDir, "pi-retry.json"),
    JSON.stringify({ include: ["CUSTOM TRANSIENT FAILURE"], compact: [] }),
  );

  const config = loadConfig(agentDir);
  const custom = classifyError(errorMessage("custom transient failure"), config, true);
  const defaultError = classifyError(
    errorMessage("Error: OpenAI API error (520): 520 status code (no body)"),
    config,
    true,
  );

  assert.match(custom?.errorMessage ?? "", /provider returned error/i);
  assert.ok(defaultError);
  assert.deepEqual(config.compact, expectedDefaults.compact);
});

test("duplicate configured matches still classify an error exactly once", (t) => {
  const agentDir = temporaryAgentDir(t);
  writeFileSync(join(agentDir, "pi-retry.json"), JSON.stringify({ include: [expectedDefaults.include[0]] }));
  const message = errorMessage(
    "Error: OpenAI API error (520): 520 status code (no body)",
  );
  const config = loadConfig(agentDir);
  const first = classifyError(message, config, true);

  assert.ok(first?.errorMessage);
  assert.equal(first.errorMessage.split(RETRY_MARKER).length - 1, 1);
  assert.equal(isRetryableAssistantError(first), true);
  assert.equal(classifyError(first, config, true), undefined);
});

test("does not change matching errors when file-backed Pi retry is disabled", (t) => {
  const agentDir = temporaryAgentDir(t);
  mkdirSync(join(agentDir, "project"));
  writeFileSync(
    join(agentDir, "settings.json"),
    JSON.stringify({ retry: { enabled: false } }),
  );

  const result = classifyErrorForContext(
    errorMessage("Error: OpenAI API error (520): 520 status code (no body)"),
    loadConfig("/path/that/does/not/exist"),
    { cwd: join(agentDir, "project"), isProjectTrusted: () => false },
    agentDir,
  );

  assert.equal(result, undefined);
});

test("normalizes configured compact strings for native compaction recovery", (t) => {
  const agentDir = temporaryAgentDir(t);
  writeFileSync(
    join(agentDir, "pi-retry.json"),
    JSON.stringify({
      include: ["error"],
      compact: ["REDUCE THE PROMPT OR ROUTE TO A MODEL WITH A LARGER INPUT LIMIT"],
    }),
  );
  const config = loadConfig(agentDir);
  const original = errorMessage(
    "Error: Input exceeds maximum input tokens for codex/gpt-5.6-sol: estimated 379871 input tokens, max input 353400. Reduce the prompt or route to a model with a larger input limit.",
  );
  const normalized = normalizeContextOverflow(original, config.compact);

  assert.ok(normalized?.errorMessage?.startsWith("context_length_exceeded:"));
  assert.match(normalized?.errorMessage ?? "", /Reduce the prompt or route to a model with a larger input limit/);
  assert.equal(isContextOverflow(original), false);
  assert.equal(isContextOverflow(normalized!), true);
  assert.equal(isRetryableAssistantError(normalized!), false);
  assert.equal(classifyError(original, config, true), undefined);
  assert.equal(classifyError(original, config, false), undefined);
  assert.equal(normalizeContextOverflow(normalized!, config.compact), undefined);
  assert.equal(normalizeContextOverflow(original, []), undefined);
  assert.equal(normalizeContextOverflow(errorMessage("HTTP 400 invalid request"), config.compact), undefined);
  assert.equal(
    normalizeContextOverflow(errorMessage("Provider quota exceeded"), ["quota exceeded"]),
    undefined,
  );
});

test("does not override quota, billing, usage-limit, or context-overflow errors", () => {
  const broad = { include: ["error", "credits"], compact: [] };
  const protectedErrors = [
    "OpenAI error: insufficient_quota",
    "Provider error: quota exceeded",
    "Provider error: out of budget",
    "Provider billing error",
    "GoUsageLimitError",
    "FreeUsageLimitError",
    "Monthly usage limit reached",
    "Provider usage-limit error",
    "Provider budget exceeded",
    "Provider error: available balance required",
    "HTTP 402 Payment Required",
    "Account credits exhausted",
    "Credit balance depleted",
    "Account balance exhausted",
    "Spending cap reached",
    "Hard limit reached",
    "Payment method required",
    "Payment declined error",
    "Payment-required error",
    "Spending limit reached error",
    "Hard-limit reached error",
    "Account credits have been exhausted",
    "Error: input exceeds the context window",
    "Error: too many tokens",
  ];

  for (const value of protectedErrors) {
    assert.equal(classifyError(errorMessage(value), broad, true), undefined, value);
    assert.equal(classifyError(errorMessage(value), { include: [value], compact: [] }, true), undefined, value);
    assert.equal(normalizeContextOverflow(errorMessage(value), [value]), undefined, value);
  }
});

test("leaves non-errors, unrelated errors, and native retryable errors unchanged", () => {
  const matchingSuccess = { ...errorMessage("custom error"), stopReason: "stop" as const };
  const matchingAbort = { ...errorMessage("custom error"), stopReason: "aborted" as const };

  assert.equal(classifyError(errorMessage(""), { include: ["custom"], compact: [] }, true), undefined);
  assert.equal(classifyError(matchingSuccess, { include: ["custom"], compact: [] }, true), undefined);
  assert.equal(classifyError(matchingAbort, { include: ["custom"], compact: [] }, true), undefined);
  assert.equal(
    classifyError(errorMessage("HTTP 400 invalid request"), { include: ["520"], compact: [] }, true),
    undefined,
  );
  assert.equal(
    classifyError(
      errorMessage("OpenAI API error (503): service unavailable"),
      { include: ["503"], compact: [] },
      true,
    ),
    undefined,
  );
});

test("invalid configuration fails closed", (t) => {
  const agentDir = temporaryAgentDir(t);
  const configPath = join(agentDir, "pi-retry.json");

  writeFileSync(configPath, "not json");
  assert.deepEqual(loadConfig(agentDir), { include: [], compact: [] });

  for (const value of [
    null, [], false, 520, "invalid",
    { include: [520] }, { include: null }, { include: "error" },
    { compact: [520] }, { include: ["valid"], compact: null },
    { clearDefaults: "false" }, { clearDefaults: null }, { clearDefaults: 0 },
  ]) {
    const json = JSON.stringify(value);
    writeFileSync(configPath, json);
    assert.deepEqual(loadConfig(agentDir), { include: [], compact: [] }, json);
  }
});

test("configuration read failures disable both rule sets", (t) => {
  const agentDir = temporaryAgentDir(t);
  mkdirSync(join(agentDir, "pi-retry.json"));
  assert.deepEqual(loadConfig(agentDir), { include: [], compact: [] });
});
