# CallMe Server

The backend server for CallMe. Supports two modes:

1. **Self-host mode**: Single user, no payments or database needed
2. **SaaS mode**: Multi-user with Stripe subscriptions and web registration

## Quick Start (Self-Host)

For personal use, just set `SELF_HOST_PHONE`:

```bash
cd server
bun install

# Phone provider (Telnyx is default, ~50% cheaper than Twilio)
export PHONE_PROVIDER=telnyx
export PHONE_ACCOUNT_SID=xxxxx       # Telnyx Connection ID
export PHONE_AUTH_TOKEN=xxxxx        # Telnyx API Key
export PHONE_NUMBER=+1234567890

# Or use Twilio
# export PHONE_PROVIDER=twilio
# export PHONE_ACCOUNT_SID=ACxxxxx
# export PHONE_AUTH_TOKEN=xxxxx

# STT & TTS
export OPENAI_API_KEY=sk-xxxxx
export TTS_PROVIDER=chatterbox       # Free self-hosted TTS
export CHATTERBOX_URL=http://localhost:5100

export PUBLIC_URL=https://your-server.com
export SELF_HOST_PHONE=+1234567890   # Your phone

# Start Chatterbox TTS (optional but recommended)
docker run -d -p 5100:5100 resemble-ai/chatterbox

bun run dev
```

No Stripe, no database, no user management needed.

## SaaS Mode

For running a paid service with multiple users:

### 1. Setup

```bash
cd server
bun install
cp .env.example .env
```

### 2. Configure

Edit `.env`:

```bash
# Phone provider
PHONE_PROVIDER=telnyx              # or 'twilio'
PHONE_ACCOUNT_SID=xxxxx
PHONE_AUTH_TOKEN=xxxxx
PHONE_NUMBER=+1234567890

# STT & TTS
OPENAI_API_KEY=sk-xxxxx
TTS_PROVIDER=chatterbox            # or 'openai'
CHATTERBOX_URL=http://localhost:5100

PUBLIC_URL=https://api.callme.dev

# Stripe Subscription
STRIPE_SECRET_KEY=sk_live_xxxxx
STRIPE_WEBHOOK_SECRET=whsec_xxxxx
STRIPE_PRICE_ID=price_xxxxx

# Plan: $20/month, 60 minutes
MONTHLY_PRICE_CENTS=2000
MONTHLY_MINUTES=60
```

### 3. Create Stripe Subscription Product

In Stripe Dashboard:
1. Products → Create product
2. Name: "CallMe Subscription"
3. Add a recurring price: $20/month
4. Copy the Price ID (starts with `price_`)

### 4. Stripe Webhook

In Stripe Dashboard → Webhooks:
- URL: `https://api.callme.dev/webhook`
- Events:
  - `checkout.session.completed` (for credit purchases)
  - `customer.subscription.created`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `invoice.paid`

### 5. Run

```bash
bun run dev   # Development
bun run start # Production
```

## User Flow

1. User visits `https://api.callme.dev`
2. Signs up with email + phone number
3. Gets API key on dashboard
4. Subscribes via Stripe ($20/month)
5. Gets 60 minutes per month
6. Uses API key with plugin

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  CallMe Server                                              │
│                                                             │
│  Web Pages          MCP Server         Phone Provider       │
│  • /signup          • /mcp             • /twiml             │
│  • /dashboard       • Auth             • /media-stream      │
│  • /login           • Tools                                 │
│                          │                                  │
│                          ▼                                  │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ SQLite (users, subscriptions) + Stripe (billing)    │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## Providers

The server uses a provider abstraction for phone, speech-to-text, and text-to-speech services.

### Phone Providers

| Provider | Cost | Notes |
|----------|------|-------|
| **Telnyx** (default) | ~$0.005/min | 50% cheaper than Twilio, TeXML compatible |
| Twilio | ~$0.01/min | Industry standard, well-documented |

### STT Providers

| Provider | Model | Cost | Notes |
|----------|-------|------|-------|
| **OpenAI** | gpt-4o-mini-transcribe (default) | $0.003/min | 50% cheaper, faster |
| OpenAI | whisper-1 | $0.006/min | Original Whisper model |

