## Context

See `proposal.md` for motivation and `specs/error-recovery/spec.md` for the behavior contract. The user selected a plugin-only minimum interval, not an exact replacement of native backoff. Explicit timed user rules take precedence over JSON `retry_after` hints.

Before this change, the extension in `src/retry.ts` only classified finalized errors. Pi still performs the retry. This change adds a small amount of session-local cooldown state, so the existing unconditional prohibition on timers and UI is replaced by a prohibition on independent retry loops and watchdogs.

Source evidence, not runtime verification:

| Evidence | Source at Pi `46db9c84164c076a5037f7fbd29c78aabe7953fa` |
| --- | --- |
| Finalized message replacements are applied before recovery | `packages/coding-agent/src/core/agent-session.ts:1390-1397,1652-1662` |
| Pi creates a retry plan and awaits its delay | `packages/coding-agent/src/core/agent-session.ts:4262-4288` |
| A successful retry preparation leads to `agent.continue()` | `packages/coding-agent/src/core/agent-session.ts:2170-2173,2315-2329` |
| Context transformation is awaited before calling the provider, with abort checks around it | `packages/agent/src/agent-loop.ts:474-509` |
| Extension context handlers are awaited | `packages/coding-agent/src/core/extensions/runner.ts:1491-1520` |
| `message_end` returns only a message; settings access returns a clone | `packages/coding-agent/src/core/extensions/types.ts:1465-1468`; `packages/coding-agent/src/core/settings-manager.ts:486-487` |
| Request payload hooks are also used below the agent boundary | `packages/coding-agent/src/core/sdk.ts:382-385,420-434`; cache warming reuses request options in `core/cache-warmer.ts:333-338` |

The installed `openai-api-extension` at `f2ffd86` forwards stream options (`index.ts:418-440`). The source snapshot above remains source evidence rather than a live test of that standalone build. Implementation validation uses aligned `pi-ai` and `pi-coding-agent` 0.85.1 development dependencies; the user approved that alignment after a clean install exposed mixed 0.83.0/0.85.1 types. See the verification record below. Neither a subsequent `context` call nor an intermediate `agent_end` event alone proves that a request is an automatic retry.

## Goals / Non-Goals

**Goals:**

- Select a duration without changing native error text, retry settings, or request payloads.
- Let native backoff consume the selected interval; add only its remainder at an agent request boundary.
- Keep waiting cancellable and scoped to the failed attempt's actual retry.
- Reuse the existing Node test runner and TypeScript setup.

**Non-Goals:**

- Pi core changes, private-session monkey patches, provider wrappers, new retry budgets, or synthetic continuation messages.
- A provider-wide rate limiter, persistent cooldowns, exact-delay replacement, or a new configurable timing framework.
- HTTP `Retry-After` parsing, recursive discovery of similarly named fields in arbitrary JSON, or reconstruction of a body the provider did not expose.
- Suppressing requests made internally by a provider before it reports a finalized failure to Pi.

## Decisions

### 1. Preserve the existing configuration surface

Allow strings and `{ "match": "...", "waitMs": 60000 }` in `include`; keep `compact` string-only. Normalize match strings once when loading configuration. A string has no explicit duration; an object has a non-negative safe-integer duration, including zero. Do not use truthiness to distinguish an absent duration from zero.

Preserve default merging, `clearDefaults`, unknown-property handling, and the global load/reload lifecycle. Keep an explicit configuration-validity result so invalid configuration can disable server-derived waits as well as configured recovery, without confusing an intentionally empty include list with a load failure.

A separate parallel wait-rule list would repeat matching configuration and make it easier for classification and waiting rules to diverge. Mixed entries keep the current strings valid. Do not add waiting values to built-in rules.

### 2. Separate eligibility, duration selection, and classification

Apply protected-error and compaction checks before selecting an ordinary retry cooldown. Select a cooldown only for an error eligible under native retry or the existing include-based classification, while respecting retry enablement and native exclusions.

Use this duration selection:

1. Largest explicit `waitMs` among matching user entries, even if it is zero.
2. Otherwise, a valid server `retry_after`, converted from seconds to milliseconds.
3. Otherwise, no added cooldown.

Already-native-retryable errors skip only the classification marker, not duration selection. A classification-only match does not block the server hint. The `retry_after` field itself never establishes retry eligibility. Waiting selection removes the exact internal retry-hint suffix from a copy before eligibility checks, rule matching, and JSON parsing; the finalized message returned to Pi retains that hint.

