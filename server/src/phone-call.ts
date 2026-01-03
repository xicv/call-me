import WebSocket from 'ws';
import { createServer, IncomingMessage, ServerResponse } from 'http';
import { startCallTracking, endCallTracking } from './billing.js';
import {
  loadProviderConfig,
  createProviders,
  validateProviderConfig,
  type ProviderRegistry,
} from './providers/index.js';

interface CallState {
  callId: string;
  userId: string;
  userPhoneNumber: string;
  ws: WebSocket | null;
  conversationHistory: Array<{ speaker: 'claude' | 'user'; message: string }>;
  startTime: number;
}

export interface ServerConfig {
  publicUrl: string;
  port: number;
  phoneNumber: string;
  providers: ProviderRegistry;
}

export function loadServerConfig(): ServerConfig {
  // Load and validate provider configuration
  const providerConfig = loadProviderConfig();
  const errors = validateProviderConfig(providerConfig);

  // Check for PUBLIC_URL
  if (!process.env.PUBLIC_URL) {
    errors.push('Missing PUBLIC_URL');
  }

  if (errors.length > 0) {
    throw new Error(`Missing required configuration:\n  - ${errors.join('\n  - ')}`);
  }

  // Create providers
  const providers = createProviders(providerConfig);

  return {
    publicUrl: process.env.PUBLIC_URL!,
    port: parseInt(process.env.PORT || '3333', 10),
    phoneNumber: providerConfig.phoneNumber,
    providers,
  };
}

export class CallManager {
  private activeCalls = new Map<string, CallState>();
  private httpServer: ReturnType<typeof createServer> | null = null;
  private wss: WebSocket.Server | null = null;
  private config: ServerConfig;
  private currentCallId = 0;
  private mcpHandler: ((req: IncomingMessage, res: ServerResponse) => void) | null = null;

  constructor(config: ServerConfig) {
    this.config = config;
  }

  setMcpHandler(handler: (req: IncomingMessage, res: ServerResponse) => void): void {
    this.mcpHandler = handler;
  }

  startServer(): void {
    this.httpServer = createServer((req, res) => {
      const url = new URL(req.url!, `http://${req.headers.host}`);

      // MCP endpoint
      if (url.pathname === '/mcp' && this.mcpHandler) {
        this.mcpHandler(req, res);
        return;
      }

      // TwiML/TeXML endpoint for phone providers
      if (url.pathname === '/twiml') {
        const streamUrl = `wss://${new URL(this.config.publicUrl).host}/media-stream`;
        const xml = this.config.providers.phone.getStreamConnectXml(streamUrl);
        res.writeHead(200, { 'Content-Type': 'application/xml' });
        res.end(xml);
        return;
      }

      // Health check
      if (url.pathname === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'ok',
          activeCalls: this.activeCalls.size,
          providers: {
            phone: this.config.providers.phone.name,
            stt: this.config.providers.stt.name,
            tts: this.config.providers.tts.name,
          },
        }));
        return;
      }

