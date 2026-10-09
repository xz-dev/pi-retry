# pi-retry

Recovery hints and minimum waits for Pi provider errors.

`pi-retry` does not implement retry or compaction loops. It normalizes known context-overflow errors for Pi's native compact-and-retry path, marks configured transient errors for Pi's native retry path, and can supplement native backoff without adding two full delays.

## Install

```bash
pi install git:github.com/xz-dev/pi-retry
```

Restart Pi after installation.

## Configure

No configuration is needed: pi-retry ships with 13 retry rules and one context-compaction rule. See the [recovery specification](openspec/specs/error-recovery/spec.md) for the exact built-in defaults. Eligible errors can also use a server's visible JSON `retry_after` hint.

To append rules, create `$PI_CODING_AGENT_DIR/pi-retry.json` (normally `~/.pi/agent/pi-retry.json`):

```json
{
  "include": ["custom transient error"],
  "compact": ["custom input overflow"]
}
```

All fields are optional:

- `include`: strings or `{ "match": "...", "waitMs": 60000 }` rules to append to the built-in include list. Strings add classification only; objects also set a minimum wait in milliseconds.
- `compact`: overflow substrings to append to the built-in compact list.
- `clearDefaults`: boolean, default `false`. Set `true` to clear **both** built-in lists before adding user rules.

Strings are trimmed and matched as case-insensitive literal substrings, not regular expressions; blank strings are ignored. `{}`, omitted arrays, and empty arrays retain the defaults unless `clearDefaults` is `true`. Compact-only configuration is valid.

To replace the defaults with only your own rules:

```json
{
  "clearDefaults": true,
  "include": ["custom transient error"],
  "compact": []
}
```

To disable all pi-retry classification without changing Pi's native recovery settings:

```json
{
  "clearDefaults": true
}
```

This clears additional classification, not server-provided waiting hints for errors Pi already recognizes. Disable the extension to remove all of its behavior.

**Upgrading from replacement behavior:** add `clearDefaults: true` to an existing configuration if you want to keep only its rules. An empty `include` array no longer disables built-in retry rules on its own. No user configuration is rewritten automatically. Before rolling back to a version without timed rules, replace object entries with their match strings; older versions reject object entries.

The original error remains visible. Compaction recovery requires Pi's `compaction.enabled` setting. Configuration is global only and is read when the extension loads; use `/reload` after changing it.

Invalid JSON, a read error, or an invalid recognized field disables both pi-retry rule lists **and all extension-added waiting**, instead of falling back to defaults or breaking Pi. `compact` must contain only strings. Each include object requires a string `match` and a non-negative safe-integer `waitMs`; zero is valid. Match strings are trimmed and blank matches are ignored. `clearDefaults` must be a boolean. Unknown properties are ignored.

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

A matching `waitMs: 0` overrides a server hint and adds no cooldown. Plain strings and built-in rules do not override server hints. A hint can apply even when no include rule matches, provided Pi already considers the error retryable. A hint alone never makes an error retryable.

The interval starts when the error is finalized. Pi's own backoff counts toward it: if the selected interval is 60 seconds and Pi already waited 2 seconds, pi-retry waits only the remaining approximately 58 seconds. If Pi already waited 90 seconds, it adds no wait. It does not shorten native backoff or add the complete configured interval after it.

Server hints must be finite, non-negative JSON numbers safely convertible to milliseconds. Fractional seconds are rounded up to whole milliseconds. Numeric strings, nested hints, malformed JSON, and prose such as `retry_after: 60` are not parsed as hints; HTTP `Retry-After` headers are not read.

**Body visibility matters:** some provider/SDK paths discard the response body and report `status code (no body)`. The extension cannot recover a hint it never receives. In that case, an explicit matching user rule still works; without one, native timing remains unchanged. Tests cover both a top-level HTTP error body omitted by the pinned SDK and a wrapped error body that remains visible. This is not a claim that every gateway exposes its JSON unchanged.

During actual supplementary waiting, interactive sessions show a transient cooldown status. Escape cancels the active retry. Waiting also works without a terminal UI. Cooldowns are session-local, are not persisted, and do not carry over to fresh requests or session/runtime replacement.

## Behavior

A finalized assistant error is marked for Pi's native retry only when all of these are true:

- Pi's `retry.enabled` setting is on;
- `stopReason` is `error`;
- one active include substring matches;
- Pi does not already classify the error as retryable;
- the error is not a quota, usage-limit, budget, billing, or context-overflow failure.

Active `compact` matches are independent of retry configuration and never become ordinary retries or acquire ordinary retry cooldowns. Pi owns compaction and its bounded retry. Quota/billing protections, disabled retry, and Pi's native retry exclusions are not overridden by either waiting source.

Waiting selection is separate from classification: already-native-retryable errors do not need another marker but can still use a configured interval or server hint. Pi retains its attempt limits and decides whether a retry occurs; the extension never sends a replacement request.

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
