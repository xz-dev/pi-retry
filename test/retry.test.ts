import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import {
  isRetryableAssistantError,
  type AssistantMessage,
} from "@earendil-works/pi-ai";
import { RETRY_MARKER, classifyError, loadConfig } from "../src/retry.js";

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

test("uses the OpenAI 520 no-body error as the default include", () => {
  const config = loadConfig("/path/that/does/not/exist");
  assert.deepEqual(config, {
    include: ["OpenAI API error (520): 520 status code (no body)"],
  });
  assert.ok(
    classifyError(
      errorMessage("Error: OpenAI API error (520): 520 status code (no body)"),
      config,
      true,
    ),
  );
});

test("configured include strings replace defaults and match case-insensitively", (t) => {
  const agentDir = temporaryAgentDir(t);
  writeFileSync(
    join(agentDir, "pi-retry.json"),
    JSON.stringify({ include: ["CUSTOM TRANSIENT FAILURE"] }),
  );

  const config = loadConfig(agentDir);
  const custom = classifyError(errorMessage("custom transient failure"), config, true);
  const defaultError = classifyError(
    errorMessage("Error: OpenAI API error (520): 520 status code (no body)"),
    config,
    true,
  );

  assert.match(custom?.errorMessage ?? "", /provider returned error/i);
  assert.equal(defaultError, undefined);
});

test("matching error is classified exactly once", () => {
  const message = errorMessage(
    "Error: OpenAI API error (520): 520 status code (no body)",
  );
  const config = loadConfig("/path/that/does/not/exist");
  const first = classifyError(message, config, true);

  assert.ok(first?.errorMessage);
  assert.equal(first.errorMessage.split(RETRY_MARKER).length - 1, 1);
  assert.equal(isRetryableAssistantError(first), true);
  assert.equal(classifyError(first, config, true), undefined);
});

test("does not change matching errors when Pi retry is disabled", () => {
  const result = classifyError(
    errorMessage("Error: OpenAI API error (520): 520 status code (no body)"),
    loadConfig("/path/that/does/not/exist"),
    false,
  );

  assert.equal(result, undefined);
});

test("does not override quota, billing, usage-limit, or context-overflow errors", () => {
  const broad = { include: ["error"] };
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
    "Error: input exceeds the context window",
    "Error: too many tokens",
  ];

  for (const value of protectedErrors) {
    assert.equal(classifyError(errorMessage(value), broad, true), undefined, value);
  }
});

test("leaves non-errors, unrelated errors, and native retryable errors unchanged", () => {
  const matchingSuccess = { ...errorMessage("custom error"), stopReason: "stop" as const };
  const matchingAbort = { ...errorMessage("custom error"), stopReason: "aborted" as const };

  assert.equal(classifyError(matchingSuccess, { include: ["custom"] }, true), undefined);
  assert.equal(classifyError(matchingAbort, { include: ["custom"] }, true), undefined);
  assert.equal(classifyError(errorMessage("HTTP 400 invalid request"), { include: ["520"] }, true), undefined);
  assert.equal(
    classifyError(
      errorMessage("OpenAI API error (503): service unavailable"),
      { include: ["503"] },
      true,
    ),
    undefined,
  );
});

test("invalid configuration fails closed", (t) => {
  const agentDir = temporaryAgentDir(t);
  const configPath = join(agentDir, "pi-retry.json");

  writeFileSync(configPath, "not json");
  assert.deepEqual(loadConfig(agentDir), { include: [] });

  writeFileSync(configPath, JSON.stringify({ include: [520] }));
  assert.deepEqual(loadConfig(agentDir), { include: [] });

  writeFileSync(configPath, JSON.stringify({ include: ["  ", " transient "] }));
  assert.deepEqual(loadConfig(agentDir), { include: ["transient"] });
});
