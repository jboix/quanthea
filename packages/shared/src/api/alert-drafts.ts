/**
 * The endpoints of hand edits: a hand edit in an alert thread's draft pane saves a new draft
 * version and tells the conversation, changes made on a live alert's page are saved and activated,
 * and a test sends a version's message to its channels as `alert.test`.
 */
import { z } from 'zod';
import { specChangeSchema } from '../threads.ts';
import { defineEndpoint } from './contract.ts';
import { sendResultSchema } from './notification-channels.ts';

/** Saves the person's own change to an alert thread's draft as a new version. */
export const handEditAlertEndpoint = defineEndpoint({
  method: 'POST',
  path: '/threads/:threadId/alert-draft',
  params: z.object({ threadId: z.string().min(1) }),
  body: z.object({
    /** The whole spec as the person left it; checked like any version. */
    spec: z.unknown(),
    /** What changed, in words; the changed fields when left out. */
    note: z.string().min(1).max(200).optional(),
  }),
  output: z.object({
    alertId: z.string(),
    version: z.int(),
    changes: z.array(specChangeSchema),
  }),
});

/**
 * Saves the person's own changes to a live alert, made on its page, as a new version, and
 * activates it. The conversation that wrote the alert, if any, gets the hand-edit card.
 */
export const activateAlertChangesEndpoint = defineEndpoint({
  method: 'POST',
  path: '/alerts/:alertId/versions',
  params: z.object({ alertId: z.string().min(1).max(64) }),
  body: z.object({
    /** The active version the changes start from; a conflict once another is active. */
    basedOn: z.int().min(1),
    /** The whole spec with the changes; checked and run once like any version. */
    spec: z.unknown(),
    /** What changed, in words; the changed fields when left out. */
    note: z.string().min(1).max(200).optional(),
  }),
  output: z.object({
    alertId: z.string(),
    version: z.int(),
    changes: z.array(specChangeSchema),
  }),
});

/** Sends a version's message to its channels as a test; the values come from one series. */
export const testAlertEndpoint = defineEndpoint({
  method: 'POST',
  path: '/alerts/:alertId/versions/:version/test',
  params: z.object({
    alertId: z.string().min(1).max(64),
    version: z.string().regex(/^[1-9]\d{0,5}$/),
  }),
  body: z.object({
    /** The series the message is about, such as a firing from the replay; a stand-in otherwise. */
    series: z
      .object({
        labels: z.record(z.string().max(100), z.string().max(500)),
        value: z.number().nullable(),
        since: z.number(),
      })
      .optional(),
  }),
  output: z.object({ results: z.array(sendResultSchema) }),
});
