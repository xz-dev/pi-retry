# pi-retry

Minimal recovery hints for provider errors that Pi does not yet classify.

`pi-retry` does not implement retry or compaction loops. It normalizes known context-overflow errors for Pi's native compact-and-retry path and marks configured transient errors for Pi's native retry path.

## Install

```bash
pi install git:github.com/xz-dev/pi-retry
```

Restart Pi after installation.

## Configure

The default retry include matches this error without any configuration:

```text
Error: OpenAI API error (520): 520 status code (no body)
```

To replace the defaults, create `$PI_CODING_AGENT_DIR/pi-retry.json` (normally `~/.pi/agent/pi-retry.json`):

```json
{
  "include": [
    "OpenAI API error (520)",
    "custom transient error"
  ],
  "compact": [
    "Reduce the prompt or route to a model with a larger input limit"
  ]
}
```

Both arrays contain case-insensitive literal substrings; empty strings are ignored:

- `include` replaces the default retry matches.
- `compact` defaults to empty and normalizes matching errors for Pi's native context compaction and one automatic retry.

The original error remains visible. Compaction recovery requires Pi's `compaction.enabled` setting. Configuration is global only and is read when the extension loads; use `/reload` after changing it.

An invalid configuration disables custom classification instead of breaking Pi.

## Behavior

A finalized assistant error is marked for Pi's native retry only when all of these are true:

- Pi's `retry.enabled` setting is on;
- `stopReason` is `error`;
- one configured substring matches;
- Pi does not already classify the error as retryable;
- the error is not a quota, usage-limit, budget, billing, or context-overflow failure.

Configured `compact` matches are independent of retry configuration and never become ordinary retries. Pi owns compaction and its bounded retry.

The extension intentionally has no timer, stall watchdog, UI, command, or runtime dependency. Configure provider/stream inactivity with Pi's `httpIdleTimeoutMs`; configure retry attempts and backoff through Pi's native `retry` settings.

`retry.enabled` detection is authoritative for normal Pi CLI sessions backed by `settings.json`. Pi's public extension API does not expose an embedded SDK host's injected in-memory retry policy; SDK hosts should load this extension only when their file-backed and injected policies agree.

## Development

```bash
npm install
npm run check
```

## License

MIT