Parse an available JSON error body, including a complete body embedded after the provider error prefix, with JSON parsing rather than extracting digits from free-form prose. Inspect only the body's own top-level field. Reject coercions from strings or booleans and reject unusable values. Round fractional seconds upward to milliseconds. Keep the original error text intact. If JSON is unavailable or malformed, use the configured/native fallback and make no claim that the server hint was honored.

### 3. Use an absolute deadline and an agent-level boundary

Record the selected interval when the finalized error is observed. Use a monotonic clock to compute elapsed time; do not use the message timestamp, which represents request start. Re-observing the same finalized failure must not restart its interval.

At the corresponding native retry's agent request boundary:

```text
remaining = max(0, selectedInterval - elapsedSinceFinalizedError)
```

With 60 seconds selected and 2 seconds already elapsed in Pi's backoff, the extension waits for the remaining approximately 58 seconds. If Pi has waited 90 seconds, the extension does nothing. A new failure creates a new deadline; a consumed deadline is not reusable.

Prefer the awaited `context` event over `before_provider_request`: it runs in the main agent path before provider calls and avoids relying on provider payload hooks that cache warming can reuse. The handler returns no context replacement. This is a boundary choice, not evidence of retry ownership by itself.

**Mandatory implementation gate:** first demonstrate, using public extension/session interfaces and the real Pi event path, how the cooldown is correlated to its native retry. The demonstration must distinguish an exhausted budget followed by an extension continuation, queued new input, cancellation, and a genuine retry. Do not implement the rule as “the next context call always consumes the cooldown.” Do not silently mirror or replace Pi's retry state machine to make that assumption work. If public interfaces cannot satisfy the ownership requirement on the intended runtime, stop and report the limitation before continuing the feature. Do not weaken the spec or modify Pi core without a new user decision.

Sleeping inside `message_end` would add the full interval before native backoff. Editing global delay settings would affect unrelated work. Both are rejected.

### 4. Keep the waiting lifecycle bounded

Use one session/runtime-local pending cooldown record, with the identity needed by the verified ownership mechanism, the deadline, and any active wait cancellation resource. No persistence and no per-provider registry are needed.

The active remaining-time wait is bound to the current request's abort signal. Runtime/session teardown and invalidation also release waiting resources. Reset on success, terminal settlement, a fresh request, or replacement; do not reset solely because the failed attempt emitted `agent_end`.

The cancel path must not rely on throwing an extension-hook error to stop a request: extension runners can report and swallow handler errors. Verify that the request signal is aborted and that Pi's subsequent abort check prevents a provider call. Old asynchronous cleanup must not clear a newer wait's state or status.

Use the standard library for abortable waiting. For accepted durations beyond one platform timer's range, cap individual sleeps and recalculate the remaining duration rather than allowing timer overflow to produce an immediate retry. This is deadline maintenance, not a model-request retry loop.

### 5. Show only supplementary waiting

Show a transient, extension-owned status only while a positive remainder is being awaited. Clear it in all completion and cancellation paths. A short indication of the remaining interval is enough; do not build a second retry UI or claim to replace Pi's native countdown. Non-interactive operation must not depend on status APIs, and no status is injected into the conversation.

### 6. Validate at the provider-request seam

Use `node:test` and existing test conventions. Focused unit checks cover configuration, matching, source precedence, JSON parsing, and deadline arithmetic. These do not establish lifecycle correctness.

The integration check loads the actual extension through a compatible Pi runtime with a fake provider and isolated in-memory or task-scoped session/settings state. Observe provider request times, counts, cancellation, and transient status. Use a controllable clock/timer seam where available; otherwise use small, well-separated intervals and bounded assertions rather than real 60-second sleeps. Never contact the production gateway or change the user's settings.

The initial ownership gate is verified by the lifecycle tests: the failed response is absent from request context but remains the last raw message in session history; new user/custom message delivery invalidates the pending cooldown, and a retained failure in context does not qualify. Session identity and terminal cleanup further constrain ownership. Newer hosts' public `agent_before_settle` event clears state before a message-free extension continuation; registration uses `Reflect.apply` because the pinned SDK declarations predate that event, while older hosts never emit it. This is public event registration, not access to private session state.

The production code uses file-backed settings as before. Optional native exclusion fields are read when supplied by a newer host. The exact standalone build cited above has not been runtime-tested by these SDK tests; do not conflate the two verification environments.

## Risks / Trade-offs

