# 00bx-kiro-gateway

![00bx Kiro Gateway](poster.jpg)

[AI SDK](https://sdk.vercel.ai) provider that lets [OpenCode](https://opencode.ai) use Claude models through [Kiro CLI](https://kiro.dev)'s free-tier credits.

## How it works

[Kiro](https://kiro.dev) is Amazon's AI IDE. It comes with free credits for Claude models. When you sign in to Kiro, it stores auth tokens locally. This package reads those tokens and routes OpenCode requests through the same backend — so you can use your Kiro free-tier credits directly inside OpenCode.

## Models

| Model | Config ID | Status |
|---|---|---|
| Claude Sonnet 4 | `claude-sonnet-4` | Working |
| Claude Sonnet 4.5 | `claude-sonnet-4-5` | Working |
| Claude Haiku 4.5 | `claude-haiku-4-5` | Working |
| Claude Opus 4.5 | `claude-opus-4-5` | Currently disabled by Kiro (capacity limits) |

> **Opus 4.5 note:** Kiro's servers have disabled Opus 4.5 due to capacity constraints on their end. The config is included so it works automatically whenever Kiro re-enables it — no update needed on your side.

All working models support streaming, tool use, and multi-turn conversations.

## Setup

### 1. Install and sign in to Kiro

```bash
brew install --cask kiro
```

Or download from [kiro.dev](https://kiro.dev).

Open Kiro, sign in with your **AWS Builder ID** (create one at [profile.aws](https://profile.aws.amazon.com) if needed), then you can close it. The credentials stay on your machine.

### 2. Install OpenCode

```bash
curl -fsSL https://opencode.ai/install | bash
```

### 3. Add the provider config

Edit `~/.config/opencode/opencode.json`:

```json
{
  "provider": {
    "kiro": {
      "npm": "00bx-kiro-gateway",
      "name": "Kiro Gateway",
      "models": {
        "claude-sonnet-4": {
          "name": "Claude Sonnet 4",
          "limit": { "context": 200000, "output": 8192 }
        },
        "claude-sonnet-4-5": {
          "name": "Claude Sonnet 4.5",
          "limit": { "context": 200000, "output": 8192 }
        },
        "claude-haiku-4-5": {
          "name": "Claude Haiku 4.5",
          "limit": { "context": 200000, "output": 8192 }
        },
        "claude-opus-4-5": {
          "name": "Claude Opus 4.5",
          "limit": { "context": 200000, "output": 8192 }
        }
      }
    }
  }
}
```

If you already have other providers configured, add the `"kiro"` block inside your existing `"provider"` object.

### 4. Run

```bash
# Interactive
opencode -m kiro/claude-sonnet-4

# Single command
opencode run -m kiro/claude-sonnet-4 "explain this codebase"
```

## Multiple accounts

If you have more than one AWS Builder ID, you can switch between them in Kiro IDE at any time. The gateway detects the account change automatically on the next request — it re-reads Kiro's local database before every API call. When it sees a different refresh token, it drops the old session and starts using the new account's credentials.

This means you can rotate between accounts to use each account's free-tier credits without restarting OpenCode.

## Troubleshooting

| Problem | Fix |
|---|---|
| `Kiro refresh token not found` | Open Kiro IDE and sign in. |
| Empty or no response | You may have hit a rate limit. Try `claude-haiku-4-5` — it has the highest limits. |
| Token/auth errors | Reopen Kiro IDE to refresh your session. |
| Opus 4.5 not responding | Kiro has it disabled for now due to capacity. Use Sonnet 4 or 4.5 instead. |
| OpenCode doesn't show Kiro models | Check your `opencode.json` for valid JSON (no trailing commas). |

## Technical details

1. Reads Kiro CLI's refresh token from its local SQLite database (`bun:sqlite` → `better-sqlite3` → `sqlite3` CLI fallback)
2. Exchanges it for a short-lived access token via Kiro's auth endpoint
3. Sends prompts to the AWS CodeWhisperer streaming API
4. Parses the AWS binary event stream protocol into AI SDK V2 stream format
5. Handles token refresh, 403 retry, 429/5xx backoff, idle stream timeouts, and tool-call accumulation

Zero runtime dependencies. Works with Bun and Node.js.

## License

MIT — [00bx](https://github.com/00bx)
