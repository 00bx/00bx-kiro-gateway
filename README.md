# 00bx-kiro-gateway

Free Claude models in [OpenCode](https://opencode.ai) via [Kiro CLI](https://kiro.dev).

## Models

| Model | ID |
|---|---|
| Claude Sonnet 4.5 | `claude-sonnet-4-5` |
| Claude Sonnet 4 | `claude-sonnet-4` |
| Claude Haiku 4.5 | `claude-haiku-4-5` |
| Claude Opus 4.5 | `claude-opus-4-5` |

## Setup

### 1. Install Kiro CLI

```bash
brew install --cask kiro
```

Or download from [kiro.dev](https://kiro.dev). Open it once and sign in with your AWS Builder ID (free). You can close it after.

### 2. Add the provider to your OpenCode config

`~/.config/opencode/opencode.json`

```json
{
  "provider": {
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
  }
}
```

### 3. Done

Open OpenCode, pick a Kiro model, start coding.

```bash
opencode -m kiro/claude-sonnet-4
```

## Troubleshooting

| Error | Fix |
|---|---|
| `Kiro refresh token not found` | Open Kiro IDE and sign in first |
| Empty responses | Switch to `claude-haiku-4-5` (least rate-limited) |
| Token errors | Reopen Kiro IDE to refresh your session |

## License

MIT — [00bx](https://github.com/00bx)
