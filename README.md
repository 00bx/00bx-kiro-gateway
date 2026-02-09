# 00bx-kiro-gateway

Free Claude models in [OpenCode](https://opencode.ai) via [Kiro CLI](https://kiro.dev).

No API keys. No payments. No localhost servers. Just install Kiro CLI, log in, and use Claude for free.

## Supported Models

| Model | ID |
|---|---|
| Claude Opus 4.5 | `claude-opus-4-5` |
| Claude Sonnet 4.5 | `claude-sonnet-4-5` |
| Claude Sonnet 4 | `claude-sonnet-4` |
| Claude Haiku 4.5 | `claude-haiku-4-5` |

## Setup (2 minutes)

### Step 1: Install Kiro CLI

```bash
# macOS
brew install --cask kiro

# or download from https://kiro.dev
```

### Step 2: Log into Kiro

Open Kiro IDE once, sign in with your AWS Builder ID (free). Close it after login. That's it — the credentials are saved locally.

### Step 3: Add to OpenCode

Open `~/.config/opencode/opencode.json` and add the `kiro` provider:

```json
{
  "provider": {
    "kiro": {
      "npm": "00bx-kiro-gateway",
      "name": "Kiro Gateway",
      "models": {
        "claude-sonnet-4-5": {
          "name": "Claude Sonnet 4.5 (Kiro)",
          "limit": { "context": 200000, "output": 8192 }
        },
        "claude-sonnet-4": {
          "name": "Claude Sonnet 4 (Kiro)",
          "limit": { "context": 200000, "output": 8192 }
        },
        "claude-haiku-4-5": {
          "name": "Claude Haiku 4.5 (Kiro)",
          "limit": { "context": 200000, "output": 8192 }
        },
        "claude-opus-4-5": {
          "name": "Claude Opus 4.5 (Kiro)",
          "limit": { "context": 200000, "output": 8192 }
        }
      }
    }
  }
}
```

### Step 4: Use it

Launch OpenCode, switch to any Kiro model, start coding.

```bash
opencode
```

## How It Works

```
OpenCode → 00bx-kiro-gateway → Kiro Auth → AWS CodeWhisperer API → Claude
```

1. Reads your Kiro CLI credentials from the local SQLite database
2. Refreshes the access token automatically
3. Sends requests to AWS CodeWhisperer's Claude endpoint
4. Streams responses back to OpenCode via the AI SDK protocol

No proxy server. No background process. It's a direct npm provider that OpenCode loads natively.

## Features

- **Zero config** — auto-detects Kiro CLI credentials
- **Zero dependencies** — no native addons, instant install
- **Auto token refresh** — handles expiry, 403 retries, rate limits
- **Streaming** — full streaming support with AWS binary event stream parsing
- **Tool calling** — complete tool/function calling support
- **Context compaction** — handles OpenCode's conversation compaction gracefully
- **Cross-platform** — macOS, Linux, Windows

## Troubleshooting

### "Kiro refresh token not found"

Kiro CLI isn't installed or you haven't logged in. Open Kiro IDE, sign in, close it.

### Model returns empty response

Some models may have usage limits on the free tier. Try switching to `claude-haiku-4-5` which has the most generous limits.

### Token refresh fails

Your Kiro session may have expired. Open Kiro IDE again to refresh the session, then retry.

## Requirements

- [Kiro CLI](https://kiro.dev) — installed and logged in
- [OpenCode](https://opencode.ai) — v0.1.0 or later

## License

MIT

## Credits

Made by [00bx](https://github.com/00bx)
