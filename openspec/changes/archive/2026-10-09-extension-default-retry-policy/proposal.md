## Why

pi-retry currently requires an include match before it can help Pi recover from an otherwise unrecognized provider error. Make extension-added retries the default, with explicit exclusions and an opt-in include-only mode, while leaving Pi's own recovery decisions and retry budget untouched.

## What Changes

- **BREAKING**: Add optional boolean `defaultRetry`, defaulting to `true`. Eligible ordinary errors no longer need an include match to receive pi-retry's existing native-recognizable hint. Set `defaultRetry: false` to restore include-based additional classification.
- Add optional string-array `exclude`, defaulting to empty. An exclude match suppresses pi-retry's retry hint and all extension-added waiting for that error, even when include also matches or Pi already recognizes the error as retryable.
- Keep include strings and `{ match, waitMs }` entries, all 13 built-in include rules, the built-in compact rule, and existing literal matching. Include remains useful for allowlisting and timed waiting overrides; no built-in include text becomes an exclude rule.
- **BREAKING**: `clearDefaults: true` continues to clear only the two built-in rule lists; it does not disable `defaultRetry`. To preserve the former no-additional-classification behavior, use both `clearDefaults: true` and `defaultRetry: false`.
- Validate the new fields using the existing fail-closed policy. Invalid configuration must not accidentally restore default-on classification or server-derived waiting.
- Preserve Pi retry enablement, native exclusions, attempt limits, backoff, compaction precedence, protected errors, wait-source precedence, cancellation, and session-local cooldown ownership. `defaultRetry: false` does not stop native retries or existing waiting support for non-excluded native-retryable errors.
- Document upgrade and rollback behavior without rewriting user configuration.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `error-recovery`: Add extension-local default retry selection and exclude-first matching; update configuration validation, clearing-defaults semantics, ordinary retry eligibility, and cooldown eligibility without changing Pi's native policy or compaction behavior.

## Impact

- Implementation surface: `src/retry.ts` configuration loading, ordinary retry eligibility, and wait selection.
- Verification surface: `test/retry.test.ts` and `test/lifecycle.test.ts`, including native-retry passthrough and preservation of Pi's attempt budget.
- Documentation surface: `README.md` and the `error-recovery` specification delta in this change.
- Configuration surface: the existing global `pi-retry.json`; no new file, project-local rules, or automatic migration.
- No Pi core changes, `settings.json` edits, dependency upgrades, public retry-veto API, or new runtime dependencies are required.

## Non-Goals

- Preventing or configuring Pi's native retries, provider-internal retries, or transport recovery.
- Adding an independent retry loop, new retry-count setting, watchdog, provider wrapper, or persistent cooldown.
- Changing compact matching, protected-error policy, server-hint parsing, or the established remaining-time waiting lifecycle.
