## ADDED Requirements

### Requirement: Extension-local default retry policy

The configuration SHALL accept optional boolean `defaultRetry`, defaulting to `true`. After the existing recovery protections and extension exclusions are satisfied, pi-retry SHALL allow additional ordinary retry classification when `defaultRetry` is `true` or an active include rule matches. With `defaultRetry: false`, an active include match SHALL be required for additional classification. Existing built-in include rules SHALL remain active unless cleared; they SHALL NOT be converted into exclude rules.

This policy SHALL govern only pi-retry's additional classification. It SHALL NOT enable disabled Pi retry, suppress Pi's native retry classifications, change Pi settings, or grant additional attempts. The extension SHALL retain the existing global configuration load/reload lifecycle without creating or rewriting configuration files.

#### Scenario: Default-on behavior without configuration

- **GIVEN** Pi retry is enabled and a finalized ordinary assistant error is not native-retryable, protected, a context overflow, or a compact-rule match
- **WHEN** pi-retry loads with no configuration file or with `{}` and the error matches no include rule
- **THEN** pi-retry adds its retry hint while preserving the original error text
- **AND** Pi decides whether to retry within its existing policy and attempt budget
- **AND** no configuration file is created

#### Scenario: Explicit default-on behavior with no include rules

- **GIVEN** the configuration is `{ "defaultRetry": true, "clearDefaults": true, "include": [], "exclude": [] }`
- **WHEN** an otherwise eligible non-native-retryable ordinary error is finalized
- **THEN** pi-retry adds its ordinary retry hint without requiring an include match

#### Scenario: Default-off mode requires an include match for additional classification

- **GIVEN** the configuration is `{ "defaultRetry": false, "clearDefaults": true, "include": ["custom gateway failure"] }`
- **WHEN** an otherwise eligible non-native-retryable error is finalized
- **THEN** pi-retry adds a retry hint only if the error contains `custom gateway failure`
- **AND** an unmatched non-native-retryable error receives no extension-added wait

#### Scenario: Default-off mode retains built-in include rules

- **GIVEN** the configuration is `{ "defaultRetry": false }`
- **WHEN** an otherwise eligible error matches an existing built-in include rule
- **THEN** that rule remains available for pi-retry's additional classification
- **AND** no built-in include rule has become an exclusion

#### Scenario: Default-off mode leaves native retry and waiting support intact

- **GIVEN** the configuration is `{ "defaultRetry": false, "clearDefaults": true }`
- **WHEN** a non-excluded, otherwise eligible error is already native-retryable and contains a valid visible JSON `retry_after` hint
- **THEN** pi-retry adds no classification hint and does not prevent Pi's retry
- **AND** its existing server-derived minimum-wait behavior remains available

### Requirement: Extension-local retry exclusions

The configuration SHALL accept optional `exclude` as an array of strings, defaulting to an empty list. An active exclude match SHALL take precedence over include matches and `defaultRetry` for ordinary retry behavior. It SHALL suppress both additional retry classification and every extension-added waiting source for that error, including timed include rules and server hints. Matching SHALL use the original provider error text, not pi-retry's appended classification hint.

An exclusion SHALL NOT veto Pi's native retries, change the original failure into success or cancellation, change Pi settings, or control provider-internal retries. Ordinary retry exclusions and `defaultRetry` SHALL NOT alter the independent compact-rule path or weaken protected-error handling.

#### Scenario: Exclude overrides the default-on policy

- **GIVEN** the configuration is `{ "exclude": ["custom gateway failure"] }`
- **WHEN** an otherwise eligible non-native-retryable error contains `custom gateway failure`
- **THEN** pi-retry leaves the error unchanged and adds no ordinary retry hint or cooldown

#### Scenario: Exclude overrides a matching timed include in either mode

- **GIVEN** include contains `{ "match": "custom gateway failure", "waitMs": 60000 }` and exclude contains `custom gateway failure`
- **WHEN** a matching error with a visible JSON `retry_after` hint is finalized under either value of `defaultRetry`
- **THEN** pi-retry adds neither a retry hint nor a cooldown from either waiting source
- **AND** array order does not change this decision

#### Scenario: Exclude leaves native retries running without extension waiting

- **GIVEN** exclude contains `service unavailable` and Pi recognizes `503 service unavailable` as retryable
- **WHEN** that error is finalized, even if a timed include rule or valid server hint would otherwise select a wait
- **THEN** pi-retry preserves the original failure and adds no retry hint or cooldown
- **AND** Pi remains free to retry using its own attempt budget and backoff

