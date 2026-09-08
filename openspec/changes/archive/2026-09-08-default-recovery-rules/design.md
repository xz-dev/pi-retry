## Context

See `proposal.md` for motivation and `specs/error-recovery/spec.md` for the target contract. A design is needed because this changes configuration compatibility and migrates previously local planning documents into a maintained specification.

Observed baseline: repository `master` at `a6c63e48d89877d13882109ba1fc797afdadc89f`, before implementation of this change.

- `src/retry.ts` contains the extension: `DEFAULT_INCLUDE` has only the 520/no-body string, no built-in compact list exists, and `loadConfig` requires `include` when a file exists. Supplied arrays replace defaults; invalid configuration returns two empty lists.
- The handler first normalizes eligible compact matches, then classifies retry matches. Existing helpers preserve original errors, protect limit/payment failures, avoid native duplicate classification, and defer execution to Pi.
- `test/retry.test.ts` already exercises default 520 handling, replacement, validation, compaction precedence, idempotence, and protected errors. `package.json` exposes `npm run check` for Node tests and TypeScript checking. These are inspected checks, not a claim that they were run during planning.
- `README.md` describes the current replacement behavior. The two `PLAN/` files contain earlier agreements and checklists; `.gitignore` excludes `PLAN/`, so those files are not versioned project documentation.
- The local OpenSpec root has a `spec-driven` configuration but no main specs or earlier changes. This is the first capability specification, not a modification of an existing OpenSpec requirement.

## Goals / Non-Goals

**Goals:**
- Resolve built-in and user rules once, at configuration load, while keeping classifiers unaware of merge policy.
- Make the compatibility change explicit and preserve the existing protection and recovery boundaries.
- Give the existing recovery capability one maintained specification and verify documentation against the same implementation revision.

**Non-Goals:**
- New retry/compaction machinery, per-project rule files, UI, commands, regular expressions, individual-default exclusions, or new dependencies.
- Changing Pi settings or the maintainer's global configuration, publishing, installing, or claiming compatibility with unobserved embedded-SDK policies.
- Converting license/package metadata into behavioral requirements, rewriting OpenSpec workflow configuration, or reconstructing fictional completed changes from legacy checkboxes.

## Decisions

### 1. Ship a fixed snapshot and resolve policy in the existing loader

Expand the built-in include list and add a compact default list using the exact strings in the delta spec. They are reviewed extension data, not a build-time import from a private home directory.

Keep `RetryConfig` as the resolved two-array value consumed by the classifiers. Parse `clearDefaults` only as an input setting inside `loadConfig`. Validate recognized fields before merging, use empty user arrays when omitted, and return defaults followed by normalized user entries unless clearing was requested. Each load returns its own lists rather than mutating shared defaults.

Alternatives rejected: a generic configuration-merging library, a new configuration module, or a runtime defaults file. The existing loader and ordinary array concatenation cover this change.

### 2. One opt-out controls both lists

`clearDefaults: true` removes both built-in lists before user entries are applied. Empty arrays are additions of zero rules, not a second opt-out mechanism. Keep strict boolean/array validation and all-or-nothing fail-closed behavior; unknown properties remain ignored.

Alternatives rejected: `mergeMode`, separate per-list clearing flags, and implicit replacement whenever an array is supplied. They either duplicate the requested switch or preserve the surprise that configuring one rule silently discards useful defaults.

Duplicate literal entries, including those produced by the existing local snapshot, need no deduplication layer: matching is boolean and classification is already idempotent. Do not promise a distinct rule-count API or change matching semantics to remove duplicates.

### 3. Leave the recovery path unchanged

```text
finalized assistant error
  --> protected? leave unchanged
  --> compact match not already native overflow? normalize overflow
  --> compact match or native overflow? no ordinary retry
  --> eligible include, retry enabled, not native-retryable or marked? add hint
  --> otherwise leave unchanged
```

`normalizeContextOverflow`, `classifyError`, and `classifyErrorForContext` retain their current responsibilities. The new defaults do not relax quota/payment protections, make native-retryable errors receive another marker, or let broad include rules defeat compact precedence. Matching a certificate error means suggesting native recovery; it does not disable certificate verification.

Changing classifiers or invoking recovery directly was considered unnecessary: the requested behavior changes which rules reach the existing path, not how recovery executes.

### 4. Migrate knowledge, not checkbox history

