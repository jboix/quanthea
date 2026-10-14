/**
 * Data from a definition: the panel names the definition, the builder and how it presents the
 * data; the definition's checked body for that language gives the fields that carry the meaning.
 * The body's fields win over the panel's, and the panel's filters are added to the body's. The
 * result is an ordinary builder request, so the panel stores plain queries: a later version of the
 * definition never changes it.
 */
import {
  bodyLanguage,
  type DefinitionMark,
  type DefinitionVersion,
  queryBuilders,
  shapeFits,
} from '@quanthea/shared';
import { z } from 'zod';
import { type DataOf, type DataRequest, dataSchema } from './request.ts';
import { QueryError } from './text.ts';

/**
 * The builders a shape fits in a language, for a message.
 *
 * @param shape - The shape.
 * @param language - The language.
 * @returns Their ids.
 */
function fittingBuilders(shape: Parameters<typeof shapeFits>[0], language: string): string {
  return queryBuilders
    .filter((builder) => builder.language === language && shapeFits(shape, builder.id))
    .map((builder) => builder.id)
    .join(', ');
}

/**
 * The definition a request names, with the body for its builder's language and its connector.
 *
 * @param request - The request.
 * @param definitions - The definitions there are.
 * @returns The version and the body.
 * @throws {QueryError} When the definition is unknown, has no body that fits, or its shape does
 *   not fit the builder.
 */
function bodyFor(request: DataOf<'definition'>, definitions: readonly DefinitionVersion[]) {
  const found = definitions.find((each) => each.definition.id === request.id);
  const known = definitions.map((each) => each.definition.id).join(', ') || 'none';
  if (!found) throw new QueryError(`No definition "${request.id}". The definitions are: ${known}.`);
  const language = queryBuilders.find((builder) => builder.id === request.builder)?.language;
  const body = found.definition.bodies.find(
    (each) =>
      bodyLanguage(each) === language &&
      (each.connectors === undefined || each.connectors.includes(request.connector)),
  );
  if (!body)
    throw new QueryError(
      `"${request.id}" has no checked filters for ${language ?? request.builder} on ${request.connector}. Build the panel from its meaning, with a builder and filters of your own.`,
    );
  if (!shapeFits(body.shape, request.builder))
    throw new QueryError(
      `"${request.id}" is a ${body.shape}: build it with ${fittingBuilders(body.shape, language ?? '')}.`,
    );
  return { found, body };
}

/**
 * Turns a request for a definition into the builder request it stands for, and the mark the
 * panel keeps.
 *
 * @param request - The request.
 * @param definitions - The definitions there are.
 * @returns The builder request, and the definition's id and version.
 * @throws {QueryError} When it cannot be expanded, naming why.
 */
export function expandDefinition(
  request: DataOf<'definition'>,
  definitions: readonly DefinitionVersion[],
): { readonly request: DataRequest; readonly mark: DefinitionMark } {
  const { found, body } = bodyFor(request, definitions);
  const { kind: _kind, ...fields } = body.request;
  const bodyFilters = Array.isArray(fields.filters) ? fields.filters : [];
  const filters = [...bodyFilters, ...request.filters];
  const merged = {
    ...request.options,
    ...fields,
    kind: request.builder,
    connector: request.connector,
    ...(filters.length > 0 ? { filters } : {}),
  };
  const parsed = dataSchema.safeParse(merged);
  if (!parsed.success)
    throw new QueryError(
      `"${request.id}" does not fit ${request.builder}: ${z.prettifyError(parsed.error)}`,
    );
  if (['definition', 'saved', 'raw'].includes(parsed.data.kind))
    throw new QueryError(`A definition is built with a query builder, not ${parsed.data.kind}.`);
  return { request: parsed.data, mark: { id: request.id, version: found.version } };
}
