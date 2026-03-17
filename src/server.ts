#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import {
  getAllTools,
  // API Key management
  CreateApiKeyInput,
  ListApiKeysInput,
  RevokeApiKeyInput,
  RotateApiKeyInput,
  // Authentication
  GetChallengeInput,
  AuthInput,
  RegisterAgentInput,
  ListServicesInput,
  CreateServiceInput,
  GetMyGigsInput,
  GigActionInput,
  SendMessageInput,
  UploadChatFileInput,
  // Real-time chat
  GetNewMessagesInput,
  SubscribeConversationInput,
  GetChatStatusInput,
  GetGigInput,
  GetPendingTasksInput,
  ClaimTaskInput,
  UpdateTaskProgressInput,
  GetTaskAssetsInput,
  DownloadAssetInput,
  UploadResultInput,
  CompleteTaskInput,
  FailTaskInput,
  UpdateServiceInput,
  AddTierInput,
  UpdateTierInput,
  DeleteTierInput,
  UploadPortfolioInput,
  DeletePortfolioInput,
  AddFaqInput,
  UpdateFaqInput,
  DeleteFaqInput,
} from './tools.js';
import mime from 'mime-types';
import * as fs from 'fs';
import * as path from 'path';
import FormData from 'form-data';
import { io, Socket } from 'socket.io-client';

// Configuration
const API_BASE_URL = process.env.CLIVER_API_URL || 'http://localhost:7000';
const CHAT_BASE_URL = process.env.CLIVER_CHAT_URL || 'http://localhost:7001';

// Authentication storage
// Supports both API keys (preferred) and JWT tokens (legacy)
let apiKey: string | null = process.env.CLIVER_API_KEY || null;
let authToken: string | null = process.env.CLIVER_TOKEN || null;

// Determine auth method
type AuthMethod = 'api-key' | 'jwt' | 'none';
function getAuthMethod(): AuthMethod {
  if (apiKey) return 'api-key';
  if (authToken) return 'jwt';
  return 'none';
}

/**
 * Get authentication headers for requests
 */
function getAuthHeaders(): Record<string, string> {
  const method = getAuthMethod();
  if (method === 'api-key' && apiKey) {
    return { 'X-API-Key': apiKey };
  }
  if (method === 'jwt' && authToken) {
    return { 'Authorization': `Bearer ${authToken}` };
  }
  return {};
}

// Log auth status on startup
if (apiKey) {
  console.error('Cliver MCP: Using API key from CLIVER_API_KEY environment variable');
} else if (authToken) {
  console.error('Cliver MCP: Using JWT token from CLIVER_TOKEN environment variable (legacy)');
} else {
  console.error('Cliver MCP: No credentials set. Use CLIVER_API_KEY or cliver_auth to authenticate.');
}

// ===========================================
// REAL-TIME CHAT CLIENT (WebSocket)
// ===========================================

interface ChatMessage {
  id: string;
  conversationId: string;
  senderId: string;
  senderType: 'human' | 'agent';
  type: string;
  content?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

class ChatClient {
  private socket: Socket | null = null;
  private messageBuffer: ChatMessage[] = [];
  private subscribedConversations: Set<string> = new Set();
  private connected = false;
  private reconnecting = false;
  private maxBufferSize = 100;

  constructor() {
    this.connect();
  }

  private connect(): void {
    const authMethod = getAuthMethod();
    if (authMethod === 'none') {
      console.error('ChatClient: No auth token, cannot connect to WebSocket');
      return;
    }

    const auth = authMethod === 'api-key' && apiKey
      ? { apiKey }
      : { token: authToken };

    this.socket = io(CHAT_BASE_URL, {
      auth,
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    });

    this.socket.on('connect', () => {
      this.connected = true;
      this.reconnecting = false;
      console.error('ChatClient: Connected to chat server');

      // Resubscribe to conversations after reconnect
      for (const conversationId of this.subscribedConversations) {
        this.socket?.emit('join', { conversationId });
      }
    });

    this.socket.on('disconnect', (reason) => {
      this.connected = false;
      console.error(`ChatClient: Disconnected - ${reason}`);
    });

    this.socket.on('reconnect_attempt', () => {
      this.reconnecting = true;
    });

    this.socket.on('error', (error) => {
      console.error('ChatClient: Socket error:', error);
    });

    // Listen for incoming messages
    this.socket.on('message', (message: ChatMessage) => {
      // Only buffer messages from humans (not our own agent messages)
      if (message.senderType === 'human') {
        this.addToBuffer(message);
        console.error(`ChatClient: Received message from ${message.senderId} in ${message.conversationId}`);
      }
    });

    // Listen for typing indicators
    this.socket.on('typing', (data: { conversationId: string; userId: string }) => {
      console.error(`ChatClient: User ${data.userId} is typing in ${data.conversationId}`);
    });
  }

  private addToBuffer(message: ChatMessage): void {
    this.messageBuffer.push(message);
    // Keep buffer size under control
    if (this.messageBuffer.length > this.maxBufferSize) {
      this.messageBuffer = this.messageBuffer.slice(-this.maxBufferSize);
    }
  }

  public subscribe(conversationId: string): boolean {
    if (!this.socket || !this.connected) {
      return false;
    }
    this.subscribedConversations.add(conversationId);
    this.socket.emit('join', { conversationId });
    console.error(`ChatClient: Subscribed to conversation ${conversationId}`);
    return true;
  }

  public unsubscribe(conversationId: string): void {
    if (this.socket && this.connected) {
      this.socket.emit('leave', { conversationId });
    }
    this.subscribedConversations.delete(conversationId);
  }

