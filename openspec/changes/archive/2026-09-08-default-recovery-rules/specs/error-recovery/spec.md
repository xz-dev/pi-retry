## Purpose

Provide predictable recovery hints for provider errors that Pi does not already classify, with useful built-in rules and explicit user control while leaving retry and compaction execution to Pi.

## ADDED Requirements

### Requirement: Global configuration lifecycle

The extension SHALL read recovery configuration from `$PI_CODING_AGENT_DIR/pi-retry.json`, normally `~/.pi/agent/pi-retry.json`, when the extension loads. It SHALL NOT load project-local recovery rules or rewrite the user's configuration file. A reload or restart SHALL be required to apply subsequent configuration-file changes.

#### Scenario: Configuration changes take effect on reload

- **GIVEN** the extension has loaded its global recovery configuration
- **WHEN** the user edits that configuration file
- **THEN** the active rule sets remain unchanged until the extension reloads or Pi restarts
- **AND** the next load uses the updated global configuration

### Requirement: Built-in recovery rules

The extension SHALL provide the following built-in rule sets without requiring a configuration file. These strings SHALL be shipped with the extension rather than obtained from a maintainer's local files:

| Rule set | Literal substring |
| --- | --- |
| include | `OpenAI API error (520): 520 status code (no body)` |
| include | `OpenAI API error (522): 522 status code (no body)` |
| include | `OpenAI API error (530): 530 status code (no body)` |
| include | `unknown certificate verification error` |
| include | `upstream_error: Upstream request failed` |
| include | `Upstream stream failed before completion.` |
| include | `Service temporarily unavailable due to resource pressure. Retry shortly.` |
| include | `are cooling down (reset after 5s)` |
| include | `Responses WebSocket closed (1006): Connection ended` |
| include | `Connection error.` |
| compact | `Reduce the prompt or route to a model with a larger input limit` |

Built-in matches SHALL remain subject to the recovery eligibility, precedence, and protection requirements below; inclusion in this table does not force a second classification of an error Pi already recognizes.

#### Scenario: No configuration file

- **WHEN** the extension loads without a global recovery configuration file
- **THEN** all 10 built-in include rules and the built-in compact rule are available
- **AND** no configuration file is created

#### Scenario: Empty configuration object

- **WHEN** the extension loads `{}` as its global recovery configuration
- **THEN** the same built-in rule sets are available as when no configuration file exists

### Requirement: User rules append by default

The configuration SHALL accept optional `include` and `compact` arrays of strings. Unless `clearDefaults` is `true`, supplied entries SHALL append to the corresponding built-in list. An omitted array or an empty array SHALL add no rules and SHALL NOT remove defaults. Adding rules to one list SHALL NOT change the other list.

#### Scenario: Add a retry rule without losing built-in recovery

- **WHEN** the configuration is `{ "include": ["custom transient error"] }`
- **THEN** retry matching includes both the built-in include rules and `custom transient error`
- **AND** the built-in compact rule remains available

#### Scenario: Configure only compaction rules

- **WHEN** the configuration is `{ "compact": ["custom input overflow"] }`
- **THEN** compact matching includes both the built-in compact rule and `custom input overflow`
- **AND** all built-in include rules remain available

#### Scenario: Empty arrays and explicit false preserve defaults

- **WHEN** the configuration is `{ "clearDefaults": false, "include": [], "compact": [] }`
- **THEN** both built-in rule sets remain available

### Requirement: Explicit clearing of both default rule sets

The configuration SHALL accept optional boolean `clearDefaults`, defaulting to `false`. When it is `true`, the extension SHALL omit both built-in lists before adding user entries. Omitted arrays SHALL then contribute empty lists. Clearing defaults SHALL NOT disable or reconfigure Pi's native retry or compaction policies.

#### Scenario: Replace defaults with user rules

- **WHEN** the configuration is `{ "clearDefaults": true, "include": ["custom transient error"], "compact": ["custom input overflow"] }`
- **THEN** only the supplied user rules are available for pi-retry's additional classification
- **AND** none of the built-in rules are retained implicitly

#### Scenario: Disable all additional classification

- **WHEN** the configuration is `{ "clearDefaults": true }`
- **THEN** pi-retry adds no retry or compact classifications
- **AND** Pi's native recovery behavior remains unaffected

### Requirement: Literal matching and fail-closed validation

