/**
 * Telnyx Phone Provider
 *
 * Cost-effective alternative to Twilio (30-70% cheaper).
 * Uses TeXML which is TwiML-compatible.
 *
 * Pricing (as of 2025):
 * - Outbound: $0.007/min (vs Twilio $0.014/min)
 * - Inbound: $0.0055/min (vs Twilio $0.0085/min)
 */

import type { PhoneProvider, PhoneConfig } from './types.js';

interface TelnyxCallResponse {
  data: {
    id: string;
    call_control_id: string;
    call_leg_id: string;
    record_type: string;
  };
}

export class TelnyxPhoneProvider implements PhoneProvider {
  readonly name = 'telnyx';
  private apiKey: string | null = null;
  private connectionId: string | null = null;

  initialize(config: PhoneConfig): void {
    // Telnyx uses API key (passed as authToken) and Connection ID (passed as accountSid)
    this.apiKey = config.authToken;
    this.connectionId = config.accountSid;
    console.error(`Phone provider: Telnyx`);
  }

  async initiateCall(to: string, from: string, webhookUrl: string): Promise<string> {
    if (!this.apiKey || !this.connectionId) {
      throw new Error('Telnyx not initialized');
    }

    const response = await fetch('https://api.telnyx.com/v2/calls', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        connection_id: this.connectionId,
        to,
        from,
        webhook_url: webhookUrl,
        webhook_url_method: 'POST',
        answering_machine_detection: 'detect',
        timeout_secs: 60,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Telnyx call failed: ${response.status} ${error}`);
    }

    const data = await response.json() as TelnyxCallResponse;
    return data.data.call_control_id;
  }

  getStreamConnectXml(streamUrl: string): string {
    // TeXML is TwiML-compatible
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${streamUrl}" />
  </Connect>
</Response>`;
  }
}
