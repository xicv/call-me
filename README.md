# Hey Boss

**Claude Code Plugin** - Claude calls you on the phone when it needs your input or wants to report progress.

## Install

```
/plugin marketplace add ZeframLou/hey-boss
/plugin install hey-boss@hey-boss
```

Set your API key:

```bash
export HEY_BOSS_API_KEY=sk_your_api_key_here
```

Restart Claude Code. Done!

## Get an API Key

Sign up at [heyboss.io](https://heyboss.io) to get your API key. You'll provide your phone number during signup - that's where Claude will call you.

## Pricing

**$0.16/minute** - billed per minute of call time.

No subscriptions, no minimums. Pay only for what you use.

## How It Works

```
Claude Code                         Hey Boss Cloud
    │                                    │
    │  "I finished the feature..."       │
    ▼                                    ▼
Plugin ──────────────────────────► API Server
  (your API key)                         │
                                         ▼
                                   Your Phone rings
                                   You speak
                                   Text returns to Claude
```

Claude controls the conversation. The service just handles the phone call infrastructure.

## Tools

### `initiate_call`
Start a phone call.

```typescript
const { callId, response } = await initiate_call({
  message: "Hey! I finished the auth system. What should I work on next?"
});
```

### `continue_call`
Continue with follow-up questions.

```typescript
const response = await continue_call({
  call_id: callId,
  message: "Got it. Should I add rate limiting too?"
});
```

### `end_call`
End the call.

```typescript
await end_call({
  call_id: callId,
  message: "Perfect, I'll get started. Talk soon!"
});
```

## When Claude Calls You

- **Task completed** - Status report, asking what's next
- **Decision needed** - Architecture, technology choices
- **Blocked** - Needs clarification to continue

Claude won't call for simple yes/no questions.

## Troubleshooting

### Claude doesn't use the tool
1. Check `HEY_BOSS_API_KEY` is set in your environment
2. Restart Claude Code after installing the plugin
3. Try explicitly: "Call me to discuss the next steps"

### Call doesn't connect
1. Verify your phone number is correct in your account
2. Check your account has credits

## Self-Hosting

Want to run your own Hey Boss server? See [server/README.md](server/README.md) for deployment instructions.

## License

MIT