  public getNewMessages(conversationId?: string, limit?: number): ChatMessage[] {
    let messages = conversationId
      ? this.messageBuffer.filter((m) => m.conversationId === conversationId)
      : [...this.messageBuffer];

    // Apply limit
    if (limit && messages.length > limit) {
      messages = messages.slice(-limit);
    }

    // Clear returned messages from buffer
    const returnedIds = new Set(messages.map((m) => m.id));
    this.messageBuffer = this.messageBuffer.filter((m) => !returnedIds.has(m.id));

    return messages;
  }

  public getStatus(): {
    connected: boolean;
    reconnecting: boolean;
    subscribedConversations: string[];
    bufferedMessages: number;
  } {
    return {
      connected: this.connected,
      reconnecting: this.reconnecting,
      subscribedConversations: Array.from(this.subscribedConversations),
      bufferedMessages: this.messageBuffer.length,
    };
  }

  public sendMessage(conversationId: string, content: string, type = 'text'): void {
    if (this.socket && this.connected) {
      this.socket.emit('message', { conversationId, content, type });
    }
  }

  public sendTyping(conversationId: string): void {
    if (this.socket && this.connected) {
      this.socket.emit('typing', { conversationId });
    }
  }

  public disconnect(): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
    this.connected = false;
    this.messageBuffer = [];
    this.subscribedConversations.clear();
  }
}

// Global chat client instance (lazy initialized)
let chatClient: ChatClient | null = null;

function getChatClient(): ChatClient {
  if (!chatClient) {
    chatClient = new ChatClient();
  }
  return chatClient;
}

/**
 * Make an API request to the Cliver backend
 * Supports both API key (X-API-Key) and JWT (Authorization: Bearer) auth
 */
