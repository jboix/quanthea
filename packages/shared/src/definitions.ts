/**
 * Definitions: business terms with one meaning, such as "error rate". A definition's meaning is a
 * sentence the agent reads; its checked bodies are builder fields a panel copies when it is built,
 * so every new dashboard means the same thing by the same word. Copies never follow a later
 * change: pinned dashboards and built panels stay as they were.
 */
import { z } from 'zod';
import { type BuilderLanguage, queryBuilders } from './query-builders.ts';

/**
 * What a body defines: a measure (filters and what to measure), a ratio (the part over the whole,
 * both counted), or a segment (filters only, added to any panel's filters).
 */
export const definitionShapes = ['measure', 'ratio', 'segment'] as const;

/** A definition's shape. */
export type DefinitionShape = (typeof definitionShapes)[number];

/** The longest meaning, kept short because the agent reads it on every turn that names it. */
export const maxMeaningLength = 300;

/** Validates a definition's id, such as `error-rate`. */
export const definitionIdSchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]{0,62}$/, 'Use lowercase letters, digits and -, starting with a letter.');

/** The ids of every builder, for a body's request. */
const builderIds = queryBuilders.map((builder) => builder.id) as [string, ...string[]];

/**
 * Validates a checked body. Its request is a builder request without its connector: the builder,
 * where the data is (a table, an index, a metric, a collection) and the fields that carry the
 * meaning (filters, a measure, or a part and a whole). The server checks it with the builder's
 * own schema. Literal values only: a variable belongs to the panel.
 */
export const definitionBodySchema = z.strictObject({
  shape: z.enum(definitionShapes),
  request: z.looseObject({ kind: z.enum(builderIds) }),
  /** The connectors it is for; every connector of its language whose schema has its fields when left out. */
  connectors: z.array(z.string().min(1).max(63)).min(1).max(20).optional(),
});

/** A checked body. */
export type DefinitionBody = z.infer<typeof definitionBodySchema>;

/**
 * The query language of a body, from its builder.
 *
 * @param body - The body.
 * @returns The language.
 */
export function bodyLanguage(body: Pick<DefinitionBody, 'request'>): BuilderLanguage {
  const builder = queryBuilders.find((each) => each.id === body.request.kind);
  return builder?.language ?? 'sql';
}

/**
 * Whether a builder can carry a body of a shape: a ratio only in a ratio builder, a measure in a
 * builder that measures, a segment in any builder of its language.
 *
 * @param shape - The body's shape.
 * @param kind - The builder's id.
 * @returns Whether it fits.
 */
export function shapeFits(shape: DefinitionShape, kind: string): boolean {
  const ratio = kind === 'ratio' || kind.endsWith('-ratio');
  if (shape === 'ratio') return ratio;
  if (shape === 'measure') return !ratio && !kind.endsWith('-rows') && kind !== 'logql-lines';
  return true;
}

/**
 * The problems of a definition's bodies: two for one language, or a body whose builder does not
 * fit its shape.
 *
 * @param bodies - The bodies.
 * @returns The problems, as sentences.
 */
function bodyProblems(bodies: readonly DefinitionBody[]): string[] {
  const languages = bodies.map(bodyLanguage);
  const twice = languages.filter((language, index) => languages.indexOf(language) !== index);
  return [
    ...[...new Set(twice)].map((language) => `Two bodies are for ${language}; keep one.`),
    ...bodies
      .filter((body) => !shapeFits(body.shape, body.request.kind))
      .map((body) => `A ${body.shape} cannot be written with ${body.request.kind}.`),
  ];
}

/** Validates a definition: a name, synonyms, a meaning, and at most one checked body a language. */
export const definitionSchema = z
  .strictObject({
    id: definitionIdSchema,
    name: z.string().trim().min(1).max(80),
    synonyms: z.array(z.string().trim().min(1).max(60)).max(10).default([]),
    meaning: z.string().trim().min(1).max(maxMeaningLength),
    bodies: z.array(definitionBodySchema).max(5).default([]),
  })
  .superRefine((definition, context) => {
    for (const message of bodyProblems(definition.bodies))
      context.addIssue({ code: 'custom', path: ['bodies'], message });
  });

/** A definition. */
export type Definition = z.infer<typeof definitionSchema>;

/** Where a version of a definition came from: the interface, or the provisioning file. */
export const definitionOrigins = ['ui', 'file'] as const;

/** Validates one stored version of a definition. Versions are never rewritten. */
export const definitionVersionSchema = z.object({
  definition: definitionSchema,
  version: z.int().min(1),
  author: z.string(),
  origin: z.enum(definitionOrigins),
  createdAt: z.int(),
});

/** One stored version of a definition. */
export type DefinitionVersion = z.infer<typeof definitionVersionSchema>;

/** Validates what a panel records of the definition it was built from. */
export const definitionMarkSchema = z.strictObject({
  id: definitionIdSchema,
  version: z.int().min(1),
});

/** What a panel records of the definition it was built from. */
export type DefinitionMark = z.infer<typeof definitionMarkSchema>;
