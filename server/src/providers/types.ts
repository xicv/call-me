/**
 * Provider Interfaces
 *
 * Abstractions for Phone, STT, and TTS services to allow
 * swapping between different providers (e.g., Twilio vs Telnyx)
 */

/**
 * Phone Provider - handles initiating calls and WebSocket media streams
 */
export interface PhoneProvider {
  readonly name: string;

  /**
   * Initialize the provider with credentials
   */
  initialize(config: PhoneConfig): void;

  /**
   * Initiate an outbound call
   * @returns Call SID/ID from the provider
   */
  initiateCall(to: string, from: string, webhookUrl: string): Promise<string>;

  /**
   * Get TwiML/TeXML response for connecting media stream
   */
  getStreamConnectXml(streamUrl: string): string;
}

export interface PhoneConfig {
  accountSid: string;
  authToken: string;
  phoneNumber: string;
}

/**
 * Speech-to-Text Provider
 */
export interface STTProvider {
  readonly name: string;

  /**
   * Initialize the provider
   */
  initialize(config: STTConfig): void;

  /**
   * Transcribe audio buffer to text
   * @param audio WAV audio buffer
   */
  transcribe(audio: Buffer): Promise<string>;
}

export interface STTConfig {
  apiKey?: string;
  apiUrl?: string;  // For self-hosted providers
  model?: string;
}

/**
 * Text-to-Speech Provider
 */
export interface TTSProvider {
  readonly name: string;

  /**
   * Initialize the provider
   */
  initialize(config: TTSConfig): void;

  /**
   * Convert text to speech
   * @returns PCM audio buffer (16-bit, mono)
   */
  synthesize(text: string): Promise<Buffer>;
}

export interface TTSConfig {
  apiKey?: string;
  apiUrl?: string;  // For self-hosted providers
  voice?: string;
  model?: string;
}

/**
 * Provider registry for dependency injection
 */
export interface ProviderRegistry {
  phone: PhoneProvider;
  stt: STTProvider;
  tts: TTSProvider;
}
