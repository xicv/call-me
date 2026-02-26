#!/usr/bin/env bun

/**
 * CallMe MCP Server - Telegram Mode
 *
 * A stdio-based MCP server that lets Claude message you on Telegram.
 * Alternative to phone calls - free and text-based.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { TelegramChatManager, loadTelegramConfig } from './telegram-chat.js';

async function main() {
  let config;
  try {
    config = loadTelegramConfig();
  } catch (error) {
    console.error('Configuration error:', error instanceof Error ? error.message : error);
    process.exit(1);
  }

  const chatManager = new TelegramChatManager(config);

  try {
    await chatManager.initialize();
  } catch (error) {
    console.error('Failed to initialize Telegram bot:', error instanceof Error ? error.message : error);
    process.exit(1);
  }

  const mcpServer = new Server(
    { name: 'callme-telegram', version: '3.1.0' },
    { capabilities: { tools: {}, logging: {} } },
  );

  mcpServer.setRequestHandler(ListToolsRequestSchema, async () => {
    const currentVerbose = chatManager.isVerboseMode();
    const currentListenEnabled = chatManager.isListenModeEnabled();

    const tools: Array<{ name: string; description: string; inputSchema: object }> = [
      {
        name: 'broadcast',
        description: currentVerbose
          ? 'Stream output to the user via Telegram. Use liberally to keep the user informed of your progress, thoughts, and results. No response expected.'
          : 'Send a one-way message to the user via Telegram. No response expected. Use for status updates or notifications.',
        inputSchema: {
          type: 'object',
          properties: {
            message: {
              type: 'string',
              description: 'The message to send to the user.',
            },
          },
          required: ['message'],
        },
      },
      {
        name: 'send_message',
        description: 'Start a Telegram conversation with the user. Use when you need text input, want to report completed work, or need discussion. Returns the user\'s response.',
        inputSchema: {
          type: 'object',
          properties: {
            message: {
              type: 'string',
              description: 'What you want to say to the user. Be clear and concise.',
            },
          },
          required: ['message'],
        },
      },
      {
        name: 'continue_chat',
        description: 'Continue an active Telegram chat with a follow-up message.',
        inputSchema: {
          type: 'object',
          properties: {
            chat_id: { type: 'string', description: 'The chat ID from send_message' },
            message: { type: 'string', description: 'Your follow-up message' },
          },
          required: ['chat_id', 'message'],
        },
      },
      {
        name: 'notify_user',
        description: 'Send a message on an active chat without waiting for a response. Use this to acknowledge requests or provide status updates before starting time-consuming operations.',
        inputSchema: {
          type: 'object',
          properties: {
            chat_id: { type: 'string', description: 'The chat ID from send_message' },
            message: { type: 'string', description: 'What to say to the user' },
          },
          required: ['chat_id', 'message'],
        },
      },
      {
        name: 'end_chat',
        description: 'End an active Telegram chat with a closing message.',
        inputSchema: {
          type: 'object',
          properties: {
            chat_id: { type: 'string', description: 'The chat ID from send_message' },
            message: { type: 'string', description: 'Your closing message' },
          },
          required: ['chat_id', 'message'],
        },
      },
    ];

    if (currentListenEnabled) {
      tools.push({
        name: 'listen_for_commands',
        description: 'Wait for the user to send a command via Telegram. Use this to let the user control Claude remotely. Returns the user\'s message when received. After processing the command, call this again to wait for the next command.',
        inputSchema: {
          type: 'object',
          properties: {
            prompt: {
              type: 'string',
              description: 'Optional message to send before listening (e.g., "Ready for your next command")',
            },
          },
          required: [],
        },
      });
    }

    return { tools };
  });

  mcpServer.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const log = async (level: 'info' | 'debug' | 'warning', data: string) => {
      await mcpServer.sendLoggingMessage({ level, data, logger: 'callme-telegram' });
    };

    const sendProgress = async (progress: number, total: number, message: string) => {
      const progressToken = extra._meta?.progressToken;
      if (progressToken !== undefined) {
        await extra.sendNotification({
          method: 'notifications/progress',
          params: { progressToken, progress, total, message },
        });
      }
    };

    try {
      if (request.params.name === 'broadcast') {
        const { message } = request.params.arguments as { message: string };
        await chatManager.broadcast(message);
        return { content: [{ type: 'text', text: 'Message sent.' }] };
      }

      if (request.params.name === 'send_message') {
        const { message } = request.params.arguments as { message: string };

        await log('info', 'Sending message to Telegram...');
        await sendProgress(1, 2, 'Sending message...');

        const result = await chatManager.initiateChat(message);

        await log('info', 'User responded on Telegram');
        await sendProgress(2, 2, 'Response received');

        return {
          content: [{
            type: 'text',
            text: `Message sent successfully.\n\nChat ID: ${result.chatId}\n\nUser's response:\n${result.response}\n\nUse continue_chat to ask follow-ups or end_chat to close the conversation.`,
          }],
        };
      }

      if (request.params.name === 'continue_chat') {
        const { chat_id, message } = request.params.arguments as { chat_id: string; message: string };

        await log('info', 'Sending follow-up message...');
        await sendProgress(1, 2, 'Sending message...');

        const response = await chatManager.continueChat(chat_id, message);

        await log('info', 'User responded');
        await sendProgress(2, 2, 'Response received');

        return { content: [{ type: 'text', text: `User's response:\n${response}` }] };
      }

      if (request.params.name === 'notify_user') {
        const { chat_id, message } = request.params.arguments as { chat_id: string; message: string };
        await chatManager.sendMessage(chat_id, message);
        return { content: [{ type: 'text', text: `Message sent: "${message}"` }] };
      }

      if (request.params.name === 'end_chat') {
        const { chat_id, message } = request.params.arguments as { chat_id: string; message: string };
        const { durationSeconds } = await chatManager.endChat(chat_id, message);

        await log('info', `Chat ended after ${durationSeconds}s`);
        return { content: [{ type: 'text', text: `Chat ended. Duration: ${durationSeconds}s` }] };
      }

      if (request.params.name === 'listen_for_commands') {
        const { prompt } = request.params.arguments as { prompt?: string };

        await log('info', 'Entering listen mode, waiting for Telegram command...');
        const command = await chatManager.listenForCommand(prompt);

        await log('info', 'Command received from Telegram');
        return {
          content: [{ type: 'text', text: `User command received:\n\n${command}\n\nProcess this command, then call listen_for_commands again to wait for the next command. Use broadcast to send progress updates.` }],
        };
      }

      throw new Error(`Unknown tool: ${request.params.name}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      await log('warning', `Tool error: ${errorMessage}`);
      return {
        content: [{ type: 'text', text: `Error: ${errorMessage}` }],
        isError: true,
      };
    }
  });

  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);

  console.error('');
  console.error('CallMe MCP server ready (Telegram mode)');
  console.error(`Chat ID: ${config.userChatId}`);
  console.error(`Verbose mode: ${config.verboseMode ? 'enabled' : 'disabled'}`);
  console.error(`Listen mode: ${config.listenModeEnabled ? 'enabled' : 'disabled'}`);
  console.error('');

  const shutdown = async () => {
    console.error('\nShutting down...');
    await chatManager.shutdown();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
