/**
 * Explanations of the panels of a pinned version: what a panel measures, how its query computes
 * it, and why. An explanation is written from the spec and the schema alone, never from data, so
 * one is kept per version and panel and shown to every role. Analysts and above ask for one, or
 * for a new one; the older ones are kept, and the latest is shown. A panel with none on a version
 * shows the latest of an earlier version that has a panel of the same id, until it is explained
 * again.
 */
import { z } from 'zod';
import { defineEndpoint } from './contract.ts';

/** Validates a stored explanation of a panel. */
export const panelExplanationSchema = z.object({
  id: z.string(),
  dashboardId: z.string(),
  /**
   * The version it was written for: a version's spec never changes, so it stays valid for it. It
   * is earlier than the version asked for when that one has no explanation of the panel yet.
   */
  version: z.int(),
  panelId: z.string(),
  /** The explanation, plain text in short paragraphs. */
  text: z.string(),
  /** The name of the person who asked for it, for accountability only. */
  explainedBy: z.string(),
  explainedAt: z.number(),
  /** The tokens it spent, all models together. */
  tokens: z.int(),
});

/** A stored explanation of a panel. */
export type PanelExplanation = z.infer<typeof panelExplanationSchema>;

/** The path parameters of a panel of a version. */
const panelParams = z.object({
  dashboardId: z.string().min(1),
  version: z.string().regex(/^[1-9]\d{0,5}$/),
  panelId: z.string().min(1).max(64),
});

/** The path of a panel's explanation. */
const explanationPath = '/dashboards/:dashboardId/versions/:version/panels/:panelId/explanation';

/**
 * Reads the explanation a panel of a version shows, and whether one is being written now: the
 * latest of that version or, with none, the latest of the nearest earlier version.
 */
export const getPanelExplanationEndpoint = defineEndpoint({
  method: 'GET',
  path: explanationPath,
  params: panelParams,
  output: z.object({
    /** The explanation, or `null` when no version up to this one has one for the panel. */
    explanation: panelExplanationSchema.nullable(),
    /** Whether someone is asking for one at this moment. */
    generating: z.boolean(),
    /**
     * Whether the panel's queries or view differ from those of the version the explanation was
     * written for. Always `false` for an explanation of the version asked for.
     */
    panelChanged: z.boolean(),
  }),
});

/**
 * Asks for an explanation of a panel of a pinned version. It answers with an AI SDK UI message
 * stream, not JSON: the text as it is written, then a `data-outcome` part. A good explanation is
 * stored, and the next read gives it. The request names the explanation it replaces, `null` for
 * the first: when the panel shows another one, or one is being written, it answers `conflict`,
 * so no explanation is paid for twice. The one replaced may be an earlier version's; the new one
 * is stored for the version in the path, and no stored explanation is changed.
 */
export const explainPanelEndpoint = defineEndpoint({
  method: 'POST',
  path: explanationPath,
  params: panelParams,
  body: z.object({ replaces: z.string().min(1).max(64).nullable() }),
  output: z.unknown(),
});
