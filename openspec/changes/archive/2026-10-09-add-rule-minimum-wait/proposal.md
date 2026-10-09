## Why

Pi already retries errors such as an OpenAI-compatible gateway's Cloudflare 502, but its default backoff can retry before the gateway has recovered. Users need configurable minimum intervals for selected error substrings, with their explicit settings taking precedence over a server's JSON `retry_after` hint and that hint used when no timed rule matches, without adding the selected interval on top of Pi's existing delay or replacing Pi's retry lifecycle.

## What Changes

- Extend `include` entries to accept either existing strings or `{ "match": "...", "waitMs": 60000 }` objects. Keep case-insensitive literal substring matching, append-by-default configuration, `clearDefaults`, and the existing built-in rules.
- Evaluate server retry hints and matching wait rules even when Pi already recognizes an error as retryable; continue adding classification hints only for otherwise unrecognized eligible errors.
- Select the minimum interval in this order: the largest explicitly configured `waitMs` among matching user rules; otherwise a valid JSON `retry_after`; otherwise no additional cooldown beyond Pi's native timing. Do not take the maximum of the configured and server intervals. Existing string entries specify classification only and do not override a server hint.
- When no timed user rule matches, honor a valid `retry_after` value in a parsed JSON error body as a minimum interval in **seconds**, measured from the finalized error. This applies to all otherwise eligible retryable errors, including Pi-native errors that match no `include` entry. The presence of `retry_after` alone does not make an error retryable or bypass any protection.
- Treat `waitMs` as milliseconds and `retry_after` as a finite, non-negative JSON number of seconds that can be safely converted to milliseconds. A selected explicit `waitMs: 0` means no additional cooldown and does not fall through to the server hint. Without a timed rule, a valid `retry_after: 0` also means no additional cooldown; missing, malformed, negative, or unusable server values leave Pi's native timing unchanged without disabling the extension.
- Record a retry deadline from the finalized error without sleeping in the error handler. When Pi proceeds to the associated retry, wait only for the remaining interval before the provider request. Native backoff counts toward this interval and is never shortened, including when the selected user or server interval is shorter than Pi's backoff.
- Keep retry enablement, attempt limits, native exclusions, compaction, and retry execution under Pi's control. Add only cancellable cooldown waiting and a transient waiting status, not another retry loop.
- Clear cooldown state on cancellation, terminal completion, recovery, session/runtime replacement, and a fresh user request so an old failure cannot delay unrelated work.
- Retain fail-closed handling of invalid user configuration. Read server hints only from an available, valid JSON error body; do not infer waits from arbitrary prose or HTTP response headers.
- Acceptance examples: a matching user rule of 10000 ms wins over a 60-second server hint and, with 2 seconds of native backoff, requires about 8 seconds of additional waiting. A matching rule of 60000 ms wins over a 10-second server hint. Multiple matching rules of 10000 and 60000 ms select 60000 ms. A selected explicit zero adds no cooldown even if the server requests 60 seconds. With no timed rule, a valid 60-second server hint requires no `include` match and also applies when only a string rule matches. With neither source, no additional cooldown applies. Native backoff of 90 seconds is not shortened by a selected interval of 60 seconds.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `error-recovery`: Accept timed include rules, give explicitly configured matching durations precedence over JSON server retry hints, apply minimum cooldowns independently of native error classification, and preserve native recovery ownership while allowing a bounded, cancellable remaining-time wait.

## Impact

- Implementation affects `src/retry.ts`, `test/retry.test.ts`, the new `test/lifecycle.test.ts`, and `README.md`, alongside these planning and verification artifacts. The approved development dependency alignment updates `package.json` and `package-lock.json` to use `pi-ai` and `pi-coding-agent` 0.85.1; it does not update the running Pi installation.
- No Pi core changes, global retry-setting mutations, provider-specific retry loop, new runtime dependency, or automatic user-configuration migration.
- Existing string-only configurations keep their classification behavior and do not count as explicit waiting overrides. Valid server hints additionally affect eligible retries when no timed user rule matches. Object rules are new syntax and require the updated extension; older versions reject them under existing fail-closed validation.
- The previous unconditional no-timer/no-UI promise becomes a narrower promise: no independent retry loop or watchdog, with optional cancellable cooldown waiting and transient status for server hints or timed rules.
- Request-boundary ordering, lifecycle isolation, and availability of the JSON error body must be verified against a compatible Pi runtime before shipping. The source investigation used Pi `46db9c84164c076a5037f7fbd29c78aabe7953fa` and installed `openai-api-extension` `f2ffd86`; it was not an end-to-end timing or error-body parsing test. If a provider does not expose a valid JSON body to the extension, retain the rule/native fallback rather than claiming to honor an unavailable hint.
