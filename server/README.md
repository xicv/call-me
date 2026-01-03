# Hey Boss Server

This is the SaaS server that powers Hey Boss. Run this on your infrastructure to provide phone call services to users.

## Architecture

```
Users (Claude Code)                    Your Server
┌─────────────────┐                   ┌──────────────────────────┐
│ Claude Code     │                   │  Hey Boss Server         │
│    │            │    HTTPS          │                          │
│    ▼            │ ───────────────►  │  Auth (API Key)          │
│ Hey Boss Plugin │                   │           │              │
│                 │                   │           ▼              │
└─────────────────┘                   │  MCP Server + Billing    │
                                      │           │              │
                                      │     ┌─────┴─────┐        │
                                      │     ▼           ▼        │
                                      │  Twilio      OpenAI      │
                                      │ (your keys) (your keys)  │
                                      └──────────────────────────┘
```

## Setup

### 1. Install Dependencies

```bash
cd server
bun install
bun run build
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env`:

```bash
# Your Twilio credentials
TWILIO_ACCOUNT_SID=ACxxxxx
TWILIO_AUTH_TOKEN=your_token
TWILIO_PHONE_NUMBER=+1234567890

# Your OpenAI key
OPENAI_API_KEY=sk-xxxxx

# Public URL where this server is hosted
PUBLIC_URL=https://api.heyboss.io
PORT=3000

# Pricing (in cents per minute)
TWILIO_COST_PER_MIN=2
WHISPER_COST_PER_MIN=1
TTS_COST_PER_MIN=5
PRICE_MULTIPLIER=2.0  # 2x = 100% markup

# User API keys (format: API_KEY_<key>=<phone_number>)
API_KEY_sk_user1_abc123=+15551234567
API_KEY_sk_user2_def456=+15559876543
```

### 3. Run the Server

```bash
# Development
bun run dev

# Production
bun run start
```

## Pricing Configuration

The server charges users based on this formula:

```
Price per minute = (Twilio + Whisper + TTS costs) × PRICE_MULTIPLIER
```

With default settings:
- Base cost: 2 + 1 + 5 = 8¢/min
- Multiplier: 2.0×
- **User price: 16¢/min**

Adjust `PRICE_MULTIPLIER` to change your margin:
- `1.5` = 50% markup (12¢/min)
- `2.0` = 100% markup (16¢/min)
- `3.0` = 200% markup (24¢/min)

## Managing Users

Add users by setting environment variables:

```bash
# Format: API_KEY_<api_key>=<phone_number>
API_KEY_sk_john_abc123=+15551234567
API_KEY_sk_jane_def456=+15559876543
```

For production, you'd want to:
1. Store users in a database
2. Build a signup flow at heyboss.io
3. Implement proper billing with Stripe
4. Add usage dashboards

## Deployment

### With Docker

```dockerfile
FROM oven/bun:1
WORKDIR /app
COPY server/package.json server/bun.lock ./
RUN bun install --production
COPY server/dist ./dist
CMD ["bun", "run", "start"]
```

### With systemd

```ini
[Unit]
Description=Hey Boss Server
After=network.target

[Service]
Type=simple
User=heyboss
WorkingDirectory=/opt/hey-boss/server
ExecStart=/usr/bin/node dist/index.js
Restart=on-failure
EnvironmentFile=/opt/hey-boss/server/.env

[Install]
WantedBy=multi-user.target
```

### Requirements

- Node.js 18+ or Bun
- Public HTTPS URL (for Twilio webhooks)
- Twilio account with voice-enabled phone number
- OpenAI API key

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `POST /mcp` | MCP protocol endpoint (requires Bearer token) |
| `GET /health` | Health check |
| `POST /twiml` | Twilio webhook (internal) |
| `WS /media-stream` | Twilio media stream (internal) |

## Monitoring

The server logs:
- Call initiation and completion
- Duration and cost per call
- User usage totals

Example output:
```
Call call-1-1704312345 ended: 120s, charged 32¢ to user john
```

## License

MIT
