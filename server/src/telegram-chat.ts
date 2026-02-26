/**
 * Telegram Chat Manager
 *
 * Manages text-based conversations with users via Telegram Bot API.
 * Only one active chat at a time (single user, single Telegram chat ID).
 */

import {
  TelegramProvider,
  TelegramBotProvider,
} from './providers/telegram.js';

interface ChatState {
  chatId: string;
  startTime: number;
  lastUpdateId: number;
  ended: boolean;
}

export interface TelegramConfig {
  botToken: string;
  userChatId: string;
  responseTimeoutMs: number;
  verboseMode: boolean;
  listenModeEnabled: boolean;
}

export function loadTelegramConfig(): TelegramConfig {
  const errors: string[] = [];

  if (!process.env.CALLME_TELEGRAM_BOT_TOKEN) {
    errors.push('Missing CALLME_TELEGRAM_BOT_TOKEN (from @BotFather)');
  }

  if (!process.env.CALLME_TELEGRAM_CHAT_ID) {
    errors.push('Missing CALLME_TELEGRAM_CHAT_ID (your Telegram user/chat ID)');
  }

  if (errors.length > 0) {
    throw new Error(`Missing required Telegram configuration:\n  - ${errors.join('\n  - ')}`);
  }

  const responseTimeoutMs = parseInt(process.env.CALLME_RESPONSE_TIMEOUT_MS || '300000', 10);

  const verboseMode = process.env.CALLME_TELEGRAM_VERBOSE === 'true'
                      || process.env.CALLME_TELEGRAM_VERBOSE === '1';

  const listenModeEnabled = process.env.CALLME_TELEGRAM_LISTEN === 'true'
                            || process.env.CALLME_TELEGRAM_LISTEN === '1';

  return {
    botToken: process.env.CALLME_TELEGRAM_BOT_TOKEN!,
    userChatId: process.env.CALLME_TELEGRAM_CHAT_ID!,
    responseTimeoutMs,
    verboseMode,
    listenModeEnabled,
  };
}

export class TelegramChatManager {
  private activeChat: ChatState | null = null;
  private config: TelegramConfig;
  private telegram: TelegramProvider;
  private currentChatId = 0;
  private globalUpdateOffset = 0;
  private verboseMode: boolean;
  private shutdownRequested = false;
  private isListening = false;
  private pollingAbortController: AbortController | null = null;

  constructor(config: TelegramConfig) {
    this.config = config;
    this.verboseMode = config.verboseMode;
    this.telegram = new TelegramBotProvider();
    this.telegram.initialize({
      botToken: config.botToken,
      chatId: config.userChatId,
    });
  }

  async initialize(): Promise<void> {
    await this.telegram.deleteWebhook();

    // Drain old messages with timeout=0 to avoid blocking MCP handshake
    const updates = await this.telegram.getUpdates(undefined, 0);
    if (updates.length > 0) {
      this.globalUpdateOffset = updates[updates.length - 1].update_id + 1;
    }

    this.startCommandPolling();
    console.error('Telegram bot initialized, ready for messages');
  }

  /**
   * Cancel any in-flight background poll so it doesn't race with active chat/listen polling.
   */
  private cancelBackgroundPoll(): void {
    if (this.pollingAbortController) {
      this.pollingAbortController.abort();
      this.pollingAbortController = null;
    }
  }

