/**
 * Telegram Bot Provider
 *
 * Handles Telegram Bot API integration for text-based communication with users.
 */

export interface TelegramConfig {
  botToken: string;
  chatId: string;
  maxRetries?: number;
  retryDelayMs?: number;
}

export class TelegramApiError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'TelegramApiError';
  }
}

export interface TelegramProvider {
  readonly name: string;
  initialize(config: TelegramConfig): void;
  sendMessage(text: string): Promise<number>;
  getUpdates(offset?: number, timeoutSeconds?: number, signal?: AbortSignal): Promise<TelegramUpdate[]>;
  deleteWebhook(): Promise<void>;
}

export interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from: {
      id: number;
      first_name: string;
      username?: string;
    };
    chat: {
      id: number;
      type: string;
    };
    date: number;
    text?: string;
  };
}

export class TelegramBotProvider implements TelegramProvider {
  readonly name = 'telegram';
  private botToken: string = '';
  private chatId: string = '';
  private baseUrl: string = '';
  private maxRetries: number = 3;
  private retryDelayMs: number = 1000;

  initialize(config: TelegramConfig): void {
    this.botToken = config.botToken;
    this.chatId = config.chatId;
    this.baseUrl = `https://api.telegram.org/bot${this.botToken}`;
    this.maxRetries = config.maxRetries ?? 3;
    this.retryDelayMs = config.retryDelayMs ?? 1000;
  }

  private async fetchWithRetry<T>(
    url: string,
    options?: RequestInit,
    operation: string = 'API call',
  ): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await fetch(url, options);

        if (!response.ok) {
          const errorText = await response.text();
          const apiError = new TelegramApiError(
            response.status,
            `Telegram API error (${response.status}): ${errorText}`,
          );
          // Don't retry client errors, except 429 (rate limit) and 409 (conflict/duplicate poll)
          if (response.status >= 400 && response.status < 500 && response.status !== 429 && response.status !== 409) {
            throw apiError;
          }
          throw apiError;
        }

        const result = await response.json() as { ok: boolean; result: T };
        if (!result.ok) {
          throw new Error('Telegram API returned ok=false');
        }
        return result.result;
      } catch (error) {
        // Never retry aborted requests
        if (error instanceof DOMException && error.name === 'AbortError') {
          throw error;
        }

        lastError = error instanceof Error ? error : new Error(String(error));

        // Don't retry on client errors (4xx) except 429 rate limit and 409 conflict
        if (lastError instanceof TelegramApiError
            && lastError.statusCode >= 400
            && lastError.statusCode < 500
            && lastError.statusCode !== 429
            && lastError.statusCode !== 409) {
          throw lastError;
        }

        if (attempt < this.maxRetries) {
          const delay = this.retryDelayMs * Math.pow(2, attempt);
          console.error(`[Telegram] ${operation} failed (attempt ${attempt + 1}/${this.maxRetries + 1}), retrying in ${delay}ms: ${lastError.message}`);
          await this.sleep(delay);
        }
      }
    }

    throw new Error(`${operation} failed after ${this.maxRetries + 1} attempts: ${lastError?.message}`);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async sendMessage(text: string): Promise<number> {
    try {
      const result = await this.fetchWithRetry<{ message_id: number }>(
        `${this.baseUrl}/sendMessage`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: this.chatId,
            text,
            parse_mode: 'Markdown',
          }),
        },
        'sendMessage',
      );
      return result.message_id;
    } catch (error) {
      // Markdown parse failure -> retry as plain text (only for entity parsing errors)
      if (error instanceof TelegramApiError && error.statusCode === 400 && error.message.includes("can't parse entities")) {
        console.error('[Telegram] Markdown parse failed, retrying as plain text');
        const result = await this.fetchWithRetry<{ message_id: number }>(
          `${this.baseUrl}/sendMessage`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: this.chatId,
              text,
            }),
          },
          'sendMessage (plain text fallback)',
        );
        return result.message_id;
      }
      throw error;
    }
  }

  async getUpdates(offset?: number, timeoutSeconds: number = 30, signal?: AbortSignal): Promise<TelegramUpdate[]> {
    const params = new URLSearchParams({
      timeout: String(timeoutSeconds),
      allowed_updates: JSON.stringify(['message']),
    });
    if (offset !== undefined) {
      params.set('offset', String(offset));
    }

    return this.fetchWithRetry<TelegramUpdate[]>(
      `${this.baseUrl}/getUpdates?${params}`,
      signal ? { signal } : undefined,
      'getUpdates',
    );
  }

  async deleteWebhook(): Promise<void> {
    await this.fetchWithRetry<boolean>(
      `${this.baseUrl}/deleteWebhook`,
      { method: 'POST' },
      'deleteWebhook',
    );
  }
}

export function createTelegramProvider(): TelegramProvider {
  return new TelegramBotProvider();
}
