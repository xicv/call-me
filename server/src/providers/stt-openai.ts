/**
 * OpenAI Speech-to-Text Provider
 *
 * Supports multiple models:
 * - whisper-1: Standard model, $0.006/min
 * - gpt-4o-mini-transcribe: 50% cheaper at $0.003/min, same quality
 * - gpt-4o-transcribe: Premium with speaker diarization
 */

import OpenAI from 'openai';
import type { STTProvider, STTConfig } from './types.js';

export class OpenAISTTProvider implements STTProvider {
  readonly name = 'openai';
  private client: OpenAI | null = null;
  private model: string = 'gpt-4o-mini-transcribe'; // Default to cheaper model

  initialize(config: STTConfig): void {
    if (!config.apiKey) {
      throw new Error('OpenAI API key required for STT');
    }

    this.client = new OpenAI({ apiKey: config.apiKey });
    this.model = config.model || 'gpt-4o-mini-transcribe';

    console.error(`STT provider: OpenAI (${this.model})`);
  }

  async transcribe(audio: Buffer): Promise<string> {
    if (!this.client) throw new Error('OpenAI STT not initialized');

    if (audio.length === 0) return '';

    try {
      const file = new File([audio], 'audio.wav', { type: 'audio/wav' });

      const transcription = await this.client.audio.transcriptions.create({
        file,
        model: this.model,
      });

      return transcription.text;
    } catch (error) {
      console.error('OpenAI transcription error:', error);
      return '[transcription failed]';
    }
  }
}
