/**
 * The endpoint of hand edits in a report thread: a change the person makes in the draft pane
 * saves a new draft version and tells the conversation, which the agent reads next turn.
 */
import { z } from 'zod';
import { specChangeSchema } from '../threads.ts';
import { defineEndpoint } from './contract.ts';

/** Saves the person's own change to a report thread's draft as a new version. */
export const handEditReportEndpoint = defineEndpoint({
  method: 'POST',
  path: '/threads/:threadId/report-draft',
  params: z.object({ threadId: z.string().min(1) }),
  body: z.object({
    /** The whole spec as the person left it; checked like any version. */
    spec: z.unknown(),
    /** What changed, in words; the changed fields when left out. */
    note: z.string().min(1).max(200).optional(),
  }),
  output: z.object({
    reportId: z.string(),
    version: z.int(),
    changes: z.array(specChangeSchema),
  }),
});
