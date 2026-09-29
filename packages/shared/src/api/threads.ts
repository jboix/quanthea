/** Thread endpoints: list, create, read and delete threads, decide plans, and undo a version. */
import { z } from 'zod';
import { accessLevelSchema } from '../connectors.ts';
import { threadQueriesSchema } from '../queries.ts';
import { planViewSchema, threadStates } from '../threads.ts';
import { defineEndpoint } from './contract.ts';

/** Validates a thread in a list. */
export const threadSummarySchema = z.object({
  id: z.string(),
  title: z.string().nullable(),
  state: z.enum(threadStates),
  dashboardId: z.string().nullable(),
  tokensUsed: z.number(),
  /** The model provider it uses; `null` for the default. */
  providerId: z.string().nullable(),
  /** The query builders and saved queries it uses. */
  queries: threadQueriesSchema,
  createdAt: z.number(),
  updatedAt: z.number(),
});

/** A thread in a list. */
export type ThreadSummary = z.infer<typeof threadSummarySchema>;

/** Validates a thread with its conversation. */
export const threadDetailSchema = threadSummarySchema.extend({
  /** The AI SDK UI messages, in order. The web app reads them with its message types. */
  messages: z.array(z.unknown()),
  plans: z.array(planViewSchema),
  /** The model that builds, such as `claude-sonnet-5`, for the composer's chip. */
  model: z.string(),
  /** The name of the provider the thread uses, such as `Mistral free`. */
  providerName: z.string(),
  /** The connectors and their access levels, for the composer's chip. */
  connectors: z.array(z.object({ name: z.string(), accessLevel: accessLevelSchema })),
});

/** A thread with its conversation. */
export type ThreadDetail = z.infer<typeof threadDetailSchema>;

/** The path parameter of one thread. */
const threadParams = z.object({ threadId: z.string().min(1) });

/** The path of the streamed chat endpoint. It answers with an AI SDK UI message stream. */
export const threadChatPath = '/threads/:threadId/chat';

/** Lists the threads, the most recent first. */
export const listThreadsEndpoint = defineEndpoint({
  method: 'GET',
  path: '/threads',
  output: z.array(threadSummarySchema),
});

/** Starts a thread. */
export const createThreadEndpoint = defineEndpoint({
  method: 'POST',
  path: '/threads',
  body: z.object({
    providerId: z.string().max(40).optional(),
    queries: threadQueriesSchema.optional(),
  }),
  output: threadSummarySchema,
});

/** Reads a thread with its messages and plans. */
export const getThreadEndpoint = defineEndpoint({
  method: 'GET',
  path: '/threads/:threadId',
  params: threadParams,
  output: threadDetailSchema,
});

/** Deletes a thread. Its dashboard, drafts and pinned versions stay. */
export const deleteThreadEndpoint = defineEndpoint({
  method: 'DELETE',
  path: '/threads/:threadId',
  params: threadParams,
  output: z.object({ deleted: z.literal(true) }),
});

/** Approves the pending plan; the thread moves to building. */
export const approvePlanEndpoint = defineEndpoint({
  method: 'POST',
  path: '/threads/:threadId/plans/:planId/approve',
  params: threadParams.extend({ planId: z.string().min(1) }),
  output: threadSummarySchema,
});

/** Rejects the pending plan; the thread goes back to asking. */
export const rejectPlanEndpoint = defineEndpoint({
  method: 'POST',
  path: '/threads/:threadId/plans/:planId/reject',
  params: threadParams.extend({ planId: z.string().min(1) }),
  output: threadSummarySchema,
});

/** Starts the thread's draft from a pinned dashboard: a copy, with no model involved. */
export const startFromPinnedEndpoint = defineEndpoint({
  method: 'POST',
  path: '/threads/:threadId/start-from',
  params: threadParams,
  body: z.object({ dashboardId: z.string().min(1).max(100) }),
  output: z.object({ dashboardId: z.string(), version: z.int() }),
});

/** Undo: restores an older version of the thread's dashboard as a new version. */
export const restoreVersionEndpoint = defineEndpoint({
  method: 'POST',
  path: '/threads/:threadId/restore',
  params: threadParams,
  body: z.object({ version: z.int().min(1) }),
  output: z.object({ version: z.int() }),
});