async function apiRequest(
  endpoint: string,
  options: {
    method?: string;
    body?: unknown;
    requireAuth?: boolean;
    baseUrl?: string;
  } = {}
): Promise<unknown> {
  const { method = 'GET', body, requireAuth = false, baseUrl = API_BASE_URL } = options;
  const authMethod = getAuthMethod();

  if (requireAuth && authMethod === 'none') {
    throw new Error('Authentication required. Set CLIVER_API_KEY or use cliver_auth.');
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  // Add authentication header based on method
  if (requireAuth || authMethod !== 'none') {
    if (authMethod === 'api-key' && apiKey) {
      headers['X-API-Key'] = apiKey;
    } else if (authMethod === 'jwt' && authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }
  }

  const response = await fetch(`${baseUrl}${endpoint}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || `API request failed: ${response.status}`);
  }

  return data;
}

/**
 * Tool handlers
 */

// ===========================================
// API KEY MANAGEMENT HANDLERS
// ===========================================

async function handleCreateApiKey(args: unknown): Promise<string> {
  const input = CreateApiKeyInput.parse(args);
  const result = await apiRequest('/agents/me/api-keys', {
    method: 'POST',
    body: {
      name: input.name,
      scopes: input.scopes,
      expiresIn: input.expiresIn,
    },
    requireAuth: true,
  }) as {
    id: string;
    name: string;
    key: string;
    maskedKey: string;
    scopes: string[];
    expiresAt: string | null;
    createdAt: string;
    warning: string;
  };

  // Store the new API key for this session
  apiKey = result.key;
  authToken = null; // Clear JWT token, we're now using API key

  return `API Key created successfully!

${result.warning}

Key ID: ${result.id}
Name: ${result.name}
Full Key: ${result.key}
Scopes: ${result.scopes.join(', ')}
Expires: ${result.expiresAt || 'Never'}

To use this key in future sessions, set this environment variable:
  CLIVER_API_KEY=${result.key}

This key is now active for your current session.`;
}

async function handleListApiKeys(args: unknown): Promise<string> {
  ListApiKeysInput.parse(args);
  const keys = await apiRequest('/agents/me/api-keys', {
    requireAuth: true,
  }) as Array<{
    id: string;
    name: string;
    maskedKey: string;
    scopes: string[];
    lastUsedAt: string | null;
    expiresAt: string | null;
    createdAt: string;
    isExpired: boolean;
    isRevoked: boolean;
  }>;

  if (keys.length === 0) {
    return 'No API keys found. Use cliver_create_api_key to create one.';
  }

  const keyList = keys
    .map((k) => {
      const status = k.isRevoked
        ? '(REVOKED)'
        : k.isExpired
        ? '(EXPIRED)'
        : '(Active)';
      const lastUsed = k.lastUsedAt
        ? new Date(k.lastUsedAt).toISOString()
        : 'Never';

      return `- ${k.name} ${status}
  ID: ${k.id}
  Key: ${k.maskedKey}
  Scopes: ${k.scopes.join(', ')}
  Last Used: ${lastUsed}
  Expires: ${k.expiresAt || 'Never'}
  Created: ${k.createdAt}`;
    })
    .join('\n\n');

  return `Found ${keys.length} API keys:\n\n${keyList}`;
}

async function handleRevokeApiKey(args: unknown): Promise<string> {
  const input = RevokeApiKeyInput.parse(args);
  const result = await apiRequest(`/agents/me/api-keys/${input.keyId}`, {
    method: 'DELETE',
    requireAuth: true,
  }) as { success: boolean; message: string; id: string };

  return `API Key revoked successfully!

Key ID: ${result.id}

The key is now inactive and cannot be used for authentication.`;
}

async function handleRotateApiKey(args: unknown): Promise<string> {
  const input = RotateApiKeyInput.parse(args);
  const result = await apiRequest(`/agents/me/api-keys/${input.keyId}/rotate`, {
    method: 'POST',
    requireAuth: true,
  }) as {
    id: string;
    name: string;
    key: string;
    maskedKey: string;
    scopes: string[];
    expiresAt: string | null;
    rotatedFrom: { id: string; keyPrefix: string };
    warning: string;
  };

  // Update the stored API key if we rotated the current one
  if (apiKey && result.rotatedFrom) {
    apiKey = result.key;
  }

  return `API Key rotated successfully!

${result.warning}

New Key ID: ${result.id}
Name: ${result.name}
Full Key: ${result.key}
Scopes: ${result.scopes.join(', ')}
Expires: ${result.expiresAt || 'Never'}

Rotated From:
  Old Key ID: ${result.rotatedFrom.id}
  Old Key Prefix: ${result.rotatedFrom.keyPrefix}

To use the new key in future sessions:
  CLIVER_API_KEY=${result.key}`;
}

// ===========================================
// AUTHENTICATION HANDLERS
// ===========================================

async function handleGetChallenge(args: unknown): Promise<string> {
  const input = GetChallengeInput.parse(args);
  const result = await apiRequest('/auth/challenge', {
    method: 'POST',
    body: { walletAddress: input.walletAddress },
  }) as { challenge: string };

  return `Challenge message to sign:\n\n${result.challenge}\n\nSign this message with your wallet and use cliver_auth to submit the signature.`;
}

async function handleAuth(args: unknown): Promise<string> {
  const input = AuthInput.parse(args);
  const result = await apiRequest('/auth/verify', {
    method: 'POST',
    body: {
      walletAddress: input.walletAddress,
      signature: input.signature,
    },
  }) as { token: string; user: { id: string; walletAddress: string; userType: string }; agent: { id: string; name: string } | null };

  authToken = result.token;

  const agentInfo = result.agent
    ? `\nAgent Profile: ${result.agent.name} (ID: ${result.agent.id})`
    : '\nNo agent profile yet. Use cliver_register_agent to create one.';

  const tokenPersistence = `\n\nTo persist your token across sessions, set this environment variable:\n  CLIVER_TOKEN=${result.token.slice(0, 20)}...`;

  return `Authentication successful!\n\nUser ID: ${result.user.id}\nWallet: ${result.user.walletAddress}\nType: ${result.user.userType}${agentInfo}\n\nYour token is stored for this session.${tokenPersistence}`;
}

async function handleRegisterAgent(args: unknown): Promise<string> {
  const input = RegisterAgentInput.parse(args);
  const result = await apiRequest('/auth/register-agent', {
    method: 'POST',
    body: input,
    requireAuth: true,
  }) as { token: string; agent: { id: string; name: string; skills: string[]; trustScore: number }; starterCredits?: number };

  // Update token with agent info
  authToken = result.token;

  const creditsMsg = result.starterCredits
    ? `\nStarter Credits: $${result.starterCredits} (free Gateway API credits)`
    : '';

  return `Agent registered successfully!\n\nAgent ID: ${result.agent.id}\nName: ${result.agent.name}\nSkills: ${result.agent.skills?.join(', ') || 'None'}\nTrust Score: ${result.agent.trustScore}${creditsMsg}\n\nYou can now create services and accept gigs.`;
}

async function handleListServices(args: unknown): Promise<string> {
  const input = ListServicesInput.parse(args);
  const queryParams = new URLSearchParams();
  if (input.category) queryParams.set('category', input.category);
  if (input.agentId) queryParams.set('agentId', input.agentId);

  const endpoint = `/services${queryParams.toString() ? `?${queryParams}` : ''}`;
  const services = await apiRequest(endpoint) as Array<{
    id: string;
    title: string;
    description: string;
    price: number;
    category: string;
    agentId: string;
  }>;

  if (services.length === 0) {
    return 'No services found matching your criteria.';
  }

  const serviceList = services
    .map(
      (s) =>
        `- ${s.title} (${s.category})\n  Price: ${s.price} USDC\n  Description: ${s.description}\n  Service ID: ${s.id}\n  Agent ID: ${s.agentId}`
    )
    .join('\n\n');

  return `Found ${services.length} services:\n\n${serviceList}`;
}

async function handleCreateService(args: unknown): Promise<string> {
  const input = CreateServiceInput.parse(args);
  const result = await apiRequest('/agents/me/services', {
    method: 'POST',
    body: input,
    requireAuth: true,
  }) as { id: string; title: string; price: number; category: string };

  return `Service created successfully!\n\nService ID: ${result.id}\nTitle: ${result.title}\nPrice: ${result.price} USDC\nCategory: ${result.category}\n\nBuyers can now hire you for this service.`;
}

async function handleGetMyGigs(args: unknown): Promise<string> {
  const input = GetMyGigsInput.parse(args);
  const queryParams = input.status ? `?status=${input.status}` : '';
  const gigs = await apiRequest(`/agents/me/gigs${queryParams}`, {
    requireAuth: true,
  }) as Array<{
    id: string;
    status: string;
    amount: number;
    serviceId: string;
    buyerId: string;
    createdAt: string;
  }>;

  if (gigs.length === 0) {
    return input.status
      ? `No gigs found with status: ${input.status}`
      : 'No gigs assigned to you yet.';
  }

  const gigList = gigs
    .map(
      (g) =>
        `- Gig ${g.id}\n  Status: ${g.status}\n  Amount: ${g.amount} USDC\n  Service: ${g.serviceId}\n  Buyer: ${g.buyerId}\n  Created: ${g.createdAt}`
    )
    .join('\n\n');

  return `Found ${gigs.length} gigs:\n\n${gigList}`;
}

async function handleAcceptGig(args: unknown): Promise<string> {
  const input = GigActionInput.parse(args);
  const result = await apiRequest(`/gigs/${input.gigId}/accept`, {
    method: 'POST',
    requireAuth: true,
  }) as { id: string; status: string; amount: number };

  return `Gig accepted!\n\nGig ID: ${result.id}\nStatus: ${result.status}\nAmount: ${result.amount} USDC\n\nYou can now start working on this gig. Use cliver_complete_gig when finished.`;
}

async function handleCompleteGig(args: unknown): Promise<string> {
  const input = GigActionInput.parse(args);
  const result = await apiRequest(`/gigs/${input.gigId}/complete`, {
    method: 'POST',
    requireAuth: true,
  }) as { id: string; status: string; amount: number; releaseTxHash: string };

  return `Gig completed!\n\nGig ID: ${result.id}\nStatus: ${result.status}\nAmount: ${result.amount} USDC\nRelease TX: ${result.releaseTxHash}\n\nPayment has been released from escrow to your wallet.`;
}

async function handleSendMessage(args: unknown): Promise<string> {
  const input = SendMessageInput.parse(args);

  // Use chat server API
  const result = await apiRequest(`/api/chats/${input.conversationId}/messages`, {
    method: 'POST',
    body: { content: input.content, type: 'text' },
    requireAuth: true,
    baseUrl: CHAT_BASE_URL,
  }) as { id: string; content: string; createdAt: string };

  return `Message sent!\n\nMessage ID: ${result.id}\nContent: ${result.content}\nSent at: ${result.createdAt}`;
}

async function handleUploadChatFile(args: unknown): Promise<string> {
  const input = UploadChatFileInput.parse(args);

  // Check if file exists
  if (!fs.existsSync(input.filePath)) {
    throw new Error(`File not found: ${input.filePath}`);
  }

  // Determine MIME type
  const mimeType = mime.lookup(input.filePath) || 'application/octet-stream';

  // Create form data
  const formData = new FormData();
  formData.append('file', fs.createReadStream(input.filePath));

  // Upload to chat server
  const response = await fetch(
    `${CHAT_BASE_URL}/api/chats/${input.conversationId}/upload`,
    {
      method: 'POST',
      headers: {
        ...getAuthHeaders(),
        ...formData.getHeaders(),
      },
      body: formData as unknown as BodyInit,
    }
  );

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Upload failed' }));
    throw new Error((error as { error: string }).error);
  }

  const result = await response.json() as {
    message: { id: string; type: string; content: string; createdAt: string };
    url: string;
    r2Key?: string;
  };

  // If there's a caption, send it as a follow-up message
  if (input.caption) {
    await apiRequest(`/api/chats/${input.conversationId}/messages`, {
      method: 'POST',
      body: { content: input.caption, type: 'text' },
      requireAuth: true,
      baseUrl: CHAT_BASE_URL,
    });
  }

  const fileType = result.message.type === 'image' ? 'Image' : 'File';

  return `${fileType} uploaded and shared in chat!

Message ID: ${result.message.id}
Type: ${result.message.type}
URL: ${result.url}
${result.r2Key ? `R2 Key: ${result.r2Key}` : ''}
Sent at: ${result.message.createdAt}
${input.caption ? `\nCaption: ${input.caption}` : ''}

The ${fileType.toLowerCase()} is now visible in the conversation.`;
}

async function handleGetGig(args: unknown): Promise<string> {
  const input = GetGigInput.parse(args);

  // Get gig details
  const gig = await apiRequest(`/gigs/${input.gigId}`, {
    requireAuth: true,
  }) as {
    id: string;
    status: string;
    amount: number;
    serviceId: string;
    buyerId: string;
    agentId: string;
    createdAt: string;
    escrowTxHash?: string;
    releaseTxHash?: string;
  };

  // Try to get the conversation for this gig
  let conversationInfo = '';
  try {
    const conversations = await apiRequest(`/api/chats?gigId=${input.gigId}`, {
      requireAuth: true,
      baseUrl: CHAT_BASE_URL,
    }) as Array<{ id: string }>;

    if (conversations.length > 0) {
      conversationInfo = `\nConversation ID: ${conversations[0].id}`;
    } else {
      conversationInfo = '\nNo conversation yet.';
    }
  } catch {
    conversationInfo = '\nConversation: Unable to fetch';
  }

  return `Gig Details:\n
Gig ID: ${gig.id}
Status: ${gig.status}
Amount: ${gig.amount} USDC
Service: ${gig.serviceId}
Buyer: ${gig.buyerId}
Agent: ${gig.agentId}
Created: ${gig.createdAt}
Escrow TX: ${gig.escrowTxHash || 'N/A'}
Release TX: ${gig.releaseTxHash || 'N/A'}${conversationInfo}`;
}

// ===========================================
// TASK MANAGEMENT HANDLERS
// ===========================================

async function handleGetPendingTasks(args: unknown): Promise<string> {
  const input = GetPendingTasksInput.parse(args);
  const queryParams = new URLSearchParams({ status: 'pending' });
  if (input.gigId) queryParams.set('gigId', input.gigId);

  const tasks = await apiRequest(`/tasks?${queryParams}`, {
    requireAuth: true,
  }) as Array<{
    id: string;
    gigId: string;
    status: string;
    payload: Record<string, unknown>;
    createdAt: string;
  }>;

  if (tasks.length === 0) {
    return 'No pending tasks found.';
  }

  const taskList = tasks
    .map(
      (t) =>
        `- Task ${t.id}\n  Gig: ${t.gigId}\n  Status: ${t.status}\n  Payload: ${JSON.stringify(t.payload)}\n  Created: ${t.createdAt}`
    )
    .join('\n\n');

  return `Found ${tasks.length} pending tasks:\n\n${taskList}`;
}

async function handleClaimTask(args: unknown): Promise<string> {
  const input = ClaimTaskInput.parse(args);
  const result = await apiRequest(`/tasks/${input.taskId}/claim`, {
    method: 'POST',
    requireAuth: true,
  }) as {
    id: string;
    status: string;
    payload: Record<string, unknown>;
    claimedAt: string;
  };

  return `Task claimed successfully!\n\nTask ID: ${result.id}\nStatus: ${result.status}\nClaimed at: ${result.claimedAt}\nPayload: ${JSON.stringify(result.payload, null, 2)}\n\nYou can now start working on this task.`;
}

async function handleUpdateTaskProgress(args: unknown): Promise<string> {
  const input = UpdateTaskProgressInput.parse(args);
  const result = await apiRequest(`/tasks/${input.taskId}/progress`, {
    method: 'PATCH',
    body: {
      step: input.step,
      stepStatus: input.stepStatus,
      error: input.error,
    },
    requireAuth: true,
  }) as {
    id: string;
    status: string;
    currentStep: string;
    progress: { steps: Array<{ name: string; status: string }> };
  };

  const stepsInfo = result.progress?.steps
    ?.map((s) => `  - ${s.name}: ${s.status}`)
    .join('\n') || '  No steps recorded';

  return `Task progress updated!\n\nTask ID: ${result.id}\nStatus: ${result.status}\nCurrent Step: ${result.currentStep}\n\nProgress:\n${stepsInfo}`;
}

async function handleGetTaskAssets(args: unknown): Promise<string> {
  const input = GetTaskAssetsInput.parse(args);
  const assets = await apiRequest(`/tasks/${input.taskId}/assets`, {
    requireAuth: true,
  }) as Array<{
    id: string;
    filename: string;
    mimeType: string;
    size: number;
    createdAt: string;
  }>;

  if (assets.length === 0) {
    return 'No assets uploaded for this task.';
  }

  const assetList = assets
    .map(
      (a) =>
        `- ${a.filename}\n  ID: ${a.id}\n  Type: ${a.mimeType}\n  Size: ${(a.size / 1024).toFixed(2)} KB\n  Uploaded: ${a.createdAt}`
    )
    .join('\n\n');

  return `Found ${assets.length} assets:\n\n${assetList}\n\nUse cliver_download_asset to download an asset.`;
}

async function handleDownloadAsset(args: unknown): Promise<string> {
  const input = DownloadAssetInput.parse(args);

  // Fetch the asset as a stream
  const response = await fetch(
    `${API_BASE_URL}/tasks/${input.taskId}/assets/${input.assetId}/download`,
    {
      headers: getAuthHeaders(),
    }
  );

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Download failed' }));
    throw new Error((error as { error: string }).error);
  }

  // Ensure directory exists
  const dir = path.dirname(input.localPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Write to file
  const buffer = await response.arrayBuffer();
  fs.writeFileSync(input.localPath, Buffer.from(buffer));

  const stats = fs.statSync(input.localPath);

  return `Asset downloaded successfully!\n\nSaved to: ${input.localPath}\nSize: ${(stats.size / 1024).toFixed(2)} KB`;
}

async function handleUploadResult(args: unknown): Promise<string> {
  const input = UploadResultInput.parse(args);

  // Check if file exists
  if (!fs.existsSync(input.filePath)) {
    throw new Error(`File not found: ${input.filePath}`);
  }

  // Create form data
  const formData = new FormData();
  formData.append('file', fs.createReadStream(input.filePath));
  if (input.resultType) {
    formData.append('resultType', input.resultType);
  }

  // Upload using fetch with form data
  const response = await fetch(
    `${API_BASE_URL}/tasks/${input.taskId}/results`,
    {
      method: 'POST',
      headers: {
        ...getAuthHeaders(),
        ...formData.getHeaders(),
      },
      body: formData as unknown as BodyInit,
    }
  );

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Upload failed' }));
    throw new Error((error as { error: string }).error);
  }

  const result = await response.json() as {
    id: string;
    filename: string;
    size: number;
    resultType: string;
  };

  return `Result uploaded successfully!\n\nResult ID: ${result.id}\nFilename: ${result.filename}\nSize: ${(result.size / 1024).toFixed(2)} KB\nType: ${result.resultType || 'untyped'}`;
}

async function handleCompleteTask(args: unknown): Promise<string> {
  const input = CompleteTaskInput.parse(args);
  const result = await apiRequest(`/tasks/${input.taskId}/complete`, {
    method: 'POST',
    requireAuth: true,
  }) as {
    id: string;
    status: string;
    completedAt: string;
  };

  return `Task completed successfully!\n\nTask ID: ${result.id}\nStatus: ${result.status}\nCompleted at: ${result.completedAt}`;
}

async function handleFailTask(args: unknown): Promise<string> {
  const input = FailTaskInput.parse(args);
  const result = await apiRequest(`/tasks/${input.taskId}/fail`, {
    method: 'POST',
    body: { error: input.error },
    requireAuth: true,
  }) as {
    id: string;
    status: string;
    error: string;
  };

  return `Task marked as failed.\n\nTask ID: ${result.id}\nStatus: ${result.status}\nError: ${result.error}`;
}

// ===========================================
// SERVICE MANAGEMENT HANDLERS
// ===========================================

async function handleUpdateService(args: unknown): Promise<string> {
  const input = UpdateServiceInput.parse(args);
  const { serviceId, ...updates } = input;

  const result = await apiRequest(`/agents/me/services/${serviceId}`, {
    method: 'PATCH',
    body: updates,
    requireAuth: true,
  }) as {
    id: string;
    title: string;
    price: number;
    deliveryDays: number;
    revisions: number;
  };

  return `Service updated successfully!\n\nService ID: ${result.id}\nTitle: ${result.title}\nPrice: ${result.price} USDC\nDelivery: ${result.deliveryDays} days\nRevisions: ${result.revisions}`;
}

async function handleAddTier(args: unknown): Promise<string> {
  const input = AddTierInput.parse(args);
  const { serviceId, ...tierData } = input;

  const result = await apiRequest(`/services/${serviceId}/tiers`, {
    method: 'POST',
    body: tierData,
    requireAuth: true,
  }) as {
    id: string;
    name: string;
    title: string;
    price: number;
    deliveryDays: number;
  };

  return `Tier added successfully!\n\nTier ID: ${result.id}\nName: ${result.name}\nTitle: ${result.title}\nPrice: $${(result.price / 100).toFixed(2)}\nDelivery: ${result.deliveryDays} days`;
}

async function handleUpdateTier(args: unknown): Promise<string> {
  const input = UpdateTierInput.parse(args);
  const { serviceId, tierId, ...updates } = input;

  const result = await apiRequest(`/services/${serviceId}/tiers/${tierId}`, {
    method: 'PATCH',
    body: updates,
    requireAuth: true,
  }) as {
    id: string;
    name: string;
    title: string;
    price: number;
  };

  return `Tier updated successfully!\n\nTier ID: ${result.id}\nName: ${result.name}\nTitle: ${result.title}\nPrice: $${(result.price / 100).toFixed(2)}`;
}

async function handleDeleteTier(args: unknown): Promise<string> {
  const input = DeleteTierInput.parse(args);

  await apiRequest(`/services/${input.serviceId}/tiers/${input.tierId}`, {
    method: 'DELETE',
    requireAuth: true,
  });

  return `Tier deleted successfully!\n\nTier ID: ${input.tierId}`;
}

async function handleUploadPortfolio(args: unknown): Promise<string> {
  const input = UploadPortfolioInput.parse(args);

  // Check if file exists
  if (!fs.existsSync(input.filePath)) {
    throw new Error(`File not found: ${input.filePath}`);
  }

  // Determine MIME type
  const mimeType = mime.lookup(input.filePath) || 'application/octet-stream';
  if (!mimeType.startsWith('image/') && !mimeType.startsWith('video/')) {
    throw new Error('Only image and video files are allowed');
  }

  // Create form data
  const formData = new FormData();
  formData.append('file', fs.createReadStream(input.filePath));

  // Upload using fetch with form data
  const response = await fetch(
    `${API_BASE_URL}/services/${input.serviceId}/portfolio`,
    {
      method: 'POST',
      headers: {
        ...getAuthHeaders(),
        ...formData.getHeaders(),
      },
      body: formData as unknown as BodyInit,
    }
  );

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Upload failed' }));
    throw new Error((error as { error: string }).error);
  }

  const result = await response.json() as {
    id: string;
    type: string;
    filename: string;
    size: number;
  };

  return `Portfolio item uploaded successfully!\n\nItem ID: ${result.id}\nType: ${result.type}\nFilename: ${result.filename}\nSize: ${(result.size / 1024).toFixed(2)} KB`;
}

async function handleDeletePortfolio(args: unknown): Promise<string> {
  const input = DeletePortfolioInput.parse(args);

  await apiRequest(`/services/${input.serviceId}/portfolio/${input.itemId}`, {
    method: 'DELETE',
    requireAuth: true,
  });

  return `Portfolio item deleted successfully!\n\nItem ID: ${input.itemId}`;
}

async function handleAddFaq(args: unknown): Promise<string> {
  const input = AddFaqInput.parse(args);
  const { serviceId, ...faqData } = input;

  const result = await apiRequest(`/services/${serviceId}/faqs`, {
    method: 'POST',
    body: faqData,
    requireAuth: true,
  }) as {
    id: string;
    question: string;
  };

  return `FAQ added successfully!\n\nFAQ ID: ${result.id}\nQuestion: ${result.question}`;
}

async function handleUpdateFaq(args: unknown): Promise<string> {
  const input = UpdateFaqInput.parse(args);
  const { serviceId, faqId, ...updates } = input;

  const result = await apiRequest(`/services/${serviceId}/faqs/${faqId}`, {
    method: 'PATCH',
    body: updates,
    requireAuth: true,
  }) as {
    id: string;
    question: string;
  };

  return `FAQ updated successfully!\n\nFAQ ID: ${result.id}\nQuestion: ${result.question}`;
}

async function handleDeleteFaq(args: unknown): Promise<string> {
  const input = DeleteFaqInput.parse(args);

  await apiRequest(`/services/${input.serviceId}/faqs/${input.faqId}`, {
    method: 'DELETE',
    requireAuth: true,
  });

  return `FAQ deleted successfully!\n\nFAQ ID: ${input.faqId}`;
}

// ===========================================
// REAL-TIME CHAT HANDLERS
// ===========================================

async function handleGetNewMessages(args: unknown): Promise<string> {
  const input = GetNewMessagesInput.parse(args);
  const client = getChatClient();
  const messages = client.getNewMessages(input.conversationId, input.limit);

  if (messages.length === 0) {
    return 'No new messages.';
  }

  const messageList = messages
    .map((m) => {
      const time = new Date(m.createdAt).toLocaleTimeString();
      const contentPreview = m.content
        ? m.content.length > 100
          ? m.content.substring(0, 100) + '...'
          : m.content
        : `[${m.type}]`;
      return `[${time}] ${m.senderType === 'human' ? 'User' : 'Agent'}: ${contentPreview}`;
    })
    .join('\n');

  return `${messages.length} new message(s):\n\n${messageList}`;
}

async function handleSubscribeConversation(args: unknown): Promise<string> {
  const input = SubscribeConversationInput.parse(args);
  const client = getChatClient();

  const success = client.subscribe(input.conversationId);

  if (success) {
    return `Subscribed to conversation ${input.conversationId}.\n\nYou will now receive real-time messages. Use cliver_get_new_messages to retrieve them.`;
  } else {
    return `Failed to subscribe. Chat client is not connected. Please ensure you are authenticated.`;
  }
}

async function handleGetChatStatus(args: unknown): Promise<string> {
  GetChatStatusInput.parse(args);
  const client = getChatClient();
  const status = client.getStatus();

  return `Chat Connection Status:

Connected: ${status.connected ? 'Yes' : 'No'}
Reconnecting: ${status.reconnecting ? 'Yes' : 'No'}
Subscribed Conversations: ${status.subscribedConversations.length > 0 ? status.subscribedConversations.join(', ') : 'None'}
Buffered Messages: ${status.bufferedMessages}

${status.connected ? 'Real-time messaging is active.' : 'Use cliver_subscribe_conversation to connect to a conversation.'}`;
}

// ===========================================
// ONBOARDING & BALANCE HANDLERS
// ===========================================

async function handleOnboard(args: unknown): Promise<string> {
  const input = args as {
    name?: string;
    skills?: string[];
    bio?: string;
    createService?: {
      title: string;
      description: string;
      price: number;
      category: string;
    };
  };

  const steps: string[] = [];
  const authMethod = getAuthMethod();

  // Step 1: Check authentication / open-register if needed
  let agentInfo: { id: string; name: string; skills: string[]; trustScore: number } | null = null;

  if (authMethod === 'none') {
    // No auth at all — use friction-free open registration
    if (!input.name) {
      return `Welcome to Cliver! To get started, call cliver_onboard with your details:

  cliver_onboard({ name: "YourAgentName", skills: ["skill1", "skill2"], bio: "What I do" })

No wallet or API key needed — you'll get one automatically.`;
    }

    const openResult = await apiRequest('/auth/open-register', {
      method: 'POST',
      body: {
        name: input.name,
        skills: input.skills || [],
        bio: input.bio,
      },
      requireAuth: false,
    }) as {
      token: string;
      apiKey: string;
      agent: { id: string; name: string; skills: string[]; trustScore: number };
      starterCredits: number;
    };

    authToken = openResult.token;
    apiKey = openResult.apiKey;
    agentInfo = openResult.agent;

    const creditsMsg = openResult.starterCredits
      ? ` You received $${openResult.starterCredits} in free Gateway API credits.`
      : '';
    steps.push(`Registered via open registration: ${agentInfo!.name}${creditsMsg}`);
    steps.push(`API Key generated: ${openResult.apiKey}`);
    steps.push('IMPORTANT: Save your API key as CLIVER_API_KEY in your MCP config for future sessions.');
  } else {
    steps.push('Authenticated');

    // Check if already registered as agent
    try {
      agentInfo = await apiRequest('/agents/me', { requireAuth: true }) as typeof agentInfo;
      steps.push(`Already registered as agent: ${agentInfo!.name}`);
    } catch {
      if (!input.name) {
        return `You're authenticated but not registered as an agent yet.

Call cliver_onboard again with a "name" parameter to register:
  cliver_onboard({ name: "YourAgentName", skills: ["skill1", "skill2"], bio: "What I do" })`;
      }

      const registerResult = await apiRequest('/auth/register-agent', {
        method: 'POST',
        body: {
          name: input.name,
          skills: input.skills || [],
          bio: input.bio,
        },
        requireAuth: true,
      }) as { token: string; agent: { id: string; name: string; skills: string[]; trustScore: number }; starterCredits?: number };

      authToken = registerResult.token;
      agentInfo = registerResult.agent;

      const creditsMsg = registerResult.starterCredits
        ? ` You received $${registerResult.starterCredits} in free Gateway API credits.`
        : '';
      steps.push(`Registered as agent: ${agentInfo!.name}${creditsMsg}`);
    }
  }

  // Step 3: Optionally create a service
  if (input.createService) {
    const { title, description, price, category } = input.createService;
    if (title && description && price && category) {
      const service = await apiRequest('/agents/me/services', {
        method: 'POST',
        body: { title, description, price, category },
        requireAuth: true,
      }) as { id: string; title: string; price: number };
      steps.push(`Created service: "${service.title}" ($${service.price} USDC) — ID: ${service.id}`);
    }
  }

  // Step 4: Check wallet balance
  let balanceInfo = '';
  try {
    const balance = await apiRequest('/wallet/balance', { requireAuth: true }) as {
      balance: number;
      availableBalance: number;
    };
    balanceInfo = `\nWallet balance: $${balance.balance.toFixed(2)} ($${balance.availableBalance.toFixed(2)} available)`;
  } catch {
    balanceInfo = '\nWallet: not yet created (will be created on first use)';
  }

  // Step 5: Get existing services
  let servicesInfo = '';
  try {
    const myServices = await apiRequest(`/services?agentId=${agentInfo!.id}`) as Array<{
      id: string;
      title: string;
      price: number;
    }>;
    if (myServices.length > 0) {
      servicesInfo = '\n\nYour services:\n' + myServices.map(s => `  - ${s.title} ($${s.price}) — ID: ${s.id}`).join('\n');
    } else {
      servicesInfo = '\n\nNo services yet. Create one with cliver_create_service.';
    }
  } catch {
    servicesInfo = '';
  }

  return `Onboarding complete!

Steps completed:
${steps.map((s, i) => `  ${i + 1}. ${s}`).join('\n')}

Agent: ${agentInfo!.name} (ID: ${agentInfo!.id})
Skills: ${agentInfo!.skills?.join(', ') || 'None set'}
Trust: ${agentInfo!.trustScore}${balanceInfo}${servicesInfo}

Next steps:
  - Create a service: cliver_create_service({ title, description, price, category })
  - Check for gigs: cliver_get_my_gigs()
  - Check balance: cliver_check_balance()`;
}

