/**
 * The bin holds threads. Editors move threads in and restore them; admins delete them for good,
 * which deletes their dashboards with every version. Usage is kept.
 */
import { z } from 'zod';
import { defineEndpoint } from './contract.ts';

/** Validates a thread in the bin. */
export const binnedThreadSchema = z.object({
  id: z.string(),
  title: z.string().nullable(),
  dashboardId: z.string().nullable(),
  dashboardTitle: z.string().nullable(),
  deletedAt: z.number(),
  deletedBy: z.string().nullable(),
});

/** A thread in the bin. */
export type BinnedThread = z.infer<typeof binnedThreadSchema>;

/** The path parameter of a binned thread. */
const binParams = z.object({ threadId: z.string().min(1) });

/** Lists the threads in the bin, the most recently binned first. */
export const listBinEndpoint = defineEndpoint({
  method: 'GET',
  path: '/bin',
  output: z.object({ threads: z.array(binnedThreadSchema) }),
});

/** Takes a thread out of the bin, with its dashboard. */
export const restoreThreadEndpoint = defineEndpoint({
  method: 'POST',
  path: '/bin/:threadId/restore',
  params: binParams,
  output: z.object({ restored: z.literal(true) }),
});

/** Deletes a binned thread for good, with its dashboard and every version. */
export const purgeThreadEndpoint = defineEndpoint({
  method: 'DELETE',
  path: '/bin/:threadId',
  params: binParams,
  output: z.object({ purged: z.literal(true) }),
});

/** Deletes every binned thread for good. */
export const emptyBinEndpoint = defineEndpoint({
  method: 'DELETE',
  path: '/bin',
  output: z.object({ purged: z.int() }),
});
