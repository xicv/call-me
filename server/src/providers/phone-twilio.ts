/**
 * Twilio Phone Provider
 *
 * Traditional provider - works well but more expensive than alternatives.
 * Use as fallback or if already invested in Twilio ecosystem.
 */

import Twilio from 'twilio';
import type { PhoneProvider, PhoneConfig } from './types.js';

export class TwilioPhoneProvider implements PhoneProvider {
  readonly name = 'twilio';
  private client: Twilio.Twilio | null = null;

  initialize(config: PhoneConfig): void {
    this.client = Twilio(config.accountSid, config.authToken);
    console.error(`Phone provider: Twilio`);
  }

  async initiateCall(to: string, from: string, webhookUrl: string): Promise<string> {
    if (!this.client) throw new Error('Twilio not initialized');

    const call = await this.client.calls.create({
      url: webhookUrl,
      to,
      from,
      timeout: 60,
    });

    return call.sid;
  }

  getStreamConnectXml(streamUrl: string): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${streamUrl}" />
  </Connect>
</Response>`;
  }
}
