/**
 * The bin also holds conversations about dashboards. Whoever started a conversation moves it to
 * the bin, and admins move any; analysts and above only. Its starter, whoever binned it, and admins
 * restore it; admins delete it for good, with its questions. Usage is kept.
 */
import { z } from 'zod';
import { defineEndpoint } from './contract.ts';

/** Validates a conversation in the bin. */
export const binnedConversationSchema = z.object({
  /** The id of its first question. */
  id: z.string(),
  dashboardId: z.string(),
  dashboardTitle: z.string(),
  /** Its first question. */
  question: z.string(),
  /** The name of the person who asked the first question. */
  startedBy: z.string(),
  startedAt: z.number(),
  /** How many questions it holds. */
  count: z.int(),
  binnedAt: z.number(),
  /** The name of the person who moved it to the bin. */
  binnedBy: z.string(),
});

/** A conversation in the bin. */
export type BinnedConversation = z.infer<typeof binnedConversationSchema>;

/** The path parameter of a binned conversation. */
const binnedParams = z.object({ conversationId: z.string().min(1).max(64) });

/** Moves a conversation about a dashboard to the bin. */
export const binConversationEndpoint = defineEndpoint({
  method: 'DELETE',
  path: '/dashboards/:dashboardId/conversations/:conversationId',
  params: binnedParams.extend({ dashboardId: z.string().min(1) }),
  output: z.object({ binned: z.literal(true) }),
});

/**
 * Lists the binned conversations one may restore, the most recently binned first, and how many
 * days the bin keeps them (`null`: until someone deletes them).
 */
export const listBinnedConversationsEndpoint = defineEndpoint({
  method: 'GET',
  path: '/bin/conversations',
  output: z.object({
    conversations: z.array(binnedConversationSchema),
    binDays: z.int().nullable(),
  }),
});

/** Takes a conversation out of the bin. */
export const restoreConversationEndpoint = defineEndpoint({
  method: 'POST',
  path: '/bin/conversations/:conversationId/restore',
  params: binnedParams,
  output: z.object({ restored: z.literal(true) }),
});

/** Deletes a binned conversation for good, with its questions. */
export const purgeConversationEndpoint = defineEndpoint({
  method: 'DELETE',
  path: '/bin/conversations/:conversationId',
  params: binnedParams,
  output: z.object({ purged: z.literal(true) }),
});
