# 00bx-kiro-gateway

Use Claude models for free inside [OpenCode](https://opencode.ai).

This is an AI SDK provider that connects OpenCode to Claude through [Kiro CLI](https://kiro.dev) credentials. No API keys, no proxies, no servers running in the background. You just add it to your config and it works.

## What you get

- Claude Sonnet 4.5
- Claude Sonnet 4
- Claude Haiku 4.5
- Claude Opus 4.5

All free. Kiro gives you access to Claude through AWS CodeWhisperer, and this package plugs that directly into OpenCode.

## Quick start

**1. Get Kiro CLI**

Download from [kiro.dev](https://kiro.dev) or `brew install --cask kiro` on mac. Open it once, sign in with your AWS Builder ID (it's free), then you can close it. The login credentials stay on your machine.

**2. Add this to your `~/.config/opencode/opencode.json`**

Drop this into your `provider` section:

```json
"kiro": {
  "npm": "00bx-kiro-gateway",
  "name": "Kiro Gateway",
  "models": {
    "claude-sonnet-4-5": {
      "name": "Claude Sonnet 4.5",
      "limit": { "context": 200000, "output": 8192 }
    },
    "claude-sonnet-4": {
      "name": "Claude Sonnet 4",
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
```

**3. Open OpenCode, pick a Kiro model, and start coding.**

That's it. No env vars, no tokens to paste, nothing else to set up.

## What's happening under the hood

When you pick a Kiro model in OpenCode, this package:

1. Reads your Kiro login from the local database (the one Kiro CLI created when you signed in)
2. Gets a fresh access token from AWS
3. Sends your messages to Claude through the CodeWhisperer API
4. Streams the response back

It handles token refresh, retries, rate limits, and all the weird edge cases automatically. You don't have to think about any of it.

## If something goes wrong

**"Kiro refresh token not found"** — You need to open Kiro IDE and sign in first. It stores credentials locally and this package reads from there.

**Empty responses** — Some models hit free tier limits. Switch to `claude-haiku-4-5`, it's the most generous.

**Token errors** — Your Kiro session might have expired. Just open Kiro IDE again to refresh it.

## License

MIT — by [00bx](https://github.com/00bx)
