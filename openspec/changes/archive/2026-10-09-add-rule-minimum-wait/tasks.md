## 1. Prove the public-interface lifecycle gate

- [x] 1.1 Build a local fake-provider integration check in the existing test area using the real Pi session/extension event path; record the tested runtime and development dependency versions and verify the agent request boundary occurs after native backoff and observes cancellation, without production network calls or user-setting changes.
- [x] 1.2 Demonstrate a public-interface mechanism that identifies the corresponding native retry: verify genuine retry, exhausted budget followed by an extension continuation, queued fresh input, and cancellation are distinguishable; verify no unrelated request inherits cooldown state. Stop and report a blocker if this cannot be demonstrated without private APIs, a duplicate retry state machine, Pi core changes, or an unapproved dependency update.

## 2. Implement configuration and duration selection

- [x] 2.1 Extend include parsing in `src/retry.ts` to preserve strings and accept validated `{ match, waitMs }` objects, retaining append/default/clear behavior; verify existing configuration regressions plus zero, blank match, malformed objects, invalid-file fail-closed behavior, and safe-integer boundaries with the existing test runner.
- [x] 2.2 Add JSON-body hint extraction and duration selection with explicit matching user wait first, server seconds second, and no additional wait last; verify shorter and longer user overrides, multiple-rule maximum, explicit zero, fractional server seconds, classification-only strings, native errors with no include match, malformed/unavailable bodies, and rejection of coercions or arbitrary prose.
- [x] 2.3 Separate cooldown eligibility from adding a classification marker; verify native-retryable errors still receive eligible waits, original text and marker idempotence remain intact, and disabled retry, native exclusions, protected errors, and compaction never acquire an ordinary cooldown.

## 3. Apply the verified remaining-time wait

- [x] 3.1 Wire finalized-error observation and the verified agent request boundary to a session-local monotonic deadline; verify a 60-second selected interval minus 2 seconds of native backoff waits only the remaining 58 seconds under controlled time, sufficient native backoff adds no wait, duplicate observation does not extend a deadline, and a new failure receives a fresh interval.
- [x] 3.2 Bind waiting to cancellation and lifecycle invalidation; verify cancel sends no retry request, exhausted budgets do not revive, fresh input and unrelated extension continuations are not delayed, success/session switch/reload/shutdown clear state, and stale cleanup cannot affect a newer wait. Verify long durations do not overflow a platform timer.
- [x] 3.3 Add an extension-owned transient status only for actual supplementary waiting; verify it clears on completion/cancellation and does not replace Pi's countdown or enter model context, while the same timing behavior works without an interactive UI.

## 4. Document and verify the complete behavior

- [x] 4.1 Update `README.md` with mixed include syntax, waitMs versus retry_after units, user-first precedence, zero behavior, all-eligible-error server hints, minimum-wait semantics, cancellation, and updated no-independent-loop wording; check each example against the corresponding acceptance case and preserve configuration/rollback caveats.
- [x] 4.2 Run `npm run check` and the real-runtime fake-provider integration cases, including lifecycle isolation and an OpenAI-compatible JSON error fixture; record reproducible commands, request-time/count evidence, tested versions, and residual limitations. Do not mark this complete using arithmetic-only tests or planning validation.
- [x] 4.3 Run `openspec validate add-rule-minimum-wait --strict` and re-read apply progress against actual implementation evidence; present the behavior and verification results to the user for acceptance, leaving any unsupported scenario or blocker unchecked.
