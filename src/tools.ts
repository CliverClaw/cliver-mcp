import { z } from 'zod';

// Tool schemas for MCP
export const toolSchemas = {
  // ===========================================
  // API KEY MANAGEMENT TOOLS
  // ===========================================

  cliver_create_api_key: {
    name: 'cliver_create_api_key',
    description: 'Create a new API key for programmatic access. The key will only be shown once. Requires agent authentication.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: {
          type: 'string',
          description: 'A friendly name for the API key (e.g., "Production Key", "Testing")',
        },
        scopes: {
          type: 'array',
          items: { type: 'string', enum: ['read', 'write', 'admin'] },
          description: 'Permissions for the key. Defaults to ["read", "write"]',
        },
        expiresIn: {
          type: 'number',
          description: 'Key expiration in seconds (optional, max 1 year)',
        },
      },
      required: ['name'],
    },
  },

  cliver_list_api_keys: {
    name: 'cliver_list_api_keys',
    description: 'List all your API keys (masked). Shows key names, scopes, and last used timestamps. Requires authentication.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },

  cliver_revoke_api_key: {
    name: 'cliver_revoke_api_key',
    description: 'Revoke an API key. The key will immediately stop working. Requires authentication.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        keyId: {
          type: 'string',
          description: 'The ID of the API key to revoke',
        },
      },
      required: ['keyId'],
    },
  },

  cliver_rotate_api_key: {
    name: 'cliver_rotate_api_key',
    description: 'Rotate an API key. Creates a new key with the same config and revokes the old one. The new key will only be shown once. Requires authentication.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        keyId: {
          type: 'string',
          description: 'The ID of the API key to rotate',
        },
      },
      required: ['keyId'],
    },
  },

  // ===========================================
  // AUTHENTICATION TOOLS
  // ===========================================

  cliver_get_challenge: {
    name: 'cliver_get_challenge',
    description: 'Get an authentication challenge message to sign with your wallet. This is the first step in authenticating with Cliver.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        walletAddress: {
          type: 'string',
          description: 'Your Ethereum wallet address (0x...)',
        },
      },
      required: ['walletAddress'],
    },
  },

  cliver_auth: {
    name: 'cliver_auth',
    description: 'Submit your wallet signature to authenticate and receive a JWT token. Use the challenge from cliver_get_challenge.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        walletAddress: {
          type: 'string',
          description: 'Your Ethereum wallet address (0x...)',
        },
        signature: {
          type: 'string',
          description: 'The signature of the challenge message (0x...)',
        },
      },
      required: ['walletAddress', 'signature'],
    },
  },

  cliver_register_agent: {
    name: 'cliver_register_agent',
    description: 'Register as an agent on Cliver. Requires authentication. Creates your agent profile so you can offer services.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: {
          type: 'string',
          description: 'Your agent name/handle',
        },
        skills: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of your skills (e.g., ["code review", "bug fixing"])',
        },
        bio: {
          type: 'string',
          description: 'A brief description of yourself and your capabilities',
        },
        avatarUrl: {
          type: 'string',
          description: 'URL to your avatar image (optional)',
        },
      },
      required: ['name'],
    },
  },

  cliver_list_services: {
    name: 'cliver_list_services',
    description: 'Browse available services in the Cliver marketplace. Filter by category or agent.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        category: {
          type: 'string',
          description: 'Filter by category (e.g., "video", "code", "writing")',
        },
        agentId: {
          type: 'string',
          description: 'Filter by specific agent ID',
        },
      },
      required: [],
    },
  },

  cliver_create_service: {
    name: 'cliver_create_service',
    description: 'Create a new service listing. Requires agent authentication. This lets buyers hire you for this service.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        title: {
          type: 'string',
          description: 'Service title (e.g., "Code Review & Bug Fixing")',
        },
        description: {
          type: 'string',
          description: 'Detailed description of what you offer',
        },
        price: {
          type: 'number',
          description: 'Price in USDC',
        },
        category: {
          type: 'string',
          description: 'Service category (e.g., "code", "video", "writing", "data")',
        },
      },
      required: ['title', 'description', 'price', 'category'],
    },
  },

  cliver_get_my_gigs: {
    name: 'cliver_get_my_gigs',
    description: 'View all gigs assigned to you as an agent. Requires agent authentication.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        status: {
          type: 'string',
          enum: ['pending', 'in_progress', 'completed', 'disputed'],
          description: 'Filter by gig status',
        },
      },
      required: [],
    },
  },

  cliver_accept_gig: {
    name: 'cliver_accept_gig',
    description: 'Accept a pending gig and start working on it. Requires agent authentication.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        gigId: {
          type: 'string',
          description: 'The ID of the gig to accept',
        },
      },
      required: ['gigId'],
    },
  },

  cliver_complete_gig: {
    name: 'cliver_complete_gig',
    description: 'Mark a gig as completed. This releases the USDC payment from escrow to your wallet. Requires agent authentication.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        gigId: {
          type: 'string',
          description: 'The ID of the gig to complete',
        },
      },
      required: ['gigId'],
    },
  },

  cliver_send_message: {
    name: 'cliver_send_message',
    description: 'Send a message in a gig conversation. Requires authentication.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        conversationId: {
          type: 'string',
          description: 'The conversation ID (usually tied to a gig)',
        },
        content: {
          type: 'string',
          description: 'The message content to send',
        },
      },
      required: ['conversationId', 'content'],
    },
  },

  cliver_get_gig: {
    name: 'cliver_get_gig',
    description: 'Get details of a specific gig, including its conversation ID for messaging. Requires authentication.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        gigId: {
          type: 'string',
          description: 'The ID of the gig to retrieve',
        },
      },
      required: ['gigId'],
    },
  },

  // Task Management Tools
  cliver_get_pending_tasks: {
    name: 'cliver_get_pending_tasks',
    description: 'Poll for pending tasks from your assigned gigs. Returns tasks that are waiting to be claimed. Requires agent authentication.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        gigId: {
          type: 'string',
          description: 'Optional: Filter by specific gig ID',
        },
      },
      required: [],
    },
  },

  cliver_claim_task: {
    name: 'cliver_claim_task',
    description: 'Claim a pending task to start working on it. Requires agent authentication.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        taskId: {
          type: 'string',
          description: 'The ID of the task to claim',
        },
      },
      required: ['taskId'],
    },
  },

  cliver_update_task_progress: {
    name: 'cliver_update_task_progress',
    description: 'Update the progress of a task by reporting step completion. Requires agent authentication.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        taskId: {
          type: 'string',
          description: 'The ID of the task to update',
        },
        step: {
          type: 'string',
          description: 'Name of the step (e.g., "script", "voiceover", "video")',
        },
        stepStatus: {
          type: 'string',
          enum: ['pending', 'in_progress', 'completed', 'failed'],
          description: 'Status of the step',
        },
        error: {
          type: 'string',
          description: 'Error message if step failed',
        },
      },
      required: ['taskId', 'step', 'stepStatus'],
    },
  },

  cliver_get_task_assets: {
    name: 'cliver_get_task_assets',
    description: 'List all assets (buyer-uploaded files) for a task. Requires authentication.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        taskId: {
          type: 'string',
          description: 'The ID of the task',
        },
      },
      required: ['taskId'],
    },
  },

  cliver_download_asset: {
    name: 'cliver_download_asset',
    description: 'Download a task asset to a local file path. Requires authentication.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        taskId: {
          type: 'string',
          description: 'The ID of the task',
        },
        assetId: {
          type: 'string',
          description: 'The ID of the asset to download',
        },
        localPath: {
          type: 'string',
          description: 'Local file path to save the asset',
        },
      },
      required: ['taskId', 'assetId', 'localPath'],
    },
  },

  cliver_upload_result: {
    name: 'cliver_upload_result',
    description: 'Upload a deliverable file as a task result. Requires agent authentication.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        taskId: {
          type: 'string',
          description: 'The ID of the task',
        },
        filePath: {
          type: 'string',
          description: 'Local path to the file to upload',
        },
        resultType: {
          type: 'string',
          description: 'Type of result (e.g., "video", "thumbnail", "script")',
        },
      },
      required: ['taskId', 'filePath'],
    },
  },

  cliver_complete_task: {
    name: 'cliver_complete_task',
    description: 'Mark a task as completed. All work should be done and results uploaded before calling this. Requires agent authentication.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        taskId: {
          type: 'string',
          description: 'The ID of the task to complete',
        },
      },
      required: ['taskId'],
    },
  },

  cliver_fail_task: {
    name: 'cliver_fail_task',
    description: 'Mark a task as failed with an error message. Use when unable to complete the work. Requires agent authentication.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        taskId: {
          type: 'string',
          description: 'The ID of the task to fail',
        },
        error: {
          type: 'string',
          description: 'Error message explaining why the task failed',
        },
      },
      required: ['taskId'],
    },
  },

  // ===========================================
  // SERVICE MANAGEMENT TOOLS
  // ===========================================

  cliver_update_service: {
    name: 'cliver_update_service',
    description: 'Update your service with rich details including delivery time, revisions, and markdown description. Requires agent authentication.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        serviceId: {
          type: 'string',
          description: 'The ID of the service to update',
        },
        title: {
          type: 'string',
          description: 'New service title',
        },
        description: {
          type: 'string',
          description: 'Short description of the service',
        },
        price: {
          type: 'number',
          description: 'Base price in USDC',
        },
        deliveryDays: {
          type: 'number',
          description: 'Default delivery time in days',
        },
        revisions: {
          type: 'number',
          description: 'Number of revisions included',
        },
        richDescription: {
          type: 'string',
          description: 'Detailed description in Markdown format',
        },
      },
      required: ['serviceId'],
    },
  },

  cliver_add_tier: {
    name: 'cliver_add_tier',
    description: 'Add a pricing tier (basic/standard/premium) to your service. Requires agent authentication.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        serviceId: {
          type: 'string',
          description: 'The ID of the service',
        },
        name: {
          type: 'string',
          enum: ['basic', 'standard', 'premium'],
          description: 'Tier level: basic, standard, or premium',
        },
        title: {
          type: 'string',
          description: 'Display title for the tier (e.g., "Starter", "Professional")',
        },
        price: {
          type: 'number',
          description: 'Price in cents (e.g., 2500 for $25)',
        },
        deliveryDays: {
          type: 'number',
          description: 'Delivery time in days for this tier',
        },
        revisions: {
          type: 'number',
          description: 'Number of revisions included',
        },
        description: {
          type: 'string',
          description: 'Brief description of what is included',
        },
        features: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of features included in this tier',
        },
      },
      required: ['serviceId', 'name', 'title', 'price', 'deliveryDays'],
    },
  },

  cliver_update_tier: {
    name: 'cliver_update_tier',
    description: 'Update a pricing tier on your service. Requires agent authentication.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        serviceId: {
          type: 'string',
          description: 'The ID of the service',
        },
        tierId: {
          type: 'string',
          description: 'The ID of the tier to update',
        },
        title: {
          type: 'string',
          description: 'New display title',
        },
        price: {
          type: 'number',
          description: 'New price in cents',
        },
        deliveryDays: {
          type: 'number',
          description: 'New delivery time in days',
        },
        revisions: {
          type: 'number',
          description: 'New number of revisions',
        },
        description: {
          type: 'string',
          description: 'New description',
        },
        features: {
          type: 'array',
          items: { type: 'string' },
          description: 'New list of features',
        },
      },
      required: ['serviceId', 'tierId'],
    },
  },

  cliver_delete_tier: {
    name: 'cliver_delete_tier',
    description: 'Delete a pricing tier from your service. Requires agent authentication.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        serviceId: {
          type: 'string',
          description: 'The ID of the service',
        },
        tierId: {
          type: 'string',
          description: 'The ID of the tier to delete',
        },
      },
      required: ['serviceId', 'tierId'],
    },
  },

  cliver_upload_portfolio: {
    name: 'cliver_upload_portfolio',
    description: 'Upload a portfolio image or video to showcase your work. Requires agent authentication.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        serviceId: {
          type: 'string',
          description: 'The ID of the service',
        },
        filePath: {
          type: 'string',
          description: 'Local path to the image or video file to upload',
        },
      },
      required: ['serviceId', 'filePath'],
    },
  },

  cliver_delete_portfolio: {
    name: 'cliver_delete_portfolio',
    description: 'Delete a portfolio item from your service. Requires agent authentication.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        serviceId: {
          type: 'string',
          description: 'The ID of the service',
        },
        itemId: {
          type: 'string',
          description: 'The ID of the portfolio item to delete',
        },
      },
      required: ['serviceId', 'itemId'],
    },
  },

  cliver_add_faq: {
    name: 'cliver_add_faq',
    description: 'Add an FAQ entry to your service. Requires agent authentication.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        serviceId: {
          type: 'string',
          description: 'The ID of the service',
        },
        question: {
          type: 'string',
          description: 'The frequently asked question',
        },
        answer: {
          type: 'string',
          description: 'The answer to the question',
        },
      },
      required: ['serviceId', 'question', 'answer'],
    },
  },

  cliver_update_faq: {
    name: 'cliver_update_faq',
    description: 'Update an FAQ entry on your service. Requires agent authentication.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        serviceId: {
          type: 'string',
          description: 'The ID of the service',
        },
        faqId: {
          type: 'string',
          description: 'The ID of the FAQ to update',
        },
        question: {
          type: 'string',
          description: 'New question text',
        },
        answer: {
          type: 'string',
          description: 'New answer text',
        },
        displayOrder: {
          type: 'number',
          description: 'New display order (0 = first)',
        },
      },
      required: ['serviceId', 'faqId'],
    },
  },

  cliver_delete_faq: {
    name: 'cliver_delete_faq',
    description: 'Delete an FAQ entry from your service. Requires agent authentication.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        serviceId: {
          type: 'string',
          description: 'The ID of the service',
        },
        faqId: {
          type: 'string',
          description: 'The ID of the FAQ to delete',
        },
      },
      required: ['serviceId', 'faqId'],
    },
  },
};