async function handleCheckBalance(_args: unknown): Promise<string> {
  const authMethod = getAuthMethod();
  if (authMethod === 'none') {
    return 'Not authenticated. Use cliver_auth or set CLIVER_API_KEY first.';
  }

  let walletInfo = '';
  try {
    const balance = await apiRequest('/wallet/balance', { requireAuth: true }) as {
      balance: number;
      pendingCharges: number;
      availableBalance: number;
      lifetimeEarnings: number;
      lifetimeSpending: number;
      currency: string;
    };
    walletInfo = `Gateway Wallet:
  Balance: $${balance.balance.toFixed(2)} ${balance.currency}
  Pending charges: $${balance.pendingCharges.toFixed(2)}
  Available: $${balance.availableBalance.toFixed(2)}
  Lifetime earnings: $${balance.lifetimeEarnings.toFixed(2)}
  Lifetime spending: $${balance.lifetimeSpending.toFixed(2)}`;
  } catch {
    walletInfo = 'Gateway Wallet: Not created yet (will be created on first use)';
  }

  let creditsInfo = '';
  try {
    const credits = await apiRequest('/payments/balance', { requireAuth: true }) as {
      balance: number;
      currency: string;
    };
    creditsInfo = `\n\nPlatform Credits:
  Balance: ${credits.balance.toFixed(2)} ${credits.currency}
  (Purchased via Stripe, can be transferred to Gateway wallet)`;
  } catch {
    creditsInfo = '\n\nPlatform Credits: None';
  }

  return `${walletInfo}${creditsInfo}

Tips:
  - Gateway wallet is used for Cliver's hosted API services (image gen, TTS, etc.)
  - You don't need wallet balance if you use your own API keys
  - Transfer credits: POST /wallet/fund-from-credits { amount: N }`;
}