  /**
   * Background polling for slash commands when idle.
   * Only active when no chat and not in listen mode.
   */
  private async startCommandPolling(): Promise<void> {
    while (!this.shutdownRequested) {
      if (this.activeChat === null && !this.isListening) {
        try {
          this.pollingAbortController = new AbortController();
          const updates = await this.telegram.getUpdates(
            this.globalUpdateOffset,
            30,
            this.pollingAbortController.signal,
          );
          this.pollingAbortController = null;

          for (const update of updates) {
            this.globalUpdateOffset = update.update_id + 1;

            if (
              update.message?.text
              && String(update.message.chat.id) === this.config.userChatId
            ) {
              const text = update.message.text;
              const { isCommand, response } = this.handleCommand(text);

              if (isCommand && response) {
                await this.telegram.sendMessage(response);
                console.error(`[idle] Handled command: ${text}`);
              } else if (!isCommand) {
                await this.telegram.sendMessage(
                  "I'm not currently in a conversation. Claude will message you when it needs input.",
                );
              }
            }
          }
        } catch (error) {
          // AbortError is expected when transitioning to active state
          if (error instanceof DOMException && error.name === 'AbortError') {
            continue;
          }
          console.error('[idle] Polling error:', error);
        }
      }

      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  async initiateChat(message: string): Promise<{ chatId: string; response: string }> {
    if (this.activeChat) {
      throw new Error(`Chat already active: ${this.activeChat.chatId}`);
    }

    // Cancel background poll to prevent offset race
    this.cancelBackgroundPoll();

    const chatId = `chat-${++this.currentChatId}-${Date.now()}`;

    const state: ChatState = {
      chatId,
      startTime: Date.now(),
      lastUpdateId: this.globalUpdateOffset,
      ended: false,
    };

    this.activeChat = state;

    try {
      await this.telegram.sendMessage(message);
      console.error(`[${chatId}] Sent: ${message.substring(0, 50)}...`);

      const response = await this.waitForResponse(state);
      return { chatId, response };
    } catch (error) {
      this.activeChat = null;
      throw error;
    }
  }

  async continueChat(chatId: string, message: string): Promise<string> {
    const state = this.activeChat;
    if (!state || state.chatId !== chatId) throw new Error(`No active chat: ${chatId}`);
    if (state.ended) throw new Error(`Chat ${chatId} has ended`);

    await this.telegram.sendMessage(message);
    console.error(`[${chatId}] Sent: ${message.substring(0, 50)}...`);

    return this.waitForResponse(state);
  }

  async sendMessage(chatId: string, message: string): Promise<void> {
    const state = this.activeChat;
    if (!state || state.chatId !== chatId) throw new Error(`No active chat: ${chatId}`);
    if (state.ended) throw new Error(`Chat ${chatId} has ended`);

    await this.telegram.sendMessage(message);
    console.error(`[${chatId}] Sent (no response expected): ${message.substring(0, 50)}...`);
  }

  async endChat(chatId: string, message: string): Promise<{ durationSeconds: number }> {
    const state = this.activeChat;
    if (!state || state.chatId !== chatId) throw new Error(`No active chat: ${chatId}`);

    await this.telegram.sendMessage(message);
    console.error(`[${chatId}] Sent closing message: ${message.substring(0, 50)}...`);

    state.ended = true;
    const durationSeconds = Math.round((Date.now() - state.startTime) / 1000);

    // Never regress the offset
    this.globalUpdateOffset = Math.max(this.globalUpdateOffset, state.lastUpdateId);
    this.activeChat = null;

    return { durationSeconds };
  }

  private async waitForResponse(state: ChatState): Promise<string> {
    console.error(`[${state.chatId}] Waiting for user response...`);

    const startTime = Date.now();
    const timeout = this.config.responseTimeoutMs;

    while (Date.now() - startTime < timeout) {
      if (state.ended) {
        throw new Error('Chat was ended');
      }

      try {
        const updates = await this.telegram.getUpdates(state.lastUpdateId);

        for (const update of updates) {
          state.lastUpdateId = update.update_id + 1;
          this.globalUpdateOffset = Math.max(this.globalUpdateOffset, state.lastUpdateId);

          if (
            update.message?.text
            && String(update.message.chat.id) === this.config.userChatId
          ) {
            const text = update.message.text;

            const { isCommand, response: cmdResponse } = this.handleCommand(text);
            if (isCommand) {
              console.error(`[${state.chatId}] Handled command: ${text}`);
              if (cmdResponse) {
                await this.telegram.sendMessage(cmdResponse);
              }
              continue;
            }

            console.error(`[${state.chatId}] User said: ${text}`);
            return text;
          }
        }
      } catch (error) {
        console.error(`[${state.chatId}] Error getting updates:`, error);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    throw new Error(`Response timeout after ${timeout / 1000}s`);
  }

  isVerboseMode(): boolean {
    return this.verboseMode;
  }

  isListenModeEnabled(): boolean {
    return this.config.listenModeEnabled;
  }

  setVerboseMode(enabled: boolean): void {
    this.verboseMode = enabled;
    console.error(`[config] Verbose mode ${enabled ? 'enabled' : 'disabled'}`);
  }

  async broadcast(message: string): Promise<void> {
    await this.telegram.sendMessage(message);
    console.error(`[broadcast] ${message.substring(0, 50)}...`);
  }

  async listenForCommand(prompt?: string): Promise<string> {
    if (this.activeChat) {
      throw new Error(`Cannot listen while chat is active: ${this.activeChat.chatId}`);
    }

    // Cancel background poll to prevent offset race
    this.cancelBackgroundPoll();
    this.isListening = true;

    try {
      if (prompt) {
        await this.telegram.sendMessage(prompt);
      } else {
        await this.telegram.sendMessage('Listening for commands... Send me a task!');
      }

      console.error('[listen] Waiting for user command...');

      const timeout = 24 * 60 * 60 * 1000;
      const startTime = Date.now();

      while (Date.now() - startTime < timeout) {
        try {
          const updates = await this.telegram.getUpdates(this.globalUpdateOffset);

          for (const update of updates) {
            this.globalUpdateOffset = update.update_id + 1;

            if (
              update.message?.text
              && String(update.message.chat.id) === this.config.userChatId
            ) {
              const text = update.message.text;

              const { isCommand, response } = this.handleCommand(text);
              if (isCommand) {
                console.error(`[listen] Handled command: ${text}`);
                if (response) {
                  await this.telegram.sendMessage(response);
                }
                continue;
              }

              console.error(`[listen] User command: ${text}`);
              return text;
            }
          }
        } catch (error) {
          console.error('[listen] Polling error:', error);
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      throw new Error('Listen timeout - no command received in 24 hours');
    } finally {
      this.isListening = false;
    }
  }

  private handleCommand(text: string): { isCommand: boolean; response?: string } {
    const trimmed = text.trim().toLowerCase();

    if (trimmed === '/verbose' || trimmed === '/verbose status') {
      return {
        isCommand: true,
        response: `Verbose mode is currently *${this.verboseMode ? 'ON' : 'OFF'}*\n\nCommands:\n/verbose on - Enable verbose mode\n/verbose off - Disable verbose mode`,
      };
    }

    if (trimmed === '/verbose on') {
      this.setVerboseMode(true);
      return {
        isCommand: true,
        response: 'Verbose mode enabled. Claude will now stream output to Telegram.',
      };
    }

    if (trimmed === '/verbose off') {
      this.setVerboseMode(false);
      return {
        isCommand: true,
        response: 'Verbose mode disabled. Claude will only message when input is needed.',
      };
    }

    if (trimmed === '/help') {
      return {
        isCommand: true,
        response: '*CallMe Telegram Bot*\n\nCommands:\n/verbose on - Enable output streaming\n/verbose off - Disable output streaming\n/verbose - Show current status\n/help - Show this message',
      };
    }

    return { isCommand: false };
  }

  async shutdown(): Promise<void> {
    this.shutdownRequested = true;
    this.cancelBackgroundPoll();
    if (this.activeChat) {
      try {
        await this.endChat(this.activeChat.chatId, 'Session ended. Goodbye!');
      } catch (error) {
        console.error('Error during shutdown:', error);
      }
    }
  }
}
