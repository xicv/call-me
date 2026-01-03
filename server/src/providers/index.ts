/**
 * Provider Factory
 *
 * Creates and configures providers based on environment variables.
 *
 * Environment variables:
 *   PHONE_PROVIDER: 'telnyx' | 'twilio' (default: 'telnyx')
 *   STT_PROVIDER: 'openai' (default: 'openai')
 *   STT_MODEL: 'whisper-1' | 'gpt-4o-mini-transcribe' (default: 'gpt-4o-mini-transcribe')
 *   TTS_PROVIDER: 'chatterbox' | 'openai' (default: 'chatterbox')
 *   CHATTERBOX_URL: URL for self-hosted Chatterbox (default: 'http://localhost:5100')
 */

import type { PhoneProvider, STTProvider, TTSProvider, ProviderRegistry } from './types.js';
import { TwilioPhoneProvider } from './phone-twilio.js';
import { TelnyxPhoneProvider } from './phone-telnyx.js';
import { OpenAISTTProvider } from './stt-openai.js';
import { OpenAITTSProvider } from './tts-openai.js';
import { ChatterboxTTSProvider } from './tts-chatterbox.js';

export * from './types.js';

export interface ProviderConfig {
  // Phone
  phoneProvider: 'telnyx' | 'twilio';
  phoneAccountSid: string;
  phoneAuthToken: string;
  phoneNumber: string;

  // STT
  sttProvider: 'openai';
  sttModel: string;
  openaiApiKey: string;

  // TTS
  ttsProvider: 'chatterbox' | 'openai';
  chatterboxUrl?: string;
  ttsVoice?: string;
}

export function loadProviderConfig(): ProviderConfig {
  const phoneProvider = (process.env.PHONE_PROVIDER || 'telnyx') as 'telnyx' | 'twilio';
  const ttsProvider = (process.env.TTS_PROVIDER || 'chatterbox') as 'chatterbox' | 'openai';

  // For Telnyx: PHONE_ACCOUNT_SID is Connection ID, PHONE_AUTH_TOKEN is API Key
  // For Twilio: standard Account SID and Auth Token
  const phoneAccountSid = process.env.PHONE_ACCOUNT_SID || process.env.TWILIO_ACCOUNT_SID || '';
  const phoneAuthToken = process.env.PHONE_AUTH_TOKEN || process.env.TWILIO_AUTH_TOKEN || '';
  const phoneNumber = process.env.PHONE_NUMBER || process.env.TWILIO_PHONE_NUMBER || '';

  return {
    phoneProvider,
    phoneAccountSid,
    phoneAuthToken,
    phoneNumber,

    sttProvider: 'openai',
    sttModel: process.env.STT_MODEL || 'gpt-4o-mini-transcribe',
    openaiApiKey: process.env.OPENAI_API_KEY || '',

    ttsProvider,
    chatterboxUrl: process.env.CHATTERBOX_URL || 'http://localhost:5100',
    ttsVoice: process.env.TTS_VOICE || 'onyx',
  };
}

export function createPhoneProvider(config: ProviderConfig): PhoneProvider {
  let provider: PhoneProvider;

  switch (config.phoneProvider) {
    case 'telnyx':
      provider = new TelnyxPhoneProvider();
      break;
    case 'twilio':
    default:
      provider = new TwilioPhoneProvider();
      break;
  }

  provider.initialize({
    accountSid: config.phoneAccountSid,
    authToken: config.phoneAuthToken,
    phoneNumber: config.phoneNumber,
  });

  return provider;
}

export function createSTTProvider(config: ProviderConfig): STTProvider {
  const provider = new OpenAISTTProvider();

  provider.initialize({
    apiKey: config.openaiApiKey,
    model: config.sttModel,
  });

  return provider;
}

export function createTTSProvider(config: ProviderConfig): TTSProvider {
  let provider: TTSProvider;

  switch (config.ttsProvider) {
    case 'chatterbox':
      provider = new ChatterboxTTSProvider();
      provider.initialize({
        apiUrl: config.chatterboxUrl,
        voice: config.ttsVoice,
      });
      break;
    case 'openai':
    default:
      provider = new OpenAITTSProvider();
      provider.initialize({
        apiKey: config.openaiApiKey,
        voice: config.ttsVoice,
      });
      break;
  }

  return provider;
}

export function createProviders(config: ProviderConfig): ProviderRegistry {
  return {
    phone: createPhoneProvider(config),
    stt: createSTTProvider(config),
    tts: createTTSProvider(config),
  };
}

/**
 * Validate that required config is present for the selected providers
 */
export function validateProviderConfig(config: ProviderConfig): string[] {
  const errors: string[] = [];

  // Phone validation
  if (!config.phoneAccountSid) {
    errors.push(`Missing PHONE_ACCOUNT_SID (or TWILIO_ACCOUNT_SID)`);
  }
  if (!config.phoneAuthToken) {
    errors.push(`Missing PHONE_AUTH_TOKEN (or TWILIO_AUTH_TOKEN)`);
  }
  if (!config.phoneNumber) {
    errors.push(`Missing PHONE_NUMBER (or TWILIO_PHONE_NUMBER)`);
  }

  // STT validation
  if (!config.openaiApiKey) {
    errors.push('Missing OPENAI_API_KEY (required for STT)');
  }

  // TTS validation
  if (config.ttsProvider === 'openai' && !config.openaiApiKey) {
    errors.push('Missing OPENAI_API_KEY (required for OpenAI TTS)');
  }
  // Note: Chatterbox doesn't need API key, just needs server running

  return errors;
}