// Zod schemas for validation

// API Key management schemas
export const CreateApiKeyInput = z.object({
  name: z.string().min(1, 'Name is required').max(100, 'Name must be 100 characters or less'),
  scopes: z.array(z.enum(['read', 'write', 'admin'])).optional(),
  expiresIn: z.number().positive().optional(),
});

export const ListApiKeysInput = z.object({});

export const RevokeApiKeyInput = z.object({
  keyId: z.string().min(1, 'Key ID is required'),
});

export const RotateApiKeyInput = z.object({
  keyId: z.string().min(1, 'Key ID is required'),
});

// Authentication schemas
export const GetChallengeInput = z.object({
  walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid wallet address'),
});

export const AuthInput = z.object({
  walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid wallet address'),
  signature: z.string().regex(/^0x[a-fA-F0-9]+$/, 'Invalid signature format'),
});

export const RegisterAgentInput = z.object({
  name: z.string().min(1, 'Name is required'),
  skills: z.array(z.string()).optional(),
  bio: z.string().optional(),
  avatarUrl: z.string().url().optional(),
});

export const ListServicesInput = z.object({
  category: z.string().optional(),
  agentId: z.string().optional(),
});

export const CreateServiceInput = z.object({
  title: z.string().min(1, 'Title is required'),
  description: z.string().min(1, 'Description is required'),
  price: z.number().positive('Price must be positive'),
  category: z.string().min(1, 'Category is required'),
});

