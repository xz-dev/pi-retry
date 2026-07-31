# pi-retry

Minimal configurable retry hints for transient provider errors that Pi does not yet classify.

`pi-retry` does not implement a retry loop. It marks matching finalized provider errors for Pi's native retry path, so Pi remains responsible for retry count, exponential backoff, cancellation, and reporting.

## Install

```bash
pi install git:github.com/xz-dev/pi-retry
```

Restart Pi after installation.

## Configure

The default include matches this error without any configuration:

```text
Error: OpenAI API error (520): 520 status code (no body)
```

To replace the defaults, create `$PI_CODING_AGENT_DIR/pi-retry.json` (normally `~/.pi/agent/pi-retry.json`):

```json
{
  "include": [
    "OpenAI API error (520)",
    "custom transient error"
  ]
}
```

`include` is an array of case-insensitive literal substrings. Empty strings are ignored. The configuration is global only and is read when the extension loads; use `/reload` after changing it.

An invalid configuration disables custom classification instead of breaking Pi.

## Behavior

A finalized assistant error is marked for Pi's native retry only when all of these are true:

- Pi's `retry.enabled` setting is on;
- `stopReason` is `error`;
- one configured substring matches;
- Pi does not already classify the error as retryable;
- the error is not a quota, usage-limit, budget, billing, or context-overflow failure.

The extension intentionally has no timer, stall watchdog, UI, command, or runtime dependency. Configure provider/stream inactivity with Pi's `httpIdleTimeoutMs`; configure retry attempts and backoff through Pi's native `retry` settings.

## Development

```bash
npm install
npm run check
```

## License

MIT
