## MODIFIED Requirements

### Requirement: User rules append by default

The configuration SHALL accept an optional `include` array whose entries are strings or objects containing `match` and `waitMs`, and an optional `compact` array of strings. An include string SHALL specify classification only. An include object SHALL use `match` for the same classification and explicitly configure a minimum waiting interval in milliseconds. Unless `clearDefaults` is `true`, supplied entries SHALL append to the corresponding built-in list. An omitted array or an empty array SHALL add no rules and SHALL NOT remove defaults. Adding rules to one list SHALL NOT change the other list. Existing built-in entries SHALL NOT acquire implicit waiting overrides.

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

#### Scenario: Mix classification-only and timed rules

- **WHEN** the configuration contains `"custom transient error"` and `{ "match": "API error (502)", "waitMs": 60000 }` in `include`
- **THEN** both entries participate in retry classification
- **AND** only the object entry explicitly selects a configured waiting interval

### Requirement: Literal matching and fail-closed validation

The extension SHALL trim include strings, include-object `match` strings, and compact strings; ignore otherwise valid entries with blank match strings; and match nonblank strings as case-insensitive literal substrings rather than regular expressions. The configuration root MUST be a JSON object. A supplied `include` MUST be an array of strings or objects with a string `match` and a non-negative safe-integer `waitMs`. Both object fields MUST be present. A supplied `compact` MUST be an array containing only strings, and a supplied `clearDefaults` MUST be a boolean. Unrecognized object properties SHALL have no effect.

Invalid JSON, invalid recognized values, or an error reading an existing configuration SHALL disable both additional classification lists and all extension-added waiting without breaking Pi. The extension SHALL NOT silently fall back to built-in rules or partially apply valid fields from an invalid configuration. Invalid server-provided retry hints SHALL NOT invalidate otherwise valid user configuration.

#### Scenario: Normalize supplied strings

- **GIVEN** the configuration is `{ "clearDefaults": true, "include": ["  ", " TRANSIENT.FAILURE "] }`
- **WHEN** a finalized assistant error contains `transient.failure`
- **THEN** the nonblank user rule matches
- **AND** that same rule does not match `transientXfailure`

#### Scenario: Reject malformed recognized values

- **WHEN** the configuration is any of `null`, `[]`, `{ "include": [520] }`, `{ "compact": null }`, or `{ "clearDefaults": "false" }`
- **THEN** both additional classification lists are empty and no extension cooldown applies
- **AND** Pi continues without pi-retry recovery hints

#### Scenario: Reject invalid JSON

- **WHEN** the global configuration contains `not json`
- **THEN** both additional classification lists are empty rather than restored to their defaults
- **AND** no extension cooldown applies, including one derived from a server hint

#### Scenario: Validate timed entries without partially applying configuration

- **WHEN** an include object has a missing field, a non-string `match`, or a negative, fractional, string, or unsafe-integer `waitMs`
- **THEN** the entire recovery configuration fails closed
- **AND** valid sibling entries are not partially applied

#### Scenario: Ignore a valid blank timed match

- **WHEN** an include object is `{ "match": "  ", "waitMs": 60000 }`
- **THEN** it matches no error and supplies no waiting override

### Requirement: Native retry delegation

For a finalized assistant message with `stopReason` equal to `error` and a nonempty error message, the extension SHALL add a native-recognizable retry hint only if an active include rule matches, file-backed Pi retry is enabled for the session, and the error is neither protected, a context overflow, a compact-rule match, already native-retryable, nor already marked by pi-retry. Native retry exclusions SHALL NOT be bypassed.

The original error text SHALL remain visible. Classification SHALL be idempotent. Pi SHALL retain ownership of retry attempts, native backoff, and continuation. The extension SHALL NOT implement an independent retry loop or watchdog, change Pi's retry settings, or issue a replacement model request. It SHALL only add cancellable remaining-time waiting for an eligible native retry under the minimum-wait requirements below. Native recognition SHALL NOT prevent evaluation of waiting rules or JSON server hints. For embedded SDK hosts whose injected policy differs from file-backed settings, the extension SHALL NOT claim to detect the injected policy.

#### Scenario: Classify an otherwise unrecognized transient error once