#### Scenario: Retry exclusions do not suppress compaction

- **GIVEN** an otherwise eligible overflow error matches both compact and exclude rules
- **WHEN** the finalized error is processed with `defaultRetry: false`
- **THEN** the compact-rule normalization still makes it recognizable as context overflow
- **AND** no ordinary retry hint or cooldown is added

#### Scenario: A synthetic retry hint does not create an exclude match

- **GIVEN** exclude contains `provider returned error`, which is absent from the original provider error but present in pi-retry's appended hint
- **AND** the original failure is otherwise eligible for a server-derived cooldown
- **WHEN** the classified failure is evaluated for waiting
- **THEN** the generated hint does not cause exclusion or suppress that cooldown
- **AND** the hint on the finalized message remains available to Pi

## MODIFIED Requirements

### Requirement: Explicit clearing of both default rule sets

The configuration SHALL accept optional boolean `clearDefaults`, defaulting to `false`. When it is `true`, the extension SHALL omit both built-in lists before adding user entries. Omitted include and compact arrays SHALL then contribute empty lists. Clearing defaults SHALL NOT change `defaultRetry`, remove user-supplied exclude rules, disable protected-error checks, or disable or reconfigure Pi's native retry or compaction policies.

#### Scenario: Replace defaults with user rules

- **WHEN** the configuration is `{ "defaultRetry": false, "clearDefaults": true, "include": ["custom transient error"], "compact": ["custom input overflow"] }`
- **THEN** only the supplied user rules are available for pi-retry's additional classification
- **AND** none of the built-in rules are retained implicitly

#### Scenario: Disable all additional classification

- **WHEN** the configuration is `{ "defaultRetry": false, "clearDefaults": true }`
- **THEN** pi-retry adds no retry or compact classifications
- **AND** Pi's native recovery behavior remains unaffected
- **AND** server-derived waiting for otherwise eligible native retries remains available

#### Scenario: Clearing lists alone retains the new default policy

- **GIVEN** the configuration is `{ "clearDefaults": true }`
- **WHEN** an otherwise eligible non-native-retryable ordinary error is finalized
- **THEN** pi-retry adds a retry hint through the default-on policy even though both built-in lists are empty

#### Scenario: Clearing defaults preserves user exclusions

- **GIVEN** the configuration is `{ "clearDefaults": true, "exclude": ["custom gateway failure"] }`
- **WHEN** an ordinary error contains `custom gateway failure`
- **THEN** the user exclusion still suppresses pi-retry's additional classification and waiting

### Requirement: Literal matching and fail-closed validation

The extension SHALL trim include strings, include-object `match` strings, exclude strings, and compact strings; ignore otherwise valid entries with blank match strings; and match nonblank strings as case-insensitive literal substrings rather than regular expressions. The configuration root MUST be a JSON object. A supplied `include` MUST be an array of strings or objects with a string `match` and a non-negative safe-integer `waitMs`. Both object fields MUST be present. Supplied `exclude` and `compact` values MUST be arrays containing only strings. Supplied `defaultRetry` and `clearDefaults` values MUST be booleans. Omitted `defaultRetry` SHALL resolve to `true`; an omitted exclude array SHALL resolve to an empty list. Unrecognized object properties SHALL have no effect.

Invalid JSON, invalid recognized values, or an error reading an existing configuration SHALL disable all extension-added classification, including default-on classification and compaction normalization, and all extension-added waiting without breaking Pi. The extension SHALL NOT silently fall back to built-in rules or partially apply valid fields from an invalid configuration. Invalid server-provided retry hints SHALL NOT invalidate otherwise valid user configuration.

#### Scenario: Normalize supplied strings

- **GIVEN** the configuration is `{ "defaultRetry": false, "clearDefaults": true, "include": ["  ", " TRANSIENT.FAILURE "] }`
- **WHEN** a finalized assistant error contains `transient.failure`
- **THEN** the nonblank user rule matches
- **AND** that same rule does not match `transientXfailure`

#### Scenario: Normalize exclude strings without regular expressions

- **GIVEN** the configuration contains `"exclude": ["  ", " TERMINAL.FAILURE ", "*"]`
- **WHEN** an ordinary error is finalized
- **THEN** `terminal.failure` matches the nonblank exclusion but `terminalXfailure` does not
- **AND** the blank entry matches nothing and `*` matches only a literal asterisk

#### Scenario: Reject malformed recognized values

