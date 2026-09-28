/** The identifiers a dashboard spec uses: panel ids, query refIds and variable names. */
import { z } from 'zod';

/** Validates a panel or annotation id: a stable, URL-safe slug such as `error-rate-by-service`. */
export const slugSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,62}$/, 'Use lowercase letters, digits and dashes, up to 63.');

/** Validates the name of a query result within a panel, such as `A`. */
export const refIdSchema = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9_]{0,31}$/, 'Start with a letter; use letters, digits and _.');

/**
 * Validates a variable name, written `$name` in PromQL and `:name` in SQL. Names starting with `__`
 * are the built-in time variables, so a declared name starts with a letter.
 */
export const variableNameSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]{0,39}$/, 'Start with a lowercase letter; use a-z, 0-9 and _.');