- **GIVEN** Pi retry is enabled and the active include list matches `custom transient error`
- **WHEN** a finalized assistant error contains that text and meets the eligibility conditions
- **THEN** its original error text remains visible and Pi can recognize it as retryable
- **AND** processing the classified message again does not add another hint

#### Scenario: Respect disabled retry and native classifications

- **WHEN** an include-matching error occurs with file-backed Pi retry disabled, or Pi already recognizes that error as retryable
- **THEN** pi-retry adds no ordinary retry hint
- **AND** disabled retry prevents additional cooldowns, while native recognition alone does not

#### Scenario: Leave ineligible messages unchanged

- **WHEN** a message is not an assistant error, is aborted, has no error text, or matches no active recovery rule
- **THEN** pi-retry leaves that message unchanged
- **AND** an unchanged native-retryable error can still receive a cooldown from a valid JSON server hint

#### Scenario: A server hint does not create retry eligibility

- **GIVEN** an error is neither native-retryable nor eligible through an include rule
- **WHEN** its JSON body contains `"retry_after": 60`
- **THEN** the extension does not initiate or enable a retry merely because the hint is present

### Requirement: Compaction precedence and protected errors

A finalized assistant error matching an active compact rule SHALL be made recognizable to Pi as context overflow, preserving the original error text, unless Pi already recognizes the overflow or the error is protected. A compact match SHALL NOT become an ordinary retry through an include rule, even when both lists match or ordinary retry is disabled. Neither configured waits nor server retry hints SHALL add a cooldown to compaction recovery.

Quota, usage-limit, budget, billing, payment, account-balance, exhausted-credit, and spending-limit failures SHALL remain excluded from additional retry and compact classification and extension cooldowns. Pi SHALL own compaction, its enablement setting, and its bounded recovery retry; the extension SHALL NOT bypass that setting or start an independent compaction loop.

#### Scenario: Recover a configured input-limit error

- **GIVEN** an otherwise unrecognized assistant error matches an active compact rule
- **WHEN** the error is finalized and is not protected
- **THEN** Pi can recognize it as context overflow with the original text preserved
- **AND** whether compaction runs remains controlled by Pi's native policy

#### Scenario: Prefer compaction over a broad retry include

- **GIVEN** an error matches both an active compact rule and an include rule
- **WHEN** pi-retry classifies the finalized error
- **THEN** it does not add an ordinary retry hint or cooldown
- **AND** ordinary retry being disabled does not prevent eligible overflow normalization

#### Scenario: Preserve protected failures under broad rules

- **GIVEN** both rule lists would match the reported error
- **WHEN** the finalized error reports `Provider quota exceeded`, `HTTP 402 Payment Required`, `Account credits exhausted`, or `Monthly usage limit reached`
- **THEN** pi-retry leaves that error unchanged
- **AND** neither a timed include match nor a server retry hint schedules an extension cooldown

## ADDED Requirements

### Requirement: User waiting overrides server retry hints

For an eligible retry, the extension SHALL select the largest `waitMs` among matching timed user rules when any such rule matches. Otherwise, it SHALL use a valid top-level `retry_after` field from the JSON error body exposed by the provider, in seconds. Otherwise, it SHALL add no minimum interval beyond Pi's native timing. It SHALL NOT combine a configured interval with a server interval by taking their sum or maximum. Classification-only strings, including built-ins, SHALL NOT count as waiting overrides.

A server hint MUST be a finite, non-negative JSON number safely convertible to milliseconds; fractional seconds SHALL be rounded up to whole milliseconds. Numeric strings, negative or unusable numbers, malformed JSON, and prose mentioning `retry_after` SHALL NOT supply a hint. An explicit selected zero SHALL add no cooldown and SHALL NOT fall through to a lower-priority source. Server hints SHALL apply to all otherwise eligible retries, including native-retryable errors with no include match. The extension SHALL NOT infer hints from HTTP response headers or guess values from an unavailable JSON body.

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

- **GIVEN** Pi recognizes a 502 error as retryable and no timed user rule matches
- **WHEN** the JSON body contains `"retry_after": 60`
- **THEN** the selected minimum interval is 60 seconds, whether no include rule or only classification-only strings match

#### Scenario: Invalid hints leave native timing unchanged