### TTS Providers

| Provider | Cost | Notes |
|----------|------|-------|
| **Chatterbox** (default) | Free | Self-hosted, MIT licensed, high quality |
| OpenAI | $15/1M chars | Cloud-based, no self-hosting needed |

### Running Chatterbox

Chatterbox is a free, self-hosted TTS that sounds better than most paid alternatives:

```bash
# Docker (recommended)
docker run -d -p 5100:5100 resemble-ai/chatterbox

# Or with GPU
docker run -d --gpus all -p 5100:5100 resemble-ai/chatterbox
```

If Chatterbox is unavailable, set `TTS_PROVIDER=openai` to use OpenAI TTS as fallback.

## Subscription & Credits

**Subscription:**
- $20/month includes 60 minutes
- Minutes reset automatically when `invoice.paid` webhook fires
- Cancelled subscriptions remain active until period end

**Additional Credits:**
- $0.50 per minute (configurable via `CREDIT_PRICE_PER_MINUTE`)
- Used after subscription minutes are exhausted
- Credits never expire
- Purchase via dashboard in packages of 30, 60, or 120 minutes

## Endpoints

| Endpoint | Auth | Description |
|----------|------|-------------|
| `GET /` | No | Home page |
| `GET /signup` | No | Registration |
| `GET /dashboard` | Session | User dashboard |
| `POST /mcp` | API Key | MCP protocol |
| `POST /webhook` | Stripe | Payment webhook |
| `GET /health` | No | Health check |

## Environment Variables

### Phone Provider

| Variable | Default | Description |
|----------|---------|-------------|
| `PHONE_PROVIDER` | `telnyx` | Phone provider: `telnyx` or `twilio` |
| `PHONE_ACCOUNT_SID` | - | Connection ID (Telnyx) or Account SID (Twilio) |
| `PHONE_AUTH_TOKEN` | - | API Key (Telnyx) or Auth Token (Twilio) |
| `PHONE_NUMBER` | - | Your phone number for outbound calls |

Legacy Twilio vars also work: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`

### STT/TTS Providers

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENAI_API_KEY` | - | Required for STT (and OpenAI TTS) |
| `STT_MODEL` | `gpt-4o-mini-transcribe` | STT model: `gpt-4o-mini-transcribe` or `whisper-1` |
| `TTS_PROVIDER` | `chatterbox` | TTS provider: `chatterbox` or `openai` |
| `CHATTERBOX_URL` | `http://localhost:5100` | Chatterbox server URL |
| `TTS_VOICE` | `onyx` | Voice: alloy, echo, fable, onyx, nova, shimmer |

### Server

| Variable | Default | Description |
|----------|---------|-------------|
| `PUBLIC_URL` | - | Server URL (HTTPS required) |
| `PORT` | `3333` | Server port |

### Self-Host Mode

| Variable | Default | Description |
|----------|---------|-------------|
| `SELF_HOST_PHONE` | - | Your phone (enables self-host mode) |
| `SELF_HOST_API_KEY` | `self-host` | Optional custom API key |

### SaaS Mode

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_PATH` | `./callme.db` | SQLite database path |
| `STRIPE_SECRET_KEY` | - | Stripe secret key |
| `STRIPE_WEBHOOK_SECRET` | - | Stripe webhook secret |
| `STRIPE_PRICE_ID` | - | Subscription price ID |
| `MONTHLY_PRICE_CENTS` | `2000` | Subscription price ($20) |
| `MONTHLY_MINUTES` | `60` | Minutes per month |
| `CREDIT_PRICE_PER_MINUTE` | `50` | Credit price ($0.50/min) |

## Deployment

### Docker

```dockerfile
FROM oven/bun:1
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --production
COPY dist ./dist
EXPOSE 3333
CMD ["bun", "run", "start"]
```

### systemd

```ini
[Unit]
Description=CallMe
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/callme/server
ExecStart=/usr/bin/node dist/index.js
EnvironmentFile=/opt/callme/server/.env
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

## License

MIT
