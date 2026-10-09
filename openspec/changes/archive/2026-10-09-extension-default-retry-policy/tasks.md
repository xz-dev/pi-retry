## 1. Configuration and compatibility

- [x] 1.1 Extend the resolved configuration and loader in `src/retry.ts` with boolean `defaultRetry` and string-array `exclude`; verify unit cases for no file, `{}`, explicit true/false, empty arrays, all 13 retained include defaults, and the unchanged compact default.
- [x] 1.2 Normalize and validate exclude entries and reject malformed new fields without partially applying configuration; verify literal/case-insensitive matching, trimming, ignored blanks, rejected timed exclude objects, and fail-closed suppression of default classification, compact normalization, and server-derived waits.
- [x] 1.3 Keep `clearDefaults` independent of policy and user exclusions, and update hand-constructed configuration fixtures to name their intended mode; verify that clearing lists alone keeps default-on behavior and that `defaultRetry: false` plus `clearDefaults: true` restores no additional classification.

## 2. Ordinary retry classification

- [x] 2.1 Add exclude-first gating and default-or-include selection to the existing ordinary classification path; verify a table covering both modes, include matches/misses, exclude matches/misses, include/exclude conflicts, and otherwise-unrecognized errors without modifying original error text or idempotent marking.
- [x] 2.2 Preserve shared recovery protections and compact-path independence; verify disabled Pi retry, host-native exclusions, protected failures, non-error/aborted/empty messages, native context overflow, and a compact match that also matches exclude.
- [x] 2.3 Leave already-native-retryable failures untouched under both `defaultRetry: false` and exclude; verify classifier results and failure fields remain unchanged and no Pi settings write, abort, synthetic cancellation, or replacement-request path is introduced.

## 3. Waiting eligibility

- [x] 3.1 Apply the same plugin exclusions to waiting while admitting native, include-based, or default-on eligibility; verify that excluded failures receive neither timed-user nor server-derived waits, a default-eligible non-native error can use a visible server hint, and default-off native errors keep existing waiting support.
- [x] 3.2 Preserve user-wait precedence, explicit zero, JSON validation, and source-text normalization; verify existing selection regressions plus an exclude that matches only the generated retry-hint suffix, and confirm the finalized message retains its hint.

## 4. Session-level behavior and regression coverage

- [x] 4.1 Extend the existing lifecycle fixtures only as needed for deterministic ordinary failures; first assert the chosen failure is not natively retryable, then verify request counts for default-on recovery, include-only unmatched failure, include-only matching recovery, and an excluded failure through actual Pi sessions.
- [x] 4.2 Prove excluded native errors still use Pi's retry path without plugin waiting; verify provider request counts, absence of cooldown status, and no configured/server minimum extension delay despite matching timed include and server hints. Also verify an allowed default-eligible server wait still counts native backoff.
- [x] 4.3 Prove the extension cannot expand Pi's budget or leak waiting; verify persistent default-eligible failures produce one initial request plus exactly `maxRetries` main-agent retries, zero-budget errors do not retry, and existing cancellation, exhaustion/continuation, fresh-request, and runtime invalidation regressions pass.

## 5. Documentation and final verification

- [x] 5.1 Update `README.md` with default-on and include-only examples, exclude priority and waiting suppression, preserved timed include rules, and the fact that native retries and compaction remain independent; verify each example against the configuration and behavior matrix in this change's delta spec.
- [x] 5.2 Document upgrade and rollback behavior, especially the two-field replacement for the old clear-defaults-only configuration, preserved compact-list clearing, ignored new fields in older versions, reload requirements, and no automatic file rewriting; verify the old claim that `clearDefaults: true` alone disables additional classification is removed.
- [x] 5.3 Run `npm run check`, `git diff --check`, and `openspec validate extension-default-retry-policy --strict`; record results and tested runtime/dependency versions, verify no Pi core/settings/dependency changes or new retry loops entered the diff, and distinguish completed checks from untested standalone/provider paths.
