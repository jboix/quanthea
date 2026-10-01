/** The query languages a connector kind can speak. The core binds each one; a plugin picks one. */
import { z } from 'zod';

/** The query languages connectors speak. */
export const queryLanguages = [
  'sql',
  'promql',
  'search',
  'logql',
  'http',
  'redis',
  'mongodb',
] as const;

/** Validates a query language. */
export const queryLanguageSchema = z.enum(queryLanguages);

/** A query language. */
export type QueryLanguage = z.infer<typeof queryLanguageSchema>;