- **WHEN** the configuration is any of `null`, `[]`, `{ "include": [520] }`, `{ "compact": null }`, or `{ "clearDefaults": "false" }`
- **THEN** all extension-added classification and waiting are disabled
- **AND** Pi continues without pi-retry recovery hints

#### Scenario: Reject invalid new fields without restoring defaults

- **WHEN** the configuration supplies a non-boolean `defaultRetry`, including `null`, `0`, or `"false"`, or supplies `exclude` as `null`, a scalar, or an array containing a number or object
- **THEN** the entire extension configuration fails closed
- **AND** neither omitted default-on behavior, valid sibling rules, nor a server hint restores extension-added recovery or waiting

#### Scenario: Reject invalid JSON

- **WHEN** the global configuration contains `not json`
- **THEN** extension-added classification is disabled rather than restored to defaults
- **AND** no extension cooldown applies, including one derived from a server hint

#### Scenario: Validate timed entries without partially applying configuration

- **WHEN** an include object has a missing field, a non-string `match`, or a negative, fractional, string, or unsafe-integer `waitMs`
- **THEN** the entire recovery configuration fails closed
- **AND** valid sibling entries are not partially applied

#### Scenario: Ignore a valid blank timed match

- **WHEN** an include object is `{ "match": "  ", "waitMs": 60000 }`
- **THEN** it matches no error and supplies no waiting override

### Requirement: Native retry delegation

For a finalized assistant message with `stopReason` equal to `error` and a nonempty error message, the extension SHALL add a native-recognizable retry hint only if its configuration is valid, `defaultRetry` is `true` or an active include rule matches, file-backed Pi retry is enabled for the session, and the error is neither extension-excluded, protected, a context overflow, a compact-rule match, already native-retryable, nor already marked by pi-retry. Native retry exclusions exposed by the host SHALL NOT be bypassed.

The original error text SHALL remain visible. Classification SHALL be idempotent. Pi SHALL retain ownership of retry attempts, native backoff, and continuation. The extension SHALL NOT implement an independent retry loop or watchdog, change Pi's retry settings, or issue a replacement model request. Neither an extension exclude match nor `defaultRetry: false` SHALL veto a native retry. The extension SHALL only add cancellable remaining-time waiting for an eligible native retry under the minimum-wait requirements below. Native recognition SHALL NOT prevent evaluation of waiting rules or JSON server hints unless extension exclusions or existing recovery protections prohibit extension waiting. For embedded SDK hosts whose injected policy differs from file-backed settings, the extension SHALL NOT claim to detect the injected policy.

#### Scenario: Classify an otherwise unrecognized transient error once

- **GIVEN** Pi retry is enabled and the extension's default-on policy or an active include rule allows `custom transient error`
- **WHEN** a finalized assistant error contains that text and meets the eligibility conditions
- **THEN** its original error text remains visible and Pi can recognize it as retryable
- **AND** processing the classified message again does not add another hint

#### Scenario: Respect disabled retry and native classifications

- **WHEN** an error allowed by the extension policy occurs with file-backed Pi retry disabled, or Pi already recognizes that error as retryable
- **THEN** pi-retry adds no ordinary retry hint
- **AND** disabled retry prevents additional cooldowns, while native recognition alone does not

#### Scenario: Leave ineligible messages unchanged

- **WHEN** a message is not an assistant error, is aborted, has no error text, or has no compact match and no include match with `defaultRetry: false`
- **THEN** pi-retry leaves that message unchanged
- **AND** an unchanged native-retryable error can still receive a cooldown from a valid JSON server hint when no extension exclusion or existing protection prohibits it

#### Scenario: A server hint does not create retry eligibility

- **GIVEN** `defaultRetry` is `false` and an error is neither native-retryable nor eligible through an include rule
- **WHEN** its JSON body contains `"retry_after": 60`
- **THEN** the extension does not initiate or enable a retry merely because the hint is present

#### Scenario: Native exclusions still constrain plugin additions

- **GIVEN** the host exposes a native non-retryable error pattern matching the failure
- **WHEN** that failure also matches include or the extension's default-on policy
- **THEN** pi-retry adds neither a retry hint nor a cooldown

#### Scenario: Default-on classification cannot increase the native retry budget

- **GIVEN** Pi retry is enabled with `maxRetries: 2` and each main-agent request returns an otherwise eligible error recognized only through pi-retry's default-on policy
- **WHEN** the initial request and two native retries fail without any separate continuation or provider-internal retry
- **THEN** exactly three main-agent provider requests occur and the run ends with the failure
- **AND** pi-retry starts no additional attempt or continuation

