# pi-retry

Recovery hints and minimum waits for Pi provider errors.

`pi-retry` does not implement retry or compaction loops. It normalizes known context-overflow errors for Pi's native compact-and-retry path, marks otherwise eligible provider errors for Pi's native retry path by default, and can supplement native backoff without adding two full delays.

## Install

```bash
pi install git:github.com/xz-dev/pi-retry
```

Restart Pi after installation.

## Configure

No configuration is needed: pi-retry adds retry hints for otherwise eligible ordinary errors by default. The 13 built-in include rules and one context-compaction rule remain available; see the [recovery specification](openspec/specs/error-recovery/spec.md) for their exact strings. Eligible errors can also use a server's visible JSON `retry_after` hint.

To exclude errors or add rules, create `$PI_CODING_AGENT_DIR/pi-retry.json` (normally `~/.pi/agent/pi-retry.json`):

```json
{
  "defaultRetry": true,
  "exclude": ["invalid API key", "unsupported model"],
  "include": [{ "match": "custom gateway failure", "waitMs": 60000 }],
  "compact": ["custom input overflow"]
}
```

All fields are optional:

- `defaultRetry`: boolean, default `true`. Allow additional ordinary retry classification without an include match. Set `false` to require an active include match, including built-ins unless cleared.
- `exclude`: string array, default `[]`. A match prevents pi-retry from adding an ordinary retry hint or any extra wait, even when include also matches. It does **not** stop Pi's own retries or compact recovery.
- `include`: strings or `{ "match": "...", "waitMs": 60000 }` rules to append to the built-in include list. Strings allow additional classification in include-only mode; objects also set a minimum wait in milliseconds in either mode.
- `compact`: overflow substrings to append to the built-in compact list, independently of `defaultRetry` and `exclude`.
- `clearDefaults`: boolean, default `false`. Set `true` to clear **both** built-in include and compact lists before adding user rules. This does not turn off `defaultRetry`, remove user exclusions, or disable fixed protections.

Strings are trimmed and matched as case-insensitive literal substrings, not regular expressions or globs; blank strings are ignored and `*` matches only a literal asterisk. `{}`, omitted arrays, and empty arrays retain defaults unless `clearDefaults` is `true`. Compact-only configuration is valid. The built-in include strings are not converted into excludes.

To use the previous include-based policy while retaining built-ins:

```json
{
  "defaultRetry": false
}
```

To allow only your own include rules for **additional classification**:

```json
{
  "defaultRetry": false,
  "clearDefaults": true,
  "include": ["custom transient error"],
  "compact": []
}
```

This also removes the built-in compact rule. Supply the compact strings you want to retain; Pi's native compaction policy is not changed.

To disable all pi-retry classification without changing Pi's native recovery settings:

```json
{
  "defaultRetry": false,
  "clearDefaults": true
}
```

This clears additional classification, not server-provided waiting hints for non-excluded errors Pi already recognizes. Disable the extension to remove all of its behavior.

**Only pi-retry is controlled:** an excluded 503 can still be retried by Pi, using native timing without pi-retry's extra wait. Likewise, `defaultRetry: false` does not switch off native retries or their existing plugin waiting support. Provider-internal retries and transport recovery are outside these rules.

### Upgrade and rollback

**Default-on is a behavior change.** Add `defaultRetry: false` to preserve previous include-based classification. Replace the old `{ "clearDefaults": true }` no-additional-classification configuration with `{ "defaultRetry": false, "clearDefaults": true }`; clearing lists alone now leaves default-on classification active. Default-on can retry previously unrecognized permanent errors up to Pi's budget; use excludes or include-only mode when needed.

For configurations from older replacement-style versions, keep `clearDefaults: true` when only your supplied rules should remain, and add `defaultRetry: false` for include-only classification. An empty include array alone does not remove built-in rules. No user configuration is rewritten automatically.

Earlier versions ignore the unknown `defaultRetry` and `exclude` fields and return to include-based classification. They do **not** preserve exclusions: review overlapping include and waiting rules before rollback. Before rolling back to a version without timed rules, replace object entries with their match strings; those versions reject object entries.

The original error remains visible. Compaction recovery requires Pi's `compaction.enabled` setting. Configuration is global only and is read when the extension loads; use `/reload` after changing it.

