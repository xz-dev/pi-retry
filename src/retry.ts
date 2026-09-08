import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
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
  "Service temporarily unavailable due to resource pressure. Retry shortly.",
  "are cooling down (reset after 5s)",
  "Responses WebSocket closed (1006): Connection ended",
  "Connection error.",
];
const DEFAULT_COMPACT = ["Reduce the prompt or route to a model with a larger input limit"];
export const RETRY_MARKER = "[pi-retry]";

export interface RetryConfig {
  include: string[];
  compact: string[];
}

const PROTECTED_LIMIT_PATTERN =
  /GoUsageLimitError|FreeUsageLimitError|usage.?limit|available balance|account balance|credit balance|credits?.{0,24}(?:exhausted|depleted)|quota|budget|billing|payment|spending.?(?:cap|limit)|hard.?limit|\b402\b/i;

export function loadConfig(agentDir = getAgentDir()): RetryConfig {
  const path = join(agentDir, CONFIG_FILE);
  try {
    const value: unknown = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return { include: [], compact: [] };
    }

    const { include = [], compact = [], clearDefaults = false } = value as {
      include?: unknown;
      compact?: unknown;
      clearDefaults?: unknown;
    };
    if (
      typeof clearDefaults !== "boolean" ||
      !Array.isArray(include) ||
      include.some((item) => typeof item !== "string") ||
      !Array.isArray(compact) ||
      compact.some((item) => typeof item !== "string")
    ) {
      return { include: [], compact: [] };
    }

    return {
      include: [...(clearDefaults ? [] : DEFAULT_INCLUDE), ...include.map((item) => item.trim()).filter(Boolean)],
      compact: [...(clearDefaults ? [] : DEFAULT_COMPACT), ...compact.map((item) => item.trim()).filter(Boolean)],
    };
  } catch {
    return { include: [], compact: [] };
  }
}

function matches(message: AssistantMessage, values: string[]): boolean {
  if (message.stopReason !== "error" || !message.errorMessage) return false;

  const error = message.errorMessage.toLowerCase();
  return values.some((value) => error.includes(value.toLowerCase()));
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

export function classifyError(
  message: AssistantMessage,
  config: RetryConfig,
  retryEnabled: boolean,
): AssistantMessage | undefined {
  if (!retryEnabled || message.stopReason !== "error" || !message.errorMessage) return;
  if (message.errorMessage.includes(RETRY_MARKER)) return;
  if (PROTECTED_LIMIT_PATTERN.test(message.errorMessage)) return;
  if (matches(message, config.compact) || isContextOverflow(message)) return;
  if (isRetryableAssistantError(message)) return;

  if (!matches(message, config.include)) return;

  return {
    ...message,
    errorMessage: `${message.errorMessage}\n\n${RETRY_MARKER} provider returned error`,
  };
}

type RetryContext = Pick<ExtensionContext, "cwd" | "isProjectTrusted">;

export function classifyErrorForContext(
  message: AssistantMessage,
  config: RetryConfig,
  ctx: RetryContext,
  agentDir = getAgentDir(),
): AssistantMessage | undefined {
  const retryEnabled = SettingsManager.create(ctx.cwd, agentDir, {
    projectTrusted: ctx.isProjectTrusted(),
  }).getRetrySettings().enabled;

  return classifyError(message, config, retryEnabled);
}

export default function retry(pi: ExtensionAPI): void {
  const config = loadConfig();

  pi.on("message_end", (event, ctx) => {
    if (event.message.role !== "assistant") return;

    const overflow = normalizeContextOverflow(event.message, config.compact);
    if (overflow) return { message: overflow };

    const retry = classifyErrorForContext(event.message, config, ctx);
    if (retry) return { message: retry };
  });
}
