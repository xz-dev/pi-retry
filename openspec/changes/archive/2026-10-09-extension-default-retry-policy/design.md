## Context

See `proposal.md` for motivation and `specs/error-recovery/spec.md` for the behavior contract. A design artifact is warranted because changing the default interacts with existing configuration migration, native-retry passthrough, and waiting eligibility.

`src/retry.ts` already separates `loadConfig`, the shared `canRecover` protections, `classifyError`, `selectWaitMs`, and the session-local cooldown lifecycle. `classifyError` currently requires an include match. `selectWaitMs` currently accepts native recognition or an include match and strips the exact generated retry-hint suffix before matching and JSON parsing. Compaction normalization runs independently before ordinary classification.

The agreed boundary is extension-local. Investigation of official Pi 1.1.0 and xz-dev Pi `82bc4210` found no public per-message retry-veto return in `message_end`. The xz-dev branch has native `retry.nonRetryableErrorPatterns`, but that setting is not an extension policy injection API. This change needs neither facility: an excluded error remains untouched and Pi can still retry it. Retain the aligned 0.85.1 development dependencies already used by this repository.

Source references for that boundary:

- [Official message result contract](https://github.com/earendil-works/pi/blob/v1.1.0/packages/coding-agent/src/core/extensions/types.ts#L1463-L1466).
- [xz-dev message result contract](https://github.com/xz-dev/pi/blob/82bc4210e2fe75b61fe6a32741f99498102495c7/packages/coding-agent/src/core/extensions/types.ts#L1465-L1468).
- [xz-dev native exclusion check](https://github.com/xz-dev/pi/blob/82bc4210e2fe75b61fe6a32741f99498102495c7/packages/ai/src/utils/retry.ts#L309-L331).

## Goals / Non-Goals

**Goals:**

- Resolve policy once during configuration loading and reuse the existing literal matcher and recovery protections.
- Make additional classification and waiting agree on exclusions without treating native retry as plugin-owned.
- Keep the current message hint, original-error preservation, and cooldown lifecycle rather than adding a second recovery mechanism.
- Make upgrade behavior explicit and verify the changed rules through existing unit and session/provider seams.

**Non-Goals:**

- Runtime changes to Pi settings, a core retry-veto hook, private-session access, or a dependency upgrade.
- Refactoring cooldown ownership, server JSON parsing, compaction, or cancellation machinery.
- Regular-expression exclusions, timed exclude objects, separate wait-rule lists, or new attempt-count controls.

## Decisions

### 1. Two independent configuration fields, resolved at load time

Extend the resolved `RetryConfig` with `defaultRetry` and `exclude`. A valid load always supplies a boolean and a normalized string array; omission resolves to `true` and `[]`. Validate their supplied types before accepting any configuration fields. Trim and discard blank excludes like compact strings; reuse case-insensitive literal-substring matching.

Retain an explicit disabled result for invalid configuration. Its policy must be inactive, with empty rule lists and `disabled: true`, rather than an empty valid configuration that could acquire the new default-on behavior. Update hand-constructed test fixtures to express their intended mode explicitly.

Do not infer mode from whether include exists or is empty: include also carries timed waiting overrides, and such inference would make adding a wait unexpectedly switch classification policy. Keep all 13 built-in includes and the compact default. There are no built-in exclude rules.

### 2. Reuse the shared ordinary-recovery gate

Keep the existing validity, retry-enabled, assistant-error, nonempty-text, protected-error, context-overflow, compact-match, and host-native-exclusion checks in the ordinary-recovery path. Add the plugin's exclude check there so classification and waiting cannot disagree about an explicit exclusion. Keep the host's native exclusion list separate from `config.exclude`; neither list is written back to the host.

After those gates pass:

| Decision | Eligibility |
| --- | --- |
| Add a new retry hint | Not already native-retryable or marked, and either `defaultRetry` or an include match |
| Select an extension wait | Native-retryable, or `defaultRetry`, or an include match |

The ordinary extension policy is therefore exclude-first, then include/default selection. An include cannot override an exclusion or a protection. Native recognition skips only adding another hint; it does not bypass the exclusion check for waiting.

Reuse the existing message-text normalization before waiting eligibility, include/exclude matching, and server-hint parsing. A generated `provider returned error` suffix must not create a new rule match. Never remove the hint from the finalized message sent back to Pi. The existing marker guard remains idempotent.

Changing the classifier alone is insufficient: it would leave server waits active on excluded native errors and reject server hints for newly default-eligible errors. The small coordinated change belongs in both classification and wait eligibility, not in new event handlers.

### 3. Exclusion means no plugin retry assistance, not no request

When exclude matches, return no ordinary replacement and no wait. Leave `stopReason`, original error text, and native retry settings unchanged. Pi's own classifier, enablement, attempt budget, backoff, and provider/transport behavior remain authoritative.

For a non-excluded native-retryable failure, `defaultRetry: false` still permits existing timed-user or server waiting. Treating that switch as an extension-wide off toggle would remove existing functionality. Likewise, do not make exclude call `ctx.abort()`, mark an error as canceled or successful, synthesize a quota error, or sync rules into `settings.json`.

The compact normalization path stays ahead of and separate from the ordinary-retry gate. Neither `exclude` nor `defaultRetry` suppresses a valid compact match. Invalid configuration and protected errors retain their existing effect on compaction.

### 4. Preserve waiting selection and lifecycle

Keep largest matching user `waitMs` above a valid server `retry_after`, including the explicit-zero override. The new default-on eligibility allows an otherwise eligible non-native failure with no include match to use a server hint. No timing rule is invented when neither waiting source supplies one.

Leave deadline creation, native-backoff subtraction, repeated-failure identity, abort signals, UI status, session invalidation, and exhaustion/continuation isolation unchanged. Excluded or otherwise ineligible failures produce no wait selection, so the existing `message_end` handling clears pending cooldown state instead of scheduling it. Do not interpret the next request as a retry merely because default-on classification ran.

### 5. Keep clearing defaults separate from mode selection

`clearDefaults` continues to clear only built-in include and compact lists. It does not flip `defaultRetry`, erase user excludes, or disable fixed protections.

| Configuration | Additional classification |
| --- | --- |
| No file or `{}` | Default-on for otherwise eligible ordinary errors; existing compact default retained |
| `{ "defaultRetry": false }` | Previous include-based policy, including built-ins |
| `{ "clearDefaults": true }` | Default-on ordinary classification; no built-in include or compact rules |
| `{ "defaultRetry": false, "clearDefaults": true }` | No additional retry or compact classification unless user rules are supplied |

The last row still permits waiting for eligible native retries. Clearing defaults also clears the compact default; examples requiring compact behavior must retain or explicitly supply their desired compact rules. Do not add a second defaults-clearing option in this change.

### 6. Verify outcomes with the existing test suite

Use `test/retry.test.ts` for a compact matrix of configuration/defaults, literal matching, conflicts, protections, and wait selection. Update legacy fixture expectations deliberately: tests proving include-only behavior must select `defaultRetry: false`, while default-mode tests must exercise the new behavior rather than blanket-disabling it.

Use `test/lifecycle.test.ts` and its actual Pi sessions, fake provider, and loopback fixtures to verify outcomes beyond returned classifier values:

- An unrecognized ordinary failure retries in default mode but not in include-only mode without a match.
- An excluded, otherwise unrecognized failure sends only the initial request.
- An excluded native-retryable failure still follows native retries but receives no extension wait or cooldown status, even with competing timed and server waits.
- Persistent default-eligible failures stop at the configured native attempt limit; zero retries does not turn into a continuation.
- Default-eligible server waiting still counts native backoff; default-off native waiting remains available.

Keep fixtures isolated from personal settings and real gateways. Reuse the existing Node test runner and waiting assertions; add no dependencies or alternate retry test harness. Run the full existing suite and TypeScript checks during implementation to catch regressions in cancellation, compaction, and stale cooldown handling.

## Risks / Trade-offs

- **Default-on covers previously unrecognized permanent errors** -> Preserve existing protections, bound execution by Pi's budget, and document exclude plus `defaultRetry: false` as user controls; do not silently introduce a new built-in blacklist.
- **Users interpret exclude as a native veto** -> State the extension-only boundary next to configuration examples and prove native passthrough with request-count tests.
- **`clearDefaults: true` previously disabled additional classification by itself** -> Mark the change as breaking and show the two-field replacement explicitly.
- **Invalid configuration accidentally re-enables default recovery** -> Retain an explicit disabled state and test malformed new fields alongside valid timed rules and visible server hints.
- **Generated marker text creates a false rule match** -> Preserve source-text normalization and cover an exclusion that matches only the appended suffix.
- **Eligibility changes leak waiting across attempts** -> Reuse the established lifecycle and rerun its exhaustion, cancellation, and unrelated-continuation regressions.
- **Pinned SDK differs from the user's standalone build** -> Record actual test versions and avoid claiming those tests validate every provider-internal or transport-recovery path.

## Migration Plan

1. Implement the configuration, gating, and waiting changes with focused coverage, then verify the session-level cases and existing suite. Do not change Pi or development dependency versions.
2. Update `README.md` with default-on, include-only, exclude-first, timed include, native passthrough, compaction independence, and invalid-configuration examples.
3. For users preserving prior classification behavior, document adding `defaultRetry: false`. For the old `{ "clearDefaults": true }` no-additional-classification configuration, document `{ "defaultRetry": false, "clearDefaults": true }`. Never rewrite their files automatically; changes still require reload or restart.
4. Explain rollback: prior versions ignore the unrecognized `defaultRetry` and `exclude` fields, restore include-based classification, and no longer honor plugin exclusions. Users must review overlapping include/wait rules before rollback; it is not exclusion-preserving.
5. Present implementation check results separately from planning validation. This proposal does not claim the new behavior is implemented or tested.

## Implementation Verification

- `npm run check` passed after implementation: 50 tests passed, none failed or skipped, followed by TypeScript checking. Baseline before changes was 34 passing tests. Runtime: Node.js 26.10.0; `pi-ai` and `pi-coding-agent` development dependencies remain 0.85.1.
- Four behavior assertions against an in-memory copy of `HEAD:src/retry.ts` failed as expected and passed against the working source: default classification, default-eligible server waiting, exclude-over-include priority, and suppression of native-error supplementary waiting. No source rollback or temporary production mutation was used. An earlier direct test invocation accidentally selected the sandbox's Bun executable; it was corrected to explicit `node` and is not counted as red-test evidence.
- Real Pi-session fixtures verified default-on, include-only, excluded non-native failures, and native budgets of zero and two. The budget checks also verified a subsequent fresh request inherits no exhausted cooldown. Existing cancellation, queued-input, continuation, reload/dispose, and long-timer regressions passed.
- Loopback HTTP evidence: an excluded native 502 still retried after about 103 ms with 100 ms native backoff, despite an 800 ms user rule and a one-second server hint, with no plugin cooldown status. Default-off native errors still honored user/server waits. A default-eligible non-native error retried after about 302 ms with a 300 ms server hint and 150 ms native backoff, rather than adding those intervals.
- `git diff --check` and `openspec validate extension-default-retry-policy --strict` passed. All five README JSON examples parsed, and the migration example specifies both `defaultRetry: false` and `clearDefaults: true`. Tracked changes are limited to `src/retry.ts`, the two existing test files, and `README.md`; no Pi core, user settings, dependency, retry-loop, or cooldown-lifecycle changes were made.
- Verification limits: no live provider or standalone xz-dev Pi runtime test, no CI run, and no independent reviewer run. Wall-clock assertions retain the existing suite's sensitivity to heavily loaded machines. The change has not been committed or archived; human acceptance remains separate from local checks.
