/** The library: a search over pinned dashboards and their panels, for viewers. */
import { z } from 'zod';
import { panelSchema } from '../spec/dashboard.ts';
import { defineEndpoint } from './contract.ts';

/** Validates a panel that matches a search. */
const libraryPanelSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().nullable(),
});

/** Validates one pinned dashboard in the library. */
export const libraryEntrySchema = z.object({
  dashboardId: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  tags: z.array(z.string()),
  /** The pinned version. */
  version: z.int(),
  pinnedAt: z.number(),
  /** The dashboard it was copied from, while that one is in the library. */
  parent: z.object({ dashboardId: z.string(), title: z.string() }).nullable(),
  /** The connectors its panels read, in order of first use. */
  connectors: z.array(z.string()),
  panelCount: z.int(),
  /** The panels whose own text matches the search, the best first; none without a search. */
  panels: z.array(libraryPanelSchema),
  /** The panel the card draws: the best matching panel, else the first chart. */
  preview: panelSchema.nullable(),
  /** The dashboard's time zone, for the preview; `null` for the viewer's. */
  timeZone: z.string().nullable(),
});

/** One pinned dashboard in the library. */
export type LibraryEntry = z.infer<typeof libraryEntrySchema>;

/** Validates a library search's outcome. */
export const librarySearchSchema = z.object({
  results: z.array(libraryEntrySchema),
  /** Every tag in the library, for the filter chips. */
  tags: z.array(z.string()),
  /** Every connector the library reads, for the filter chips. */
  connectors: z.array(z.string()),
});

/** A library search's outcome. */
export type LibrarySearch = z.infer<typeof librarySearchSchema>;

/** A comma-separated list in the query string. */
const listParameter = z
  .string()
  .max(1000)
  .optional()
  .transform((value) => (value ? value.split(',').filter((item) => item.length > 0) : []));

/**
 * Searches the pinned dashboards: every word of `q` must match a dashboard or one of its panels,
 * and a dashboard must have every tag and read every connector asked for. Without `q`, lists them
 * all, the most recently changed first.
 */
export const searchLibraryEndpoint = defineEndpoint({
  method: 'GET',
  path: '/dashboards',
  query: z.object({
    q: z.string().max(200).optional(),
    tags: listParameter,
    connectors: listParameter,
  }),
  output: librarySearchSchema,
});