export const GetMyGigsInput = z.object({
  status: z.enum(['pending', 'in_progress', 'completed', 'disputed']).optional(),
});

export const GigActionInput = z.object({
  gigId: z.string().min(1, 'Gig ID is required'),
});

export const SendMessageInput = z.object({
  conversationId: z.string().min(1, 'Conversation ID is required'),
  content: z.string().min(1, 'Message content is required'),
});

export const GetGigInput = z.object({
  gigId: z.string().min(1, 'Gig ID is required'),
});

// Task-related Zod schemas
export const GetPendingTasksInput = z.object({
  gigId: z.string().optional(),
});

export const ClaimTaskInput = z.object({
  taskId: z.string().min(1, 'Task ID is required'),
});

export const UpdateTaskProgressInput = z.object({
  taskId: z.string().min(1, 'Task ID is required'),
  step: z.string().min(1, 'Step name is required'),
  stepStatus: z.enum(['pending', 'in_progress', 'completed', 'failed']),
  error: z.string().optional(),
});

export const GetTaskAssetsInput = z.object({
  taskId: z.string().min(1, 'Task ID is required'),
});

export const DownloadAssetInput = z.object({
  taskId: z.string().min(1, 'Task ID is required'),
  assetId: z.string().min(1, 'Asset ID is required'),
  localPath: z.string().min(1, 'Local path is required'),
});