- **The next request may not be a native retry** -> Make ownership isolation the first integration gate, including budget exhaustion followed by queued or extension-driven work; stop if public interfaces are insufficient.
- **The development dependency differs from the inspected runtime** -> Record tested versions and hook availability before implementing lifecycle wiring; do not assume `willRetry`, `auto_retry_start`, or mutable settings are available through `pi.on()`.
- **A provider may strip or stringify away JSON fields** -> Test a real formatted-error fixture; use rule/native fallback when the body cannot be parsed. Never reconstruct missing values from prose.
- **A lower user interval can override a longer server recommendation** -> This is the user's confirmed policy. Document both directions and explicit-zero behavior; native backoff still cannot be shortened.
- **Cancellation can race with cleanup or a new request** -> Bind waits to the active signal and identity, clear state deliberately, and prove no canceled provider request is sent.
- **The existing no-timer/no-UI documentation becomes inaccurate** -> Replace only those claims with the scoped cooldown contract; no independent retry loop is introduced.
- **Large durations or clock changes can break naive sleeps** -> Use monotonic elapsed time, safe numeric validation, and bounded timer segments.

## Migration Plan

1. Complete the public-interface lifecycle gate before feature implementation; stop on failure without widening scope.
2. Add configuration/selection behavior, then the verified cooldown lifecycle, with regression coverage in the existing test area.
3. Update `README.md` with precedence, milliseconds versus seconds, zero behavior, no-include server hints, cancellation, and the native-backoff floor.
4. Run the project checks and the integration cases; present results for acceptance. Passing planning validation is not implementation acceptance.
5. Roll back by restoring the previous extension version and converting any timed objects back to strings. Older versions fail closed on object entries. Do not rewrite users' files automatically.

## Verification Record

- Runtime: Node.js 26.10.0; development `@earendil-works/pi-ai` and `@earendil-works/pi-coding-agent` both 0.85.1, installed from the updated lockfile. No Pi core source or running Pi installation was changed.
- Command: `npm run check` — 30 tests and TypeScript checking passed at the implementation checkpoint. `test/retry.test.ts` covers configuration, precedence, validation, and protections; `test/lifecycle.test.ts` uses real Pi sessions plus fake providers and a loopback HTTP service with the real OpenAI Responses adapter.
- Red/green timing evidence: before wiring cooldowns, the HTTP retry occurred about 107 ms after the error despite a 250 ms user rule. After wiring, observed intervals were approximately 253–254 ms with 100 ms native backoff and a 600 ms visible server hint. This proves both the user override and remaining-time behavior rather than a 350 ms additive wait.
- Visibility evidence: the pinned SDK drops the fixture's top-level JSON body (`status code (no body)`), while an OpenAI-style `error` wrapper survives in the finalized error text. A user rule works for both shapes. Without a user rule, the wrapped 250 ms server hint produced about 254 ms total waiting; the omitted-body case retained native timing at about 103 ms. This does not prove that the original production Cloudflare response preserves its JSON on every provider/runtime path.
- Boundary evidence: explicit zero used native timing, a 300 ms native delay was not extended by a 100 ms rule, duplicate observations kept the original deadline, and repeated failures received fresh intervals. Cancellation was checked against actual loopback request counts. Reload/dispose tests caught and then verified fixes for canceling the request itself and clearing status after context invalidation. Queued input, exhaustion-driven continuation, and a timer-range-sized cooldown are covered.
- Independent review found a P2 interaction: an unrelated timed rule could match the synthetic classification suffix and suppress or replace a server hint. Four new regression cases failed before repair (about 33 ms instead of 300 ms, or an unrelated 1000 ms delay). After normalizing the source text before matching, `npm run check` passed 34 tests and TypeScript; the reviewer's unchanged request-boundary reproduction observed about 304 ms for its 300 ms requirement. The message's native-recognizable hint remains intact. Targeted independent re-review (`92aa76ad-088c-42fd-97ec-08783708df3a`) closed the P2 and approved the candidate with explicit residual risk after independently rerunning all 34 tests, TypeScript, and the unchanged reproduction (303 ms). At handoff, the parent verified that the production file and both test files matched the reviewer's SHA-256 fingerprints.
- Remaining verification limits: runtime evidence covers the pinned 0.85.1 SDK, fake providers, and loopback HTTP, not standalone Pi `46db9c84` or the production gateway. The newer `agent_before_settle` bridge remains source-inspected only. Direct session-switch and immediate cancel/new-request stale-cleanup races have no dedicated executable cases; invalidation wiring was reviewed without another concrete defect. Wall-clock test upper bounds may be sensitive to heavily loaded CI.
- `git diff --check` and `openspec validate add-rule-minimum-wait --strict` pass after the repair. Human acceptance remains separate from local verification and independent review.
