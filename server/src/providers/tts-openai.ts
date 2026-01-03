/**
 * OpenAI TTS Provider
 *
 * Cloud-based TTS, no self-hosting required.
 * More expensive than self-hosted alternatives but zero setup.
 *
 * Pricing: ~$15/1M characters
 */

import OpenAI from 'openai';
import type { TTSProvider, TTSConfig } from './types.js';

export class OpenAITTSProvider implements TTSProvider {
  readonly name = 'openai';
  private client: OpenAI | null = null;
  private voice: string = 'onyx';
  private model: string = 'tts-1';

  initialize(config: TTSConfig): void {
    if (!config.apiKey) {
      throw new Error('OpenAI API key required for TTS');
    }

    this.client = new OpenAI({ apiKey: config.apiKey });
    this.voice = config.voice || 'onyx';
    this.model = config.model || 'tts-1';

    console.error(`TTS provider: OpenAI (${this.model}, voice: ${this.voice})`);
  }

  async synthesize(text: string): Promise<Buffer> {
    if (!this.client) throw new Error('OpenAI TTS not initialized');

    const response = await this.client.audio.speech.create({
      model: this.model,
      voice: this.voice as 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer',
      input: text,
      response_format: 'pcm',
      speed: 1.0,
    });

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }
}