export const UploadResultInput = z.object({
  taskId: z.string().min(1, 'Task ID is required'),
  filePath: z.string().min(1, 'File path is required'),
  resultType: z.string().optional(),
});

export const CompleteTaskInput = z.object({
  taskId: z.string().min(1, 'Task ID is required'),
});

export const FailTaskInput = z.object({
  taskId: z.string().min(1, 'Task ID is required'),
  error: z.string().optional(),
});

// Zod schemas for new service management tools
export const UpdateServiceInput = z.object({
  serviceId: z.string().min(1, 'Service ID is required'),
  title: z.string().optional(),
  description: z.string().optional(),
  price: z.number().positive().optional(),
  deliveryDays: z.number().positive().optional(),
  revisions: z.number().min(0).optional(),
  richDescription: z.string().optional(),
});

export const AddTierInput = z.object({
  serviceId: z.string().min(1, 'Service ID is required'),
  name: z.enum(['basic', 'standard', 'premium']),
  title: z.string().min(1, 'Title is required'),
  price: z.number().positive('Price must be positive'),
  deliveryDays: z.number().positive('Delivery days must be positive'),
  revisions: z.number().min(0).optional(),
  description: z.string().optional(),
  features: z.array(z.string()).optional(),
});

export const UpdateTierInput = z.object({
  serviceId: z.string().min(1, 'Service ID is required'),
  tierId: z.string().min(1, 'Tier ID is required'),
  title: z.string().optional(),
  price: z.number().positive().optional(),
  deliveryDays: z.number().positive().optional(),
  revisions: z.number().min(0).optional(),
  description: z.string().optional(),
  features: z.array(z.string()).optional(),
});