#### Scenario: Exhausted native budget stays exhausted

- **GIVEN** Pi retry is enabled with `maxRetries: 0`
- **WHEN** an otherwise eligible error receives an extension retry hint through the default-on policy
- **THEN** Pi sends no retry request
- **AND** any extension waiting state cannot revive the budget or delay an unrelated subsequent request

### Requirement: User waiting overrides server retry hints

For an eligible ordinary retry, the extension SHALL select the largest `waitMs` among matching timed user rules when any such rule matches. Otherwise, it SHALL use a valid top-level `retry_after` field from the JSON error body exposed by the provider, in seconds. Otherwise, it SHALL add no minimum interval beyond Pi's native timing. It SHALL NOT combine a configured interval with a server interval by taking their sum or maximum. Classification-only strings, including built-ins, SHALL NOT count as waiting overrides. An extension exclude match SHALL prevent selection from either source, including for errors that Pi independently retries.

Waiting eligibility SHALL require valid configuration, enabled file-backed Pi retry, and satisfaction of existing protections and both native and extension exclusions. Subject to those conditions, native recognition, `defaultRetry: true`, or an active include match SHALL establish eligibility. Changing `defaultRetry` to `false` SHALL NOT remove waiting support from otherwise eligible native-retryable errors. Rule matching and server-hint parsing SHALL continue to ignore the extension's appended classification hint while leaving that hint on the finalized message.

A server hint MUST be a finite, non-negative JSON number safely convertible to milliseconds; fractional seconds SHALL be rounded up to whole milliseconds. Numeric strings, negative or unusable numbers, malformed JSON, and prose mentioning `retry_after` SHALL NOT supply a hint. An explicit selected zero SHALL add no cooldown and SHALL NOT fall through to a lower-priority source. Server hints SHALL apply to all otherwise eligible retries, including native-retryable errors and errors eligible only through the extension's default-on policy with no include match. The extension SHALL NOT infer hints from HTTP response headers or guess values from an unavailable JSON body.

#### Scenario: A shorter user wait overrides the server

- **GIVEN** a matching user rule specifies `waitMs: 10000` and the error body contains `"retry_after": 60`
- **WHEN** the eligible error is finalized
- **THEN** the selected minimum interval is 10 seconds, not 60 seconds

#### Scenario: A longer user wait overrides the server

- **GIVEN** a matching user rule specifies `waitMs: 60000` and the body contains `"retry_after": 10`
- **WHEN** the eligible error is finalized
- **THEN** the selected minimum interval is 60 seconds

#### Scenario: Multiple timed matches select the largest user value

- **GIVEN** matching rules specify 10000 and 60000 milliseconds and the body requests 120 seconds
- **WHEN** the eligible error is finalized
- **THEN** the selected interval is 60000 milliseconds regardless of rule order

#### Scenario: Explicit zero overrides a server hint

- **GIVEN** the largest matching user wait is zero and the body contains `"retry_after": 60`
- **WHEN** the eligible error is finalized
- **THEN** Pi's native delay remains unchanged and no extension cooldown applies

#### Scenario: A server hint needs no include match

- **GIVEN** Pi recognizes a 502 error as retryable, no extension exclusion matches, and no timed user rule matches
- **WHEN** the JSON body contains `"retry_after": 60`
- **THEN** the selected minimum interval is 60 seconds, whether no include rule or only classification-only strings match and regardless of `defaultRetry`

#### Scenario: Default-on eligibility can use a server hint without an include match

- **GIVEN** an otherwise eligible error is not native-retryable, matches no include rule, and `defaultRetry` is `true`
- **WHEN** its visible JSON body contains `"retry_after": 60`
- **THEN** the error receives the extension's retry hint and the selected minimum interval is 60 seconds
- **AND** the actual retry and its attempt budget remain controlled by Pi

#### Scenario: Invalid hints leave native timing unchanged

- **GIVEN** no timed rule matches
- **WHEN** `retry_after` is missing, a string, negative, unusable, or not part of a valid JSON body
- **THEN** no extension cooldown applies

#### Scenario: Convert fractional seconds and accept server zero

- **GIVEN** no timed rule matches
- **WHEN** the body supplies `"retry_after": 0.2501` or `"retry_after": 0`
- **THEN** the selected minimum interval is respectively 251 milliseconds or zero
