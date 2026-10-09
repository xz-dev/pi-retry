import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import {
  isContextOverflow,
  isRetryableAssistantError,
  type AssistantMessage,
} from "@earendil-works/pi-ai";
import {
  getAgentDir,
  SettingsManager,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";

export const CONFIG_FILE = "pi-retry.json";
export const DEFAULT_INCLUDE = [
  "OpenAI API error (520): 520 status code (no body)",
  "OpenAI API error (522): 522 status code (no body)",
  "OpenAI API error (530): 530 status code (no body)",
  "unknown certificate verification error",
  "upstream_error: Upstream request failed",
  "Upstream stream failed before completion.",
  "stream disconnected before completion",
  "Service temporarily unavailable due to resource pressure. Retry shortly.",
  "Upstream service temporarily unavailable",
  "are cooling down (reset after 5s)",
  "Responses WebSocket closed (1006): Connection ended",
  "Connection error.",
  "unexpected EOF.",
];
const DEFAULT_COMPACT = ["Reduce the prompt or route to a model with a larger input limit"];
export const RETRY_MARKER = "[pi-retry]";

export type IncludeRule = string | { match: string; waitMs: number };

export interface RetryConfig {
  include: IncludeRule[];
  compact: string[];
  disabled?: true;
}

function isIncludeRule(value: unknown): value is IncludeRule {
  return typeof value === "string" || (
    value !== null && typeof value === "object" && !Array.isArray(value) &&
    "match" in value && typeof value.match === "string" &&
    "waitMs" in value && typeof value.waitMs === "number" &&
    Number.isSafeInteger(value.waitMs) && value.waitMs >= 0
  );
}

function matchText(rule: IncludeRule): string {
  return typeof rule === "string" ? rule : rule.match;
}

const PROTECTED_LIMIT_PATTERN =
  /GoUsageLimitError|FreeUsageLimitError|usage.?limit|available balance|account balance|credit balance|credits?.{0,24}(?:exhausted|depleted)|quota|budget|billing|payment|spending.?(?:cap|limit)|hard.?limit|\b402\b/i;

export function loadConfig(agentDir = getAgentDir()): RetryConfig {
  const path = join(agentDir, CONFIG_FILE);
  const disabled: RetryConfig = { include: [], compact: [], disabled: true };
  try {
    const value: unknown = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
    if (!value || typeof value !== "object" || Array.isArray(value)) return disabled;

    const { include = [], compact = [], clearDefaults = false } = value as {
      include?: unknown;
      compact?: unknown;
      clearDefaults?: unknown;
    };
    if (
      typeof clearDefaults !== "boolean" ||
      !Array.isArray(include) || !include.every(isIncludeRule) ||
      !Array.isArray(compact) || compact.some((item) => typeof item !== "string")
    ) return disabled;

    const rules = include.map((rule) => typeof rule === "string"
      ? rule.trim()
      : { match: rule.match.trim(), waitMs: rule.waitMs });
    return {
      include: [...(clearDefaults ? [] : DEFAULT_INCLUDE), ...rules.filter((rule) => matchText(rule).length > 0)],
      compact: [...(clearDefaults ? [] : DEFAULT_COMPACT), ...compact.map((item) => item.trim()).filter(Boolean)],
    };
  } catch {
    return disabled;
  }
}

function matches(message: AssistantMessage, values: IncludeRule[]): boolean {
  if (message.stopReason !== "error" || !message.errorMessage) return false;

  const error = message.errorMessage.toLowerCase();
  return values.some((value) => error.includes(matchText(value).toLowerCase()));
}

export function normalizeContextOverflow(
  message: AssistantMessage,
  compact: string[],
): AssistantMessage | undefined {
  if (PROTECTED_LIMIT_PATTERN.test(message.errorMessage ?? "")) return;
  if (!matches(message, compact) || isContextOverflow(message)) return;

  return {
    ...message,
    errorMessage: `context_length_exceeded: ${message.errorMessage}`,
  };
}

const RETRY_HINT = `\n\n${RETRY_MARKER} provider returned error`;

function canRecover(
  message: AssistantMessage,
  config: RetryConfig,
  retryEnabled: boolean,
  excluded: string[],
): boolean {
  if (config.disabled || !retryEnabled || message.stopReason !== "error" || !message.errorMessage) return false;
  if (PROTECTED_LIMIT_PATTERN.test(message.errorMessage)) return false;
  if (matches(message, config.compact) || isContextOverflow(message)) return false;
  const error = message.errorMessage.toLowerCase();
  return !excluded.some((pattern) => pattern.trim() && error.includes(pattern.trim().toLowerCase()));
}

export function classifyError(
  message: AssistantMessage,
  config: RetryConfig,
  retryEnabled: boolean,
  excluded: string[] = [],
): AssistantMessage | undefined {
  if (!canRecover(message, config, retryEnabled, excluded)) return;
  if (message.errorMessage!.includes(RETRY_MARKER) || isRetryableAssistantError(message)) return;
  if (!matches(message, config.include)) return;
  return { ...message, errorMessage: `${message.errorMessage}${RETRY_HINT}` };
}

export function selectWaitMs(
  message: AssistantMessage,
  config: RetryConfig,
  retryEnabled: boolean,
  excluded: string[] = [],
): number | undefined {
  // Match provider text, not the classification hint added for Pi's retry detector.
  if (message.errorMessage?.endsWith(RETRY_HINT)) {
    message = { ...message, errorMessage: message.errorMessage.slice(0, -RETRY_HINT.length) };
  }
  if (!canRecover(message, config, retryEnabled, excluded)) return;
  if (!isRetryableAssistantError(message) && !matches(message, config.include)) return;

  let configured: number | undefined;
  for (const rule of config.include) {
    if (typeof rule !== "string" && matches(message, [rule])) {
      configured = Math.max(configured ?? 0, rule.waitMs);
    }
  }
  if (configured !== undefined) return configured;

  const text = message.errorMessage!;
  const start = text.indexOf("{");
  if (start < 0) return;
  try {
    const body: unknown = JSON.parse(text.slice(start));
    if (!body || typeof body !== "object" || Array.isArray(body) ||
        !("retry_after" in body) || !Object.hasOwn(body, "retry_after")) return;
    const seconds = body.retry_after;
    if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0) return;
    const milliseconds = Math.ceil(seconds * 1000);
    if (Number.isSafeInteger(milliseconds)) return milliseconds;
  } catch {
    // A provider may omit or format away its JSON body. Keep native timing in that case.
  }
}