Keep the operational README and establish `openspec/specs/error-recovery/spec.md` only when the implementation matches the target delta. Until then, this change directory is the proposed contract; the existing README and legacy files continue to describe the old implementation.

| Existing source | Treatment |
| --- | --- |
| `README.md` installation, reload, settings, SDK caveat, development commands | Keep concise operational guidance and verify it against code/package scripts; link to the main spec after that file exists. |
| `PLAN/retry-includes.md` matching, finalized errors, native retry ownership, protections, no watchdog | Carry these implemented behaviors into the capability specification. |
| `PLAN/retry-includes.md` single default and replacement semantics | Supersede with the agreed built-in snapshot, append policy, and explicit clearing migration. |
| `PLAN/overflow-compaction.md` configured compact matching, original text, native recovery, unrelated-error handling | Carry the behavior forward, with default compact rules also available. |
| `PLAN/overflow-compaction.md` no built-in trigger text | Explicitly superseded by the user's decision to include the current compact rule in defaults. |
| Legacy checked or unchecked implementation/release tasks | Do not copy them as current acceptance evidence or new work. This change starts with unchecked implementation tasks; release/install work stays out of scope. |

Use one new `error-recovery` capability with ADDED requirements because no main specification exists. Do not create a duplicate old-behavior main spec first and then try to synchronize conflicting ADDED requirements over it. Synchronize the verified delta into the main spec later; do not mark this change complete or archive it merely because migration text exists.

Remove the two legacy plan files only after their useful content is accounted for, the replacement main spec exists, and the user confirms deletion. Leave `openspec/config.yaml` and the existing ignore rule alone; neither needs changing to establish the new documentation home.

### 5. Reuse existing checks and review observable behavior

Adapt the current Node tests rather than introducing Cucumber or a separate documentation harness. Group configuration cases into a small table and keep the existing classifier checks. Verify both resolved configuration and its effect on finalized errors where needed; a default-list equality check alone cannot prove recovery safety.

Documentation acceptance is a manual source/test traceability review plus OpenSpec validation: compare defaults, append/clear examples, invalid inputs, reload behavior, native settings, and exclusions with `src/retry.ts`, the relevant test cases, and package scripts. Check README links after the main spec is created. A clean OpenSpec validation result proves artifact structure, not implementation completion.

## Risks / Trade-offs

- Existing replacement configurations acquire defaults after upgrade -> document adding `clearDefaults: true` to preserve their previous rule sets, including a compact-only or fully disabled setup.
- `{}` and partial objects previously failed closed -> explicitly document their new valid meaning; malformed recognized fields still fail closed rather than activating defaults.
- More built-in matches cover environment-specific transient wording -> retain exact strings, native classification checks, protected-error exclusions, and an opt-out. Do not broaden the snapshot with guessed patterns.
- Tests for replacement and default-empty compact will become stale -> revise those expectations while retaining protection, idempotence, and native-policy regression coverage.
- Legacy plans are ignored and their removal would not be recoverable from Git alone -> retain them until content migration is checked and obtain explicit deletion approval.
- Documentation could get ahead of runtime behavior -> leave current entry-point docs unchanged during planning; verify code before synchronizing target main specs and remove stale replacement guidance in the same implementation delivery.

## Migration Plan

1. On an explicit apply request, implement and verify the loader/defaults changes within the existing source and test files. Show the breaking-change examples and distinguish them from the retained behavior.
2. Update README configuration guidance to match the verified code. Existing custom configurations that require old replacement semantics can add `clearDefaults: true`; do not rewrite any live user configuration automatically.
3. After verification and user authorization, synchronize this change's `error-recovery` delta into the initially empty main-spec tree. Add/check README navigation to that real file and reconcile the legacy content using the table above.
4. Obtain explicit approval before removing `PLAN/retry-includes.md` and `PLAN/overflow-compaction.md`; if approval is withheld, leave cleanup pending rather than declaring migration complete.
5. Present check results and the documentation/code coherence review for acceptance. Publishing, installation, and archiving require separate user requests.

For rollback of a later authorized implementation, restore the previous loader/tests and matching README/spec behavior together. The old loader ignores the new boolean, so a replacement-style file with an explicit `include` array still works on the old version; a flag-only file fails closed there rather than enabling additional classification. Do not perform a rollback, Git operation, or configuration rewrite as part of this planning workflow.
