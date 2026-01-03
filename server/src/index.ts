#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { IncomingMessage, ServerResponse } from 'http';
import { CallManager, loadServerConfig } from './phone-call.js';
import { loadApiKeys, validateApiKey, getUserByApiKey } from './auth.js';
import { loadPricingConfig, getPricePerMin, getUserUsage } from './billing.js';

// Load configuration
loadApiKeys();
loadPricingConfig();
const serverConfig = loadServerConfig();

// Initialize call manager
const callManager = new CallManager(serverConfig);

// Create MCP server
const mcpServer = new Server(
  { name: 'hey-boss', version: '2.0.0' },
  { capabilities: { tools: {} } }
);

// Track authenticated user for current request
let currentUser: { id: string; phoneNumber: string } | null = null;

// List available tools
mcpServer.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'initiate_call',
        description: `Start a phone call with the user. Costs ${getPricePerMin()}¢/min. Use when you need voice input, want to report completed work, or need real-time discussion.`,
        inputSchema: {
          type: 'object',
          properties: {
            message: {
              type: 'string',
              description: 'What you want to say to the user. Be natural and conversational.',
            },
          },
          required: ['message'],
        },
      },
      {
        name: 'continue_call',
        description: 'Continue an active call with a follow-up message.',
        inputSchema: {
          type: 'object',
          properties: {
            call_id: { type: 'string', description: 'The call ID from initiate_call' },
            message: { type: 'string', description: 'Your follow-up message' },
          },
          required: ['call_id', 'message'],
        },
      },
      {
        name: 'end_call',
        description: 'End an active call with a closing message.',
        inputSchema: {
          type: 'object',
          properties: {
            call_id: { type: 'string', description: 'The call ID from initiate_call' },
            message: { type: 'string', description: 'Your closing message (say goodbye!)' },
          },
          required: ['call_id', 'message'],
        },
      },
    ],
  };
});

// Handle tool calls
mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (!currentUser) {
    return {
      content: [{ type: 'text', text: 'Error: Not authenticated. Please check your HEY_BOSS_API_KEY.' }],
      isError: true,
    };
  }

  try {
    if (request.params.name === 'initiate_call') {
      const { message } = request.params.arguments as { message: string };
      const result = await callManager.initiateCall(currentUser.id, currentUser.phoneNumber, message);

      return {
        content: [{
          type: 'text',
          text: `Call initiated successfully.\n\nCall ID: ${result.callId}\n\nUser's response:\n${result.response}\n\nUse continue_call to ask follow-ups or end_call to hang up.`,
        }],
      };
    }

    if (request.params.name === 'continue_call') {
      const { call_id, message } = request.params.arguments as { call_id: string; message: string };
      const response = await callManager.continueCall(call_id, message);

      return {
        content: [{ type: 'text', text: `User's response:\n${response}` }],
      };
    }

    if (request.params.name === 'end_call') {
      const { call_id, message } = request.params.arguments as { call_id: string; message: string };
      const { durationSeconds } = await callManager.endCall(call_id, message);

      const usage = getUserUsage(currentUser.id);
      return {
        content: [{
          type: 'text',
          text: `Call ended. Duration: ${durationSeconds}s\n\nYour usage: ${usage.totalCalls} calls, ${usage.totalMinutes} minutes, $${(usage.totalCostCents / 100).toFixed(2)} total`,
        }],
      };
    }

    throw new Error(`Unknown tool: ${request.params.name}`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return {
      content: [{ type: 'text', text: `Error: ${errorMessage}` }],
      isError: true,
    };
  }
});

// HTTP handler for MCP requests
function handleMcpRequest(req: IncomingMessage, res: ServerResponse): void {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method !== 'POST') {
    res.writeHead(405);
    res.end('Method Not Allowed');
    return;
  }

  // Authenticate
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Missing API key. Set HEY_BOSS_API_KEY.' }));
    return;
  }

  const apiKey = authHeader.slice(7);
  const user = validateApiKey(apiKey);
  if (!user) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid API key' }));
    return;
  }

  // Set current user for this request
  currentUser = { id: user.id, phoneNumber: user.phoneNumber };

  // Read request body
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', async () => {
    try {
      const message = JSON.parse(body);

      // Route to MCP server
      if (message.method === 'tools/list') {
        const result = await mcpServer.requestHandlers.get(ListToolsRequestSchema.shape.method.value)?.(
          { method: message.method, params: message.params || {} },
          {}
        );
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }));
      } else if (message.method === 'tools/call') {
        const result = await mcpServer.requestHandlers.get(CallToolRequestSchema.shape.method.value)?.(
          { method: message.method, params: message.params },
          {}
        );
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }));
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: {} }));
      }
    } catch (error) {
      console.error('MCP request error:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal server error' }));
    } finally {
      currentUser = null;
    }
  });
}

// Set up MCP handler and start server
callManager.setMcpHandler(handleMcpRequest);
callManager.startServer();

// Graceful shutdown
process.on('SIGINT', () => {
  console.error('\nShutting down...');
  callManager.shutdown();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.error('\nShutting down...');
  callManager.shutdown();
  process.exit(0);
});

console.error('Hey Boss SaaS server ready');
console.error(`Price: ${getPricePerMin()}¢/minute`);