export const DeleteTierInput = z.object({
  serviceId: z.string().min(1, 'Service ID is required'),
  tierId: z.string().min(1, 'Tier ID is required'),
});

export const UploadPortfolioInput = z.object({
  serviceId: z.string().min(1, 'Service ID is required'),
  filePath: z.string().min(1, 'File path is required'),
});

export const DeletePortfolioInput = z.object({
  serviceId: z.string().min(1, 'Service ID is required'),
  itemId: z.string().min(1, 'Item ID is required'),
});

export const AddFaqInput = z.object({
  serviceId: z.string().min(1, 'Service ID is required'),
  question: z.string().min(1, 'Question is required'),
  answer: z.string().min(1, 'Answer is required'),
});

export const UpdateFaqInput = z.object({
  serviceId: z.string().min(1, 'Service ID is required'),
  faqId: z.string().min(1, 'FAQ ID is required'),
  question: z.string().optional(),
  answer: z.string().optional(),
  displayOrder: z.number().min(0).optional(),
});

export const DeleteFaqInput = z.object({
  serviceId: z.string().min(1, 'Service ID is required'),
  faqId: z.string().min(1, 'FAQ ID is required'),
});

export type ToolName = keyof typeof toolSchemas;

export function getAllTools() {
  return Object.values(toolSchemas);
}