      res.writeHead(404);
      res.end('Not Found');
    });

    // WebSocket server for media streams
    this.wss = new WebSocket.Server({ noServer: true });

    this.httpServer.on('upgrade', (request: IncomingMessage, socket: any, head: Buffer) => {
      const url = new URL(request.url!, `http://${request.headers.host}`);
      if (url.pathname === '/media-stream') {
        this.wss!.handleUpgrade(request, socket, head, (ws) => {
          this.wss!.emit('connection', ws, request);
        });
      } else {
        socket.destroy();
      }
    });

    this.wss.on('connection', (ws) => {
      console.error('Media stream WebSocket connected');
      ws.on('message', (message: string) => {
        try {
          const msg = JSON.parse(message.toString());
          if (msg.event === 'start') {
            const streamSid = msg.start.streamSid;
            for (const [callId, state] of this.activeCalls.entries()) {
              if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
                state.ws = ws;
                console.error(`Associated stream ${streamSid} with call ${callId}`);
                break;
              }
            }
          }
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      });
    });

    this.httpServer.listen(this.config.port, () => {
      console.error(`CallMe server listening on port ${this.config.port}`);
      console.error(`MCP endpoint: ${this.config.publicUrl}/mcp`);
    });
  }

  getHttpServer() {
    return this.httpServer;
  }

  async initiateCall(userId: string, userPhoneNumber: string, message: string): Promise<{ callId: string; response: string }> {
    const callId = `call-${++this.currentCallId}-${Date.now()}`;

    const state: CallState = {
      callId,
      userId,
      userPhoneNumber,
      ws: null,
      conversationHistory: [],
      startTime: Date.now(),
    };

    this.activeCalls.set(callId, state);
    startCallTracking(callId, userId);

    try {
      const callSid = await this.config.providers.phone.initiateCall(
        userPhoneNumber,
        this.config.phoneNumber,
        `${this.config.publicUrl}/twiml`
      );

      console.error(`Call initiated: ${callSid} -> ${userPhoneNumber} (callId: ${callId})`);

      const ws = await this.waitForConnection(callId, 15000);
      state.ws = ws;

      const response = await this.speakAndListen(callId, message);
      state.conversationHistory.push({ speaker: 'claude', message });
      state.conversationHistory.push({ speaker: 'user', message: response });

      return { callId, response };
    } catch (error) {
      this.activeCalls.delete(callId);
      endCallTracking(callId);
      throw error;
    }
  }

  async continueCall(callId: string, message: string): Promise<string> {
    const state = this.activeCalls.get(callId);
    if (!state) {
      throw new Error(`No active call found with ID: ${callId}`);
    }

    const response = await this.speakAndListen(callId, message);
    state.conversationHistory.push({ speaker: 'claude', message });
    state.conversationHistory.push({ speaker: 'user', message: response });

    return response;
  }

  async endCall(callId: string, message: string): Promise<{ durationSeconds: number }> {
    const state = this.activeCalls.get(callId);
    if (!state) {
      throw new Error(`No active call found with ID: ${callId}`);
    }

    await this.speak(state, message);
    state.conversationHistory.push({ speaker: 'claude', message });

    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
      state.ws.close();
    }

    const durationSeconds = Math.round((Date.now() - state.startTime) / 1000);
    this.activeCalls.delete(callId);

    endCallTracking(callId);
    console.error(`Call ${callId} ended. Duration: ${durationSeconds}s`);

    return { durationSeconds };
  }

  private async waitForConnection(callId: string, timeout: number): Promise<WebSocket> {
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
      const state = this.activeCalls.get(callId);
      if (state?.ws && state.ws.readyState === WebSocket.OPEN) {
        return state.ws;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('WebSocket connection timeout - call may not have been answered');
  }

  private async speakAndListen(callId: string, text: string): Promise<string> {
    const state = this.activeCalls.get(callId);
    if (!state) throw new Error(`No active call: ${callId}`);

    await this.speak(state, text);
    return await this.listen(state);
  }

  private async speak(state: CallState, text: string): Promise<void> {
    console.error(`[${state.callId}] Speaking: ${text.substring(0, 50)}...`);

    // Use TTS provider to synthesize speech
    const pcmData = await this.config.providers.tts.synthesize(text);
    const muLawData = this.pcmToMuLaw(pcmData);

    // Send audio in chunks
    const chunkSize = 160;
    for (let i = 0; i < muLawData.length; i += chunkSize) {
      const chunk = muLawData.slice(i, i + chunkSize);
      if (state.ws && state.ws.readyState === WebSocket.OPEN) {
        state.ws.send(JSON.stringify({
          event: 'media',
          media: { payload: chunk.toString('base64') },
        }));
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    // Wait for speech to finish
    await new Promise((resolve) => setTimeout(resolve, text.length * 50));
  }

  private async listen(state: CallState): Promise<string> {
    return new Promise((resolve, reject) => {
      const audioChunks: Buffer[] = [];
      let silenceTimer: NodeJS.Timeout | null = null;
      const SILENCE_THRESHOLD = 2000;

      const onMessage = async (message: Buffer | string) => {
        try {
          const msg = JSON.parse(message.toString());
          if (msg.event === 'media' && msg.media?.payload) {
            const audioData = Buffer.from(msg.media.payload, 'base64');
            audioChunks.push(audioData);

            if (silenceTimer) clearTimeout(silenceTimer);
            silenceTimer = setTimeout(async () => {
              state.ws?.off('message', onMessage);
              const transcript = await this.transcribeAudio(audioChunks);
              console.error(`[${state.callId}] User said: ${transcript}`);
              resolve(transcript);
            }, SILENCE_THRESHOLD);
          }
        } catch (error) {
          console.error('Error processing message:', error);
        }
      };

      state.ws?.on('message', onMessage);

      setTimeout(() => {
        state.ws?.off('message', onMessage);
        if (silenceTimer) clearTimeout(silenceTimer);
        reject(new Error('Response timeout'));
      }, 60000);
    });
  }

  private async transcribeAudio(audioChunks: Buffer[]): Promise<string> {
    if (audioChunks.length === 0) return '';

    const fullAudio = Buffer.concat(audioChunks);
    const wavBuffer = this.muLawToWav(fullAudio);

    // Use STT provider
    return await this.config.providers.stt.transcribe(wavBuffer);
  }

  private pcmToMuLaw(pcmData: Buffer): Buffer {
    const muLawData = Buffer.alloc(Math.floor(pcmData.length / 2));
    for (let i = 0; i < muLawData.length; i++) {
      const pcm = pcmData.readInt16LE(i * 2);
      muLawData[i] = this.pcmToMuLawSample(pcm);
    }
    return muLawData;
  }

  private pcmToMuLawSample(pcm: number): number {
    const BIAS = 0x84;
    const CLIP = 32635;
    let sign = (pcm >> 8) & 0x80;
    if (sign) pcm = -pcm;
    if (pcm > CLIP) pcm = CLIP;
    pcm += BIAS;
    let exponent = 7;
    for (let expMask = 0x4000; (pcm & expMask) === 0 && exponent > 0; exponent--) {
      expMask >>= 1;
    }
    const mantissa = (pcm >> (exponent + 3)) & 0x0f;
    return (~(sign | (exponent << 4) | mantissa)) & 0xff;
  }

  private muLawToWav(muLawData: Buffer): Buffer {
    const pcmData = Buffer.alloc(muLawData.length * 2);
    for (let i = 0; i < muLawData.length; i++) {
      pcmData.writeInt16LE(this.muLawToPcm(muLawData[i]), i * 2);
    }
    const header = Buffer.alloc(44);
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + pcmData.length, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(1, 22);
    header.writeUInt32LE(8000, 24);
    header.writeUInt32LE(16000, 28);
    header.writeUInt16LE(2, 32);
    header.writeUInt16LE(16, 34);
    header.write('data', 36);
    header.writeUInt32LE(pcmData.length, 40);
    return Buffer.concat([header, pcmData]);
  }

  private muLawToPcm(muLaw: number): number {
    muLaw = ~muLaw & 0xff;
    const sign = muLaw & 0x80;
    const exponent = (muLaw >> 4) & 0x07;
    const mantissa = muLaw & 0x0f;
    let sample = ((mantissa << 3) + 0x84) << exponent;
    return sign ? -sample : sample;
  }

  shutdown(): void {
    for (const callId of this.activeCalls.keys()) {
      this.endCall(callId, 'The service is shutting down. Goodbye!').catch(console.error);
    }
    this.wss?.close();
    this.httpServer?.close();
  }
}
