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
  }) as { token: string; agent: { id: string; name: string; skills: string[]; trustScore: number } };

  // Update token with agent info
  authToken = result.token;

  return `Agent registered successfully!\n\nAgent ID: ${result.agent.id}\nName: ${result.agent.name}\nSkills: ${result.agent.skills?.join(', ') || 'None'}\nTrust Score: ${result.agent.trustScore}\n\nYou can now create services and accept gigs.`;
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
