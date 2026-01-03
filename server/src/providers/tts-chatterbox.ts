/**
 * Chatterbox TTS Provider (Resemble AI)
 *
 * Self-hosted, high-quality neural TTS.
 * - MIT licensed, free to use
 * - Beats ElevenLabs in blind tests (63.8% preference)
 * - Turbo variant: 350M params, optimized for low-latency voice agents
 *
 * Requires running Chatterbox server:
 *   pip install chatterbox-tts
 *   python -m chatterbox.server --host 0.0.0.0 --port 5100
 *
 * Or use Docker:
 *   docker run -p 5100:5100 resembleai/chatterbox
 */

import type { TTSProvider, TTSConfig } from './types.js';

export class ChatterboxTTSProvider implements TTSProvider {
  readonly name = 'chatterbox';
  private apiUrl: string = 'http://localhost:5100';
  private voice: string = 'default';

  initialize(config: TTSConfig): void {
    this.apiUrl = config.apiUrl || 'http://localhost:5100';
    this.voice = config.voice || 'default';

    console.error(`TTS provider: Chatterbox (${this.apiUrl})`);
  }

  async synthesize(text: string): Promise<Buffer> {
    try {
      const response = await fetch(`${this.apiUrl}/v1/audio/speech`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          input: text,
          voice: this.voice,
          response_format: 'pcm',  // Raw PCM for Twilio/Telnyx
          speed: 1.0,
        }),
      });

      if (!response.ok) {
        throw new Error(`Chatterbox request failed: ${response.status}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } catch (error) {
      console.error('Chatterbox TTS error:', error);
      throw error;
    }
  }
}