type RetryContext = Pick<ExtensionContext, "cwd" | "isProjectTrusted">;

function retrySettings(ctx: RetryContext, agentDir: string): { enabled: boolean; nonRetryableErrorPatterns?: string[] } {
  return SettingsManager.create(ctx.cwd, agentDir, {
    projectTrusted: ctx.isProjectTrusted(),
  }).getRetrySettings();
}

export function classifyErrorForContext(
  message: AssistantMessage,
  config: RetryConfig,
  ctx: RetryContext,
  agentDir = getAgentDir(),
): AssistantMessage | undefined {
  const settings = retrySettings(ctx, agentDir);
  return classifyError(message, config, settings.enabled, settings.nonRetryableErrorPatterns);
}

function sameFailure(a: AssistantMessage, b: AssistantMessage): boolean {
  return a.stopReason === "error" && b.stopReason === "error" && a.timestamp === b.timestamp &&
    a.provider === b.provider && a.model === b.model && a.api === b.api;
}

export default function retry(pi: ExtensionAPI, agentDir = getAgentDir()): void {
  const config = loadConfig(agentDir);
  let pending: { message: AssistantMessage; sessionId: string; since: number; waitMs: number } | undefined;
  let waiting: { controller: AbortController; abortRequest: () => void; clearStatus: () => void } | undefined;

  const clear = () => {
    pending = undefined;
    const active = waiting;
    waiting = undefined;
    if (active) {
      // Invalidation must cancel the request as well as release its cooldown.
      try { active.abortRequest(); }
      finally { active.controller.abort(); active.clearStatus(); }
    }
  };

  pi.on("message_end", (event, ctx) => {
    if (event.message.role !== "assistant") return;
    const settings = retrySettings(ctx, agentDir);
    const replacement = normalizeContextOverflow(event.message, config.compact) ??
      classifyError(event.message, config, settings.enabled, settings.nonRetryableErrorPatterns);
    const message = replacement ?? event.message;
    const waitMs = selectWaitMs(message, config, settings.enabled, settings.nonRetryableErrorPatterns);
    if (waitMs === undefined || waitMs === 0) pending = undefined;
    else if (!pending || !sameFailure(message, pending.message)) {
      pending = { message, waitMs, since: performance.now(), sessionId: ctx.sessionManager.getSessionId() };
    }
    if (replacement) return { message: replacement };
  });

  pi.on("context", async (event, ctx) => {
    const cooldown = pending;
    pending = undefined;
    if (!cooldown || cooldown.sessionId !== ctx.sessionManager.getSessionId()) return;
    // Pi removes the failed attempt from its request context before retrying, but keeps raw history.
    // A new input or an exhausted-budget continuation is not that retry.
    if (event.messages.some((message) => message.role === "assistant" && sameFailure(message, cooldown.message))) return;
    const last = ctx.sessionManager.getBranch().filter((entry) => entry.type === "message").at(-1);
    if (!last || last.message.role !== "assistant" || !sameFailure(last.message, cooldown.message)) return;
    const remaining = () => Math.max(0, cooldown.waitMs - (performance.now() - cooldown.since));
    if (remaining() === 0 || ctx.signal?.aborted) return;

    const requestSignal = ctx.signal;
    const ui = ctx.hasUI ? ctx.ui : undefined;
    const status = (value?: string) => {
      try { ui?.setStatus("pi-retry", value); }
      catch { /* UI teardown must not affect waiting or cancellation. */ }
    };
    let statusCleared = false;
    const active = {
      controller: new AbortController(),
      abortRequest: () => { if (!requestSignal?.aborted) ctx.abort(); },
      clearStatus: () => {
        if (statusCleared) return;
        statusCleared = true;
        status();
      },
    };
    waiting = active;
    const signal = requestSignal ? AbortSignal.any([requestSignal, active.controller.signal]) : active.controller.signal;
    signal.addEventListener("abort", active.clearStatus, { once: true });
    status(`Retry cooldown: waiting ${Math.ceil(remaining() / 1000)}s (Esc to cancel)`);
    try {
      while (remaining() > 0 && !signal.aborted) {
        await sleep(Math.min(2147483647, Math.ceil(remaining())), undefined, { signal });
      }
    } catch (error) {
      if (!signal.aborted) throw error;
    } finally {
      signal.removeEventListener("abort", active.clearStatus);
      if (waiting === active) {
        waiting = undefined;
        active.clearStatus();
      }
    }
  });

  pi.on("message_start", (event) => {
    if (event.message.role === "user" || event.message.role === "custom") clear();
  });
  pi.on("model_select", () => { pending = undefined; });
  pi.on("session_start", clear);
  pi.on("session_tree", clear);
  pi.on("session_shutdown", clear);
  pi.on("agent_settled", clear);
  // Newer Pi hosts can request a message-free continuation here. Older hosts never emit this public event.
  Reflect.apply(pi.on, pi, ["agent_before_settle", clear]);
}
