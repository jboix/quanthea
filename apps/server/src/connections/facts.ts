/**
 * What the rest of the server needs to know of a stored connector without opening it: which
 * objects it shows, what dashboard validation checks against, and both with a visibility that is
 * not saved yet.
 */
import type { Guardrails, ObjectVisibility } from '@quanthea/shared';
import { z } from 'zod';
import type { RegisteredKind, SchemaSnapshot } from '../connectors/_shared/index.ts';
import type { ConnectorRow } from '../db/connector-repository.ts';
import type { QuerySource } from '../query/executor.ts';
import { type ObjectScope, scopeOf, showsObject } from '../query/scope/object-scope.ts';
import { sqlFlavorOf } from '../query/sql-dialects.ts';
import { notInstalled } from './kinds.ts';

/** What dashboard validation needs of a connector, or why its kind cannot run. */
export type StoredConnectorFacts =
  | (Pick<QuerySource, 'language' | 'dialect' | 'scope'> & { guardrails: Guardrails })
  | { readonly notInstalled: string };

/** A connector as it would be with another visibility. */
export interface ProposedVisibility {
  /** The connector's name, as dashboards write it. */
  readonly connector: string;
  /** What dashboard validation would know of it. */
  readonly proposed: StoredConnectorFacts;
  /** The objects of its cached schema that it shows now and would hide. */
  readonly hides: readonly string[];
}

/** Validates a cached schema snapshot. */
export const snapshotSchema = z
  .object({ entities: z.array(z.unknown()) })
  .transform((value) => value as SchemaSnapshot);

/**
 * Which objects a connector shows, by its kind's naming rules. A connector whose kind is gone has
 * no system objects to tell apart.
 *
 * @param kinds - The connector kinds on offer.
 * @param row - The stored connector.
 * @returns The scope.
 */
export function scopeFor(kinds: readonly RegisteredKind[], row: ConnectorRow): ObjectScope {
  const kind = kinds.find((candidate) => candidate.kind === row.kind);
  if (!kind) return { visibility: row.visibility, family: 'plain' };
  return scopeOf(row.visibility, kind.language, sqlFlavorOf(kind));
}

/**
 * What dashboard validation needs of a stored connector.
 *
 * @param kinds - The connector kinds on offer.
 * @param row - The stored connector.
 * @returns The language, the guardrails and the scope, or why its kind cannot run.
 */
export function factsOf(kinds: readonly RegisteredKind[], row: ConnectorRow): StoredConnectorFacts {
  const kind = kinds.find((candidate) => candidate.kind === row.kind);
  if (!kind) return { notInstalled: notInstalled(row.kind) };
  return {
    language: kind.language,
    dialect: sqlFlavorOf(kind),
    guardrails: row.guardrails,
    scope: scopeFor(kinds, row),
  };
}

/**
 * A connector as it would be with another visibility.
 *
 * @param kinds - The connector kinds on offer.
 * @param row - The stored connector.
 * @param visibility - The visibility about to be saved.
 * @param cached - Its cached schema snapshot, if the schema was ever read.
 * @returns Its name, its facts with that visibility, and the cached objects it would hide.
 */
export function proposedVisibility(
  kinds: readonly RegisteredKind[],
  row: ConnectorRow,
  visibility: ObjectVisibility,
  cached: unknown,
): ProposedVisibility {
  const entities = cached === undefined ? [] : snapshotSchema.parse(cached).entities;
  const names = entities.map((entity) => entity.name);
  const next = { ...row, visibility };
  const [before, after] = [scopeFor(kinds, row), scopeFor(kinds, next)];
  const hides = names.filter((name) => showsObject(before, name) && !showsObject(after, name));
  return { connector: row.name, proposed: factsOf(kinds, next), hides };
}
