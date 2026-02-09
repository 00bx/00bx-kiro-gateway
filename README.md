# 00bx-kiro-gateway

Use Claude models for free inside [OpenCode](https://opencode.ai) — powered by [Kiro CLI](https://kiro.dev) credentials.

No API keys. No localhost servers. No monthly bills. Just plug it in and go.

## How it works

Kiro is Amazon's free AI IDE. When you install it and sign in, it stores AWS credentials on your machine. This package reads those credentials and uses them to talk to Claude directly — so OpenCode can use Claude without you paying anything.

It's a drop-in [Vercel AI SDK](https://sdk.vercel.ai) provider. OpenCode loads it automatically from npm. You just add a few lines to your config file.

## Available models

| Model | Config ID | Notes |
|---|---|---|
| Claude Sonnet 4 | `claude-sonnet-4` | Best balance of speed and quality |
| Claude Sonnet 4.5 | `claude-sonnet-4-5` | Latest and smartest Sonnet |
| Claude Haiku 4.5 | `claude-haiku-4-5` | Fastest, least rate-limited |
| Claude Opus 4.5 | `claude-opus-4-5` | Most capable, slowest |

All models support streaming, tool use (file reads, writes, search, etc.), and multi-turn conversations.

## Setup

Takes about 2 minutes.

### Step 1 — Install Kiro CLI

**macOS:**
```bash
brew install --cask kiro
```

**Other platforms:** Download from [kiro.dev](https://kiro.dev).

Open Kiro once and sign in with your **AWS Builder ID** (it's free — create one at [profile.aws](https://profile.aws) if you don't have one). Once you're signed in, you can close Kiro. The credentials stay on your machine.

### Step 2 — Install OpenCode

If you don't have OpenCode yet:

```bash
curl -fsSL https://opencode.ai/install | bash
```

### Step 3 — Configure the provider

Open (or create) your OpenCode config file:

```bash
nano ~/.config/opencode/opencode.json
```

Paste this:

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

> **Already have an opencode.json?** Just add the `"kiro": { ... }` block inside your existing `"provider"` section. Don't overwrite your other providers.

### Step 4 — Use it

Launch OpenCode with a Kiro model:

```bash
opencode -m kiro/claude-sonnet-4
```

Or start OpenCode normally and switch models from the model picker — your Kiro models will show up there.

You can also run one-off commands:

```bash
opencode run -m kiro/claude-sonnet-4 "explain this codebase"
```

That's it. It handles everything else — token refresh, retries, streaming, tool calls.

## Tips

- **Start with `claude-sonnet-4`** — it's fast, smart, and has the most generous rate limits.
- **Getting rate-limited?** Switch to `claude-haiku-4-5`. It's the least restricted model.
- **Session expired?** Just open Kiro IDE again briefly. It refreshes your credentials automatically.
- **Works everywhere OpenCode works** — macOS, Linux. Anywhere you can install Kiro CLI.
- **No background processes** — this isn't a proxy server. It's a library that OpenCode loads directly.

## Troubleshooting

| Problem | Fix |
|---|---|
| `Kiro refresh token not found` | Open Kiro IDE and sign in. Credentials are stored after first sign-in. |
| Empty or no response | Try `claude-haiku-4-5` (least rate-limited). You may have hit a rate limit. |
| Token/auth errors | Reopen Kiro IDE to refresh your session, then try again. |
| OpenCode doesn't show Kiro models | Make sure the config is valid JSON. Check for trailing commas or typos. |
| Slow first response | First request takes a few extra seconds to refresh the auth token. Normal after that. |

## How it works (technical)

For those who care about the internals:

1. Reads Kiro CLI's stored refresh token from a local SQLite database
2. Exchanges it for a short-lived access token via Kiro's auth endpoint
3. Sends your prompt to AWS CodeWhisperer's streaming API
4. Parses the AWS binary event stream protocol and translates it to Vercel AI SDK V2 stream format
5. Handles tool calls, retries, token refresh, rate limiting, and stream timeouts automatically

Zero runtime dependencies. Works with Bun (which OpenCode uses internally) and Node.js.

## License

MIT — [00bx](https://github.com/00bx)
