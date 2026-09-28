/** The settings every connector has, whatever its kind: name, access level, hidden fields, guardrails. */
import { z } from 'zod';

/**
 * Validates a connector name: lowercase letters, digits and dashes, as dashboard specs refer to it
 * (`"connector": "postgres-orders"`).
 */
export const connectorNameSchema = z
  .string()
  .regex(
    /^[a-z0-9][a-z0-9-]{0,62}$/,
    'Use lowercase letters, digits and dashes, up to 63 characters.',
  );

/**
 * Validates an access level: what the model may see of a connector's data.
 * 1 schema only, 2 schema and metadata, 3 aggregates, 4 full access.
 */
export const accessLevelSchema = z.literal([1, 2, 3, 4]);

/** An access level. */
export type AccessLevel = z.infer<typeof accessLevelSchema>;

/** The access level of a new connector: schema and metadata. */
export const defaultAccessLevel: AccessLevel = 2;

/** Fields with at most this many distinct values are low cardinality: from level 2 the model gets their values. */
export const lowCardinalityLimit = 50;

/**
 * Validates the fields removed from everything the model receives, at every access level:
 * `entity.field` (such as `customers.email`), or a bare `field` for every entity.
 */
export const hiddenFieldsSchema = z.array(z.string().trim().min(1).max(200)).max(500);

/** Validates the limits the server enforces on every query of a connector. */
export const guardrailsSchema = z.object({
  timeoutMs: z.int().min(1000).max(300_000).default(10_000),
  maxRows: z.int().min(1).max(1_000_000).default(50_000),
  maxRangeDays: z.int().min(1).max(3650).default(90),
});

/** The limits the server enforces on every query of a connector. */
export type Guardrails = z.output<typeof guardrailsSchema>;

/** Validates admin-written descriptions, keyed by `entity` or `entity.field`. */
export const descriptionsSchema = z.record(z.string().min(1).max(200), z.string().max(2000));
