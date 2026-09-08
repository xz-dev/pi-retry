# pi-retry

Minimal recovery hints for provider errors that Pi does not yet classify.

`pi-retry` does not implement retry or compaction loops. It normalizes known context-overflow errors for Pi's native compact-and-retry path and marks configured transient errors for Pi's native retry path.

## Install

```bash
pi install git:github.com/xz-dev/pi-retry
```

Restart Pi after installation.

## Configure

No configuration is needed: pi-retry ships with 10 retry rules and one context-compaction rule. See the [recovery specification](openspec/specs/error-recovery/spec.md) for the exact defaults and behavior.

To append rules, create `$PI_CODING_AGENT_DIR/pi-retry.json` (normally `~/.pi/agent/pi-retry.json`):

```json
{
  "include": ["custom transient error"],
  "compact": ["custom input overflow"]
}
```

All fields are optional:

- `include`: retry substrings to append to the built-in include list.
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

**Upgrading from replacement behavior:** add `clearDefaults: true` to an existing configuration if you want to keep only its rules. An empty `include` array no longer disables built-in retry rules on its own. No user configuration is rewritten automatically.

The original error remains visible. Compaction recovery requires Pi's `compaction.enabled` setting. Configuration is global only and is read when the extension loads; use `/reload` after changing it.

Invalid JSON, a read error, or an invalid recognized field disables both pi-retry rule lists instead of falling back to defaults or breaking Pi. Arrays must contain only strings; `clearDefaults` must be a boolean. Unknown properties are ignored.

## Behavior

A finalized assistant error is marked for Pi's native retry only when all of these are true:

- Pi's `retry.enabled` setting is on;
- `stopReason` is `error`;
- one active include substring matches;
- Pi does not already classify the error as retryable;
- the error is not a quota, usage-limit, budget, billing, or context-overflow failure.

Active `compact` matches are independent of retry configuration and never become ordinary retries. Pi owns compaction and its bounded retry.

The extension intentionally has no timer, stall watchdog, UI, command, or runtime dependency. Configure provider/stream inactivity with Pi's `httpIdleTimeoutMs`; configure retry attempts and backoff through Pi's native `retry` settings.

`retry.enabled` detection is authoritative for normal Pi CLI sessions backed by `settings.json`. Pi's public extension API does not expose an embedded SDK host's injected in-memory retry policy; SDK hosts should load this extension only when their file-backed and injected policies agree.

## Development

```bash
npm install
npm run check
```

## License

MIT
