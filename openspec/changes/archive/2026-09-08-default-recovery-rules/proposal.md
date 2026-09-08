## Why

Pi users currently need a private configuration to recognize the transient and input-limit errors already encountered in daily use. Shipping those rules by default, while retaining an explicit opt-out, removes that setup; consolidating the README and legacy `PLAN/` agreements into OpenSpec prevents the documented behavior from drifting from the code.

## What Changes

- Ship the agreed snapshot of 10 retry `include` strings and one `compact` string as built-in defaults. Do not read a maintainer's configuration to obtain defaults at build or runtime.
- **BREAKING**: Append user `include` and `compact` entries to their respective defaults instead of replacing them. Omitted arrays and empty arrays add nothing.
- Add optional boolean `clearDefaults`, defaulting to `false`. When `true`, remove both built-in lists before applying user entries; `{ "clearDefaults": true }` disables only pi-retry's additional classification.
- Accept partial configuration objects, including `{}` and compact-only configuration. Preserve strict value validation, fail-closed handling, case-insensitive literal matching, protected-error exclusions, and native retry/compaction ownership.
- Establish the project's first `error-recovery` OpenSpec capability, carrying forward the implemented agreements in `PLAN/retry-includes.md` and `PLAN/overflow-compaction.md` while explicitly superseding the old default/replacement and non-built-in-compaction decisions.
- Keep `README.md` as the installation and configuration entry point. During implementation, update its examples with the corresponding code behavior and link to the verified main specification. Migrate useful legacy plan content before removing the old files, with separate confirmation for deletion; do not manufacture completed historical changes from old checkboxes.

## Capabilities

### New Capabilities

- `error-recovery`: Global recovery configuration, built-in and appended rule sets, explicit default clearing, and safe delegation of finalized assistant errors to Pi's native recovery paths. This is a new specification for an existing extension, not a new retry engine.

### Modified Capabilities

None. The project currently has no main OpenSpec specifications.

## Impact

- Implementation: `src/retry.ts`, primarily default constants and `loadConfig`; retain the existing classification and event-handler architecture.
- Verification: adapt the existing `test/retry.test.ts` Node tests and run `npm run check`; no new framework or runtime dependency.
- Documentation: `README.md`, the eventual `openspec/specs/error-recovery/spec.md`, and the two legacy `PLAN/` files. `openspec/config.yaml`, package metadata, and Git ignore rules need no change for this proposal.
- Compatibility: configurations relying on replacement, empty arrays disabling defaults, or absence of built-in compact rules must be documented with the `clearDefaults: true` migration path.
- Planning boundary: this change directory describes the target behavior. It does not mean the code, README, legacy plans, or installed extension have already been changed. Main-spec synchronization and legacy-file removal occur only after the corresponding behavior is verified and the user authorizes those steps; publishing and local installation are out of scope.