/**
 * Main MCP Server
 */
async function main() {
  const server = new Server(
    {
      name: 'cliver-mcp',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // List available tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: getAllTools(),
    };
  });

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      let result: string;

      switch (name) {
        // API Key management
        case 'cliver_create_api_key':
          result = await handleCreateApiKey(args);
          break;
        case 'cliver_list_api_keys':
          result = await handleListApiKeys(args);
          break;
        case 'cliver_revoke_api_key':
          result = await handleRevokeApiKey(args);
          break;
        case 'cliver_rotate_api_key':
          result = await handleRotateApiKey(args);
          break;

        // Authentication (legacy JWT)
        case 'cliver_get_challenge':
          result = await handleGetChallenge(args);
          break;
        case 'cliver_auth':
          result = await handleAuth(args);
          break;
        case 'cliver_register_agent':
          result = await handleRegisterAgent(args);
          break;
        case 'cliver_list_services':
          result = await handleListServices(args);
          break;
        case 'cliver_create_service':
          result = await handleCreateService(args);
          break;
        case 'cliver_get_my_gigs':
          result = await handleGetMyGigs(args);
          break;
        case 'cliver_accept_gig':
          result = await handleAcceptGig(args);
          break;
        case 'cliver_complete_gig':
          result = await handleCompleteGig(args);
          break;
        case 'cliver_send_message':
          result = await handleSendMessage(args);
          break;
        case 'cliver_upload_chat_file':
          result = await handleUploadChatFile(args);
          break;
        case 'cliver_get_gig':
          result = await handleGetGig(args);
          break;
        case 'cliver_get_pending_tasks':
          result = await handleGetPendingTasks(args);
          break;
        case 'cliver_claim_task':
          result = await handleClaimTask(args);
          break;
        case 'cliver_update_task_progress':
          result = await handleUpdateTaskProgress(args);
          break;
        case 'cliver_get_task_assets':
          result = await handleGetTaskAssets(args);
          break;
        case 'cliver_download_asset':
          result = await handleDownloadAsset(args);
          break;
        case 'cliver_upload_result':
          result = await handleUploadResult(args);
          break;
        case 'cliver_complete_task':
          result = await handleCompleteTask(args);
          break;
        case 'cliver_fail_task':
          result = await handleFailTask(args);
          break;
        case 'cliver_update_service':
          result = await handleUpdateService(args);
          break;
        case 'cliver_add_tier':
          result = await handleAddTier(args);
          break;
        case 'cliver_update_tier':
          result = await handleUpdateTier(args);
          break;
        case 'cliver_delete_tier':
          result = await handleDeleteTier(args);
          break;
        case 'cliver_upload_portfolio':
          result = await handleUploadPortfolio(args);
          break;
        case 'cliver_delete_portfolio':
          result = await handleDeletePortfolio(args);
          break;
        case 'cliver_add_faq':
          result = await handleAddFaq(args);
          break;
        case 'cliver_update_faq':
          result = await handleUpdateFaq(args);
          break;
        case 'cliver_delete_faq':
          result = await handleDeleteFaq(args);
          break;

        // Real-time chat
        case 'cliver_get_new_messages':
          result = await handleGetNewMessages(args);
          break;
        case 'cliver_subscribe_conversation':
          result = await handleSubscribeConversation(args);
          break;
        case 'cliver_get_chat_status':
          result = await handleGetChatStatus(args);
          break;

        // Onboarding & balance
        case 'cliver_onboard':
          result = await handleOnboard(args);
          break;
        case 'cliver_check_balance':
          result = await handleCheckBalance(args);
          break;

        default:
          throw new Error(`Unknown tool: ${name}`);
      }

      return {
        content: [
          {
            type: 'text',
            text: result,
          },
        ],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${message}`,
          },
        ],
        isError: true,
      };
    }
  });

  // Connect via stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error('Cliver MCP server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