- **GIVEN** no timed rule matches
- **WHEN** `retry_after` is missing, a string, negative, unusable, or not part of a valid JSON body
- **THEN** no extension cooldown applies

#### Scenario: Convert fractional seconds and accept server zero

- **GIVEN** no timed rule matches
- **WHEN** the body supplies `"retry_after": 0.2501` or `"retry_after": 0`
- **THEN** the selected minimum interval is respectively 251 milliseconds or zero

### Requirement: Native backoff counts toward the minimum wait

The selected interval SHALL be measured from observation of the finalized eligible error, not from the start of the provider request or the end of native backoff. Pi's backoff and other elapsed processing time SHALL count toward it. Before the corresponding native retry reaches the provider, the extension SHALL wait only for the unelapsed portion. It SHALL neither shorten native backoff nor sleep for the full interval after native backoff. Re-observing the same finalized failure SHALL NOT extend its deadline; a genuinely new failed retry SHALL establish its own deadline.

#### Scenario: Supplement a short native backoff

- **GIVEN** the selected interval is 60 seconds and Pi's backoff finishes 2 seconds after the finalized error
- **WHEN** the corresponding retry is ready to request the provider
- **THEN** the extension waits only for the remaining approximately 58 seconds
- **AND** the request is not sent before the 60-second deadline and is not deliberately delayed until 62 seconds

#### Scenario: Do not supplement an already sufficient backoff

- **GIVEN** the selected interval is 60 seconds and Pi already waited 90 seconds
- **WHEN** the corresponding retry is ready to request the provider
- **THEN** the extension adds no waiting and does not shorten Pi's delay

#### Scenario: A subsequent failure receives a fresh interval

- **GIVEN** an eligible retry request fails again after the previous cooldown was consumed
- **WHEN** that new failure selects a 10-second minimum interval
- **THEN** the next eligible retry observes a fresh 10-second minimum from that new finalized error

### Requirement: Cooldown ownership and cancellation

A cooldown SHALL belong only to the originating session and eligible automatic retry. It SHALL NOT start another request, revive an exhausted retry budget, or delay an unrelated user request, extension-requested continuation, compaction, summary, or cache refresh. Cancellation SHALL promptly release any extension wait and prevent the canceled request from being sent. Success, terminal completion, session or runtime replacement, and a fresh user request SHALL clear obsolete cooldown state. An intermediate failed attempt ending SHALL NOT alone discard a cooldown needed by its upcoming native retry. Cooldowns SHALL NOT be persisted or replayed when a session is resumed.

#### Scenario: Cancel during the remaining wait

- **GIVEN** the corresponding retry is waiting for the remainder of a cooldown
- **WHEN** the user cancels it
- **THEN** the wait ends promptly, the canceled request is not sent, and the next user request inherits no cooldown

#### Scenario: Exhaustion does not delay an unrelated continuation

- **GIVEN** a failure contains a wait rule or server hint but Pi's retry budget is exhausted
- **WHEN** another extension requests a continuation or the user sends a new request
- **THEN** pi-retry neither revives the failed retry nor applies its cooldown to that unrelated request

#### Scenario: Switching or reloading discards a pending cooldown

- **GIVEN** a cooldown is pending or being awaited
- **WHEN** the session switches or the extension runtime is reloaded or shut down
- **THEN** its waiting resources and state are released and cannot affect the new session or runtime

### Requirement: Transient cooldown status

When a positive remaining wait is actually being awaited in an interactive session, the extension SHALL expose a transient status indicating additional retry waiting. It SHALL clear its own status on completion, cancellation, or invalidation. It SHALL NOT present this as a replacement for Pi's native countdown, add status messages to model context, or require a UI for correct non-interactive waiting.

#### Scenario: Show only actual supplementary waiting

- **WHEN** Pi finishes native backoff and a positive cooldown remainder remains
- **THEN** the interactive session shows an additional-wait status until that remainder completes or is canceled
- **AND** a retry needing no supplementary wait shows no stale extension waiting status

#### Scenario: Waiting works without a terminal

- **WHEN** the same eligible retry occurs in a non-interactive session
- **THEN** the minimum interval and cancellation behavior remain effective without a terminal UI