Invalid JSON, a read error, or an invalid recognized field disables **all extension-added classification and waiting**, including default-on classification, compact normalization, and server-derived waits, instead of falling back to defaults or breaking Pi. `exclude` and `compact` must contain only strings. Each include object requires a string `match` and a non-negative safe-integer `waitMs`; zero is valid. Match strings are trimmed and blank matches are ignored. `defaultRetry` and `clearDefaults` must be booleans. Unknown properties are ignored.

## Minimum waiting intervals

For example, require at least 60 seconds before retrying a matching gateway error:

```json
{
  "include": [
    { "match": "API error (502)", "waitMs": 60000 },
    "custom transient error"
  ]
}
```

The waiting source is selected in this order:

1. **Explicit user rule:** the largest `waitMs` among matching object entries.
2. **Server hint:** a valid top-level `retry_after` in the JSON error body exposed in the finalized error text, interpreted as **seconds**.
3. **Native timing only:** no additional cooldown.

A matching `waitMs: 0` overrides a server hint and adds no cooldown. Plain strings and built-in rules do not override server hints. A hint can apply without an include match when Pi already considers the error retryable or the extension's default-on policy allows it. In include-only mode, a hint alone never makes an otherwise unrecognized error retryable. Exclude matches suppress both waiting sources, including for native-retryable errors.

The interval starts when the error is finalized. Pi's own backoff counts toward it: if the selected interval is 60 seconds and Pi already waited 2 seconds, pi-retry waits only the remaining approximately 58 seconds. If Pi already waited 90 seconds, it adds no wait. It does not shorten native backoff or add the complete configured interval after it.

Server hints must be finite, non-negative JSON numbers safely convertible to milliseconds. Fractional seconds are rounded up to whole milliseconds. Numeric strings, nested hints, malformed JSON, and prose such as `retry_after: 60` are not parsed as hints; HTTP `Retry-After` headers are not read.

**Body visibility matters:** some provider/SDK paths discard the response body and report `status code (no body)`. The extension cannot recover a hint it never receives. In that case, an explicit matching user rule still works; without one, native timing remains unchanged. Tests cover both a top-level HTTP error body omitted by the pinned SDK and a wrapped error body that remains visible. This is not a claim that every gateway exposes its JSON unchanged.

During actual supplementary waiting, interactive sessions show a transient cooldown status. Escape cancels the active retry. Waiting also works without a terminal UI. Cooldowns are session-local, are not persisted, and do not carry over to fresh requests or session/runtime replacement.

## Behavior

A finalized assistant error is marked for Pi's native retry only when all of these are true:

- configuration is valid and Pi's `retry.enabled` setting is on;
- `stopReason` is `error` and the error text is nonempty;
- `defaultRetry` is `true` or an active include substring matches;
- no exclude substring matches;
- Pi does not already classify the error as retryable and pi-retry has not already marked it;
- the error is not protected (including quota, usage-limit, budget, billing, or payment failures), a context overflow, a compact match, or excluded by Pi's exposed native policy.

Active `compact` matches are independent of retry configuration and never become ordinary retries or acquire ordinary retry cooldowns. Pi owns compaction and its bounded retry. Quota/billing protections, disabled retry, and Pi's native retry exclusions are not overridden by either waiting source.

Waiting selection is separate from classification: non-excluded, otherwise eligible native-retryable errors do not need another marker but can still use a configured interval or server hint in either mode. Pi retains its attempt limits and decides whether a retry occurs; the extension never sends a replacement request.

The extension has no independent retry loop, stall watchdog, command, or additional runtime dependency. Its only timer maintains a cancellable cooldown remainder. Configure provider/stream inactivity with Pi's `httpIdleTimeoutMs`; configure retry attempts and native backoff through Pi's `retry` settings.

`retry.enabled` detection is authoritative for normal Pi CLI sessions backed by `settings.json`. Pi's public extension API does not expose an embedded SDK host's injected in-memory retry policy; SDK hosts should load this extension only when their file-backed and injected policies agree.

## Development

```bash
npm ci
npm run check
```

The tests use pinned Pi development dependencies, isolated session/settings directories, and loopback HTTP fixtures. They do not require live provider credentials or a production gateway.

## License

MIT