The extension SHALL trim supplied strings, ignore blank strings, and match nonblank strings as case-insensitive literal substrings rather than regular expressions. The configuration root MUST be a JSON object; a supplied `include` or `compact` MUST be an array containing only strings, and a supplied `clearDefaults` MUST be a boolean. Unrecognized object properties SHALL have no effect.

Invalid JSON, invalid recognized values, or an error reading an existing configuration SHALL disable both additional classification lists without breaking Pi. The extension SHALL NOT silently fall back to built-in rules or partially apply valid fields from an invalid configuration.

#### Scenario: Normalize supplied strings

- **GIVEN** the configuration is `{ "clearDefaults": true, "include": ["  ", " TRANSIENT.FAILURE "] }`
- **WHEN** a finalized assistant error contains `transient.failure`
- **THEN** the nonblank user rule matches
- **AND** that same rule does not match `transientXfailure`

#### Scenario: Reject malformed recognized values

- **WHEN** the configuration is any of `null`, `[]`, `{ "include": [520] }`, `{ "compact": null }`, or `{ "clearDefaults": "false" }`
- **THEN** both additional classification lists are empty
- **AND** Pi continues without pi-retry recovery hints

#### Scenario: Reject invalid JSON

- **WHEN** the global configuration contains `not json`
- **THEN** both additional classification lists are empty rather than restored to their defaults

### Requirement: Native retry delegation

For a finalized assistant message with `stopReason` equal to `error` and a nonempty error message, the extension SHALL add a native-recognizable retry hint only if an active include rule matches, file-backed Pi retry is enabled for the session, and the error is neither protected, a context overflow, a compact-rule match, already native-retryable, nor already marked by pi-retry.

The original error text SHALL remain visible. Classification SHALL be idempotent. Pi SHALL retain ownership of retry attempts and backoff; the extension SHALL NOT implement its own retry loop, timer, or watchdog. For embedded SDK hosts whose injected policy differs from file-backed settings, the extension SHALL NOT claim to detect the injected policy.

#### Scenario: Classify an otherwise unrecognized transient error once

- **GIVEN** Pi retry is enabled and the active include list matches `custom transient error`
- **WHEN** a finalized assistant error contains that text and meets the eligibility conditions
- **THEN** its original error text remains visible and Pi can recognize it as retryable
- **AND** processing the classified message again does not add another hint

#### Scenario: Respect disabled retry and native classifications

- **WHEN** an include-matching error occurs with file-backed Pi retry disabled, or Pi already recognizes that error as retryable
- **THEN** pi-retry adds no ordinary retry hint

#### Scenario: Leave ineligible messages unchanged

- **WHEN** a message is not an assistant error, is aborted, has no error text, or matches no active recovery rule
- **THEN** pi-retry leaves it unchanged

### Requirement: Compaction precedence and protected errors

A finalized assistant error matching an active compact rule SHALL be made recognizable to Pi as context overflow, preserving the original error text, unless Pi already recognizes the overflow or the error is protected. A compact match SHALL NOT become an ordinary retry through an include rule, even when both lists match or ordinary retry is disabled.

Quota, usage-limit, budget, billing, payment, account-balance, exhausted-credit, and spending-limit failures SHALL remain excluded from additional retry and compact classification. Pi SHALL own compaction, its enablement setting, and its bounded recovery retry; the extension SHALL NOT bypass that setting or start an independent compaction loop.

#### Scenario: Recover a configured input-limit error

- **GIVEN** an otherwise unrecognized assistant error matches an active compact rule
- **WHEN** the error is finalized and is not protected
- **THEN** Pi can recognize it as context overflow with the original text preserved
- **AND** whether compaction runs remains controlled by Pi's native policy

#### Scenario: Prefer compaction over a broad retry include

- **GIVEN** an error matches both an active compact rule and an include rule
- **WHEN** pi-retry classifies the finalized error
- **THEN** it does not add an ordinary retry hint
- **AND** ordinary retry being disabled does not prevent eligible overflow normalization

#### Scenario: Preserve protected failures under broad rules

- **GIVEN** both rule lists would match the reported error
- **WHEN** the finalized error reports `Provider quota exceeded`, `HTTP 402 Payment Required`, `Account credits exhausted`, or `Monthly usage limit reached`
- **THEN** pi-retry leaves that error unchanged
