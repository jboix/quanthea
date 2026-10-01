/**
 * Reads an API's OpenAPI (or Swagger 2) description into the catalog: one entity per operation the
 * connector allows, named `GET /orders/{id}`, with its parameters in the description and the fields
 * of the rows its JSON response holds. Only local `$ref`s are followed, a few levels deep.
 */
import type { FieldType } from '@querent/shared';
import type { SchemaEntity, SchemaField } from '../_shared/index.ts';
import { atPointer } from './extract.ts';
import type { PathRules } from './paths.ts';

/** A JSON Schema, as far as the catalog reads it. */
interface JsonSchema {
  readonly $ref?: string;
  readonly type?: string | readonly string[];
  readonly format?: string;
  readonly description?: string;
  readonly enum?: readonly unknown[];
  readonly items?: JsonSchema;
  readonly properties?: Readonly<Record<string, JsonSchema>>;
  readonly allOf?: readonly JsonSchema[];
}

/** An operation's parameter. */
interface Parameter {
  readonly $ref?: string;
  readonly name?: string;
  readonly in?: string;
  readonly required?: boolean;
  readonly description?: string;
  readonly schema?: JsonSchema;
  readonly type?: string;
  readonly enum?: readonly unknown[];
}

/** An operation. */
interface Operation {
  readonly summary?: string;
  readonly description?: string;
  readonly parameters?: readonly Parameter[];
  readonly responses?: Readonly<Record<string, Response>>;
}

/** A response: OpenAPI 3 content, or a Swagger 2 schema. */
interface Response {
  readonly $ref?: string;
  readonly content?: Readonly<Record<string, { readonly schema?: JsonSchema }>>;
  readonly schema?: JsonSchema;
}

/** The parts of a description the catalog reads. */
export interface ApiDescription {
  readonly info?: { readonly title?: string; readonly version?: string };
  readonly paths?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
}

/** An operation the catalog lists, with what sampling reads. */
export interface DescribedOperation {
  /** The entity. */
  readonly entity: SchemaEntity;
  /** The listed values of each field and parameter that has an `enum`. */
  readonly values: ReadonlyMap<string, readonly string[]>;
}

/** How many `$ref`s a schema follows, and how deep objects are walked. */
const maxDepth = 6;

/** The most operations the catalog lists. */
const maxOperations = 300;

/**
 * Follows local `$ref`s.
 *
 * @param document - The description.
 * @param value - A schema, parameter or response that may be a reference.
 * @returns What it refers to, or itself.
 */
function resolve<T extends { readonly $ref?: string }>(document: ApiDescription, value: T): T {
  let current = value;
  for (let hops = 0; current?.$ref !== undefined && hops < maxDepth; hops += 1) {
    if (!current.$ref.startsWith('#')) return current;
    current = atPointer(document, current.$ref.slice(1)) as T;
  }
  return current ?? value;
}

/**
 * The frame type of a schema.
 *
 * @param schema - The schema.
 * @returns `number`, `boolean`, `time` for dates, else `string`.
 */
function fieldTypeOf(schema: JsonSchema): FieldType {
  const type = typesOf(schema).find((each) => each !== 'null');
  if (type === 'integer' || type === 'number') return 'number';
  if (type === 'boolean') return 'boolean';
  return schema.format === 'date-time' || schema.format === 'date' ? 'time' : 'string';
}

/**
 * The fields of a row schema: its properties, objects walked to dotted names.
 *
 * @param document - The description.
 * @param schema - The row schema.
 * @param prefix - The dotted name of the enclosing object.
 * @param depth - How deep the walk is.
 * @returns The fields with their listed values.
 */
function rowFields(
  document: ApiDescription,
  schema: JsonSchema,
  prefix = '',
  depth = 0,
): [SchemaField, readonly string[] | undefined][] {
  const resolved = merged(document, schema);
  const properties = Object.entries(resolved.properties ?? {});
  if (properties.length === 0 || depth >= maxDepth) {
    const field = {
      name: prefix || 'value',
      nativeType: nativeTypeOf(resolved),
      type: fieldTypeOf(resolved),
      ...describedBy(resolved),
    };
    return [[field, resolved.enum?.map(String)]];
  }
  return properties.flatMap(([name, property]) =>
    rowFields(document, property, prefix ? `${prefix}.${name}` : name, depth + 1),
  );
}

/**
 * A schema with its references followed and its `allOf` parts merged.
 *
 * @param document - The description.
 * @param schema - The schema.
 * @returns The merged schema.
 */
function merged(document: ApiDescription, schema: JsonSchema): JsonSchema {
  const resolved = resolve(document, schema);
  if (!resolved.allOf) return resolved;
  const parts = resolved.allOf.map((part) => resolve(document, part));
  const properties = Object.assign(
    {},
    ...parts.map((part) => part.properties ?? {}),
    resolved.properties,
  );
  return { ...resolved, properties };
}

/**
 * The type a schema has, as the API writes it.
 *
 * @param schema - The schema.
 * @returns Such as `string (date-time)` or `array`.
 */
function nativeTypeOf(schema: JsonSchema): string {
  const types = typesOf(schema);
  const type = types.length > 0 ? types.join(' | ') : 'any';
  return schema.format ? `${type} (${schema.format})` : type;
}

/**
 * The types a schema names, one or several.
 *
 * @param schema - The schema.
 * @returns The types, empty when it names none.
 */
function typesOf(schema: JsonSchema): readonly string[] {
  if (schema.type === undefined) return [];
  return typeof schema.type === 'string' ? [schema.type] : schema.type;
}

/**
 * The description of a schema, when it has one.
 *
 * @param schema - The schema.
 * @returns `{ description }` or nothing.
 */
function describedBy(schema: JsonSchema): { description?: string } {
  return schema.description ? { description: schema.description } : {};
}

/**
 * Where the rows of a response are, and their schema: the response itself when it is an array,
 * the first property holding an array of objects, or the response as one row.
 *
 * @param document - The description.
 * @param schema - The schema of the response.
 * @returns The rows pointer and the row schema.
 */
function rowsOf(
  document: ApiDescription,
  schema: JsonSchema,
): { pointer: string; row: JsonSchema } {
  const resolved = merged(document, schema);
  if (resolved.items) return { pointer: '', row: resolved.items };
  for (const [name, property] of Object.entries(resolved.properties ?? {})) {
    const items = resolve(document, property).items;
    if (items && merged(document, items).properties) return { pointer: `/${name}`, row: items };
  }
  return { pointer: '', row: resolved };
}

/**
 * The JSON schema of an operation's successful response.
 *
 * @param document - The description.
 * @param operation - The operation.
 * @returns The schema, if the description gives one.
 */
function responseSchema(document: ApiDescription, operation: Operation): JsonSchema | undefined {
  const responses = operation.responses ?? {};
  const success = responses['200'] ?? responses['201'] ?? responses.default;
  if (!success) return undefined;
  const response = resolve(document, success);
  const json = Object.entries(response.content ?? {}).find(([type]) => type.includes('json'))?.[1];
  return json?.schema ?? response.schema;
}

/**
 * A parameter as one line of the description.
 *
 * @param parameter - The parameter.
 * @returns Such as `status (query, string, required)`.
 */
function parameterLine(parameter: Parameter): string {
  const type = parameter.schema ? nativeTypeOf(parameter.schema) : (parameter.type ?? 'any');
  const required = parameter.required ? ', required' : '';
  const about = parameter.description ? `: ${parameter.description}` : '';
  return `${parameter.name} (${parameter.in}, ${type}${required})${about}`;
}

/**
 * The path and query parameters of an operation, its path's shared ones first.
 *
 * @param document - The description.
 * @param operation - The operation.
 * @param shared - The parameters of its path.
 * @returns The parameters.
 */
function parametersOf(
  document: ApiDescription,
  operation: Operation,
  shared: readonly Parameter[],
): Parameter[] {
  return [...shared, ...(operation.parameters ?? [])]
    .map((parameter) => resolve(document, parameter))
    .filter((parameter) => parameter.in === 'path' || parameter.in === 'query');
}

/**
 * The values the description lists for the fields and the parameters of an operation.
 *
 * @param fields - The fields with their listed values.
 * @param parameters - The parameters.
 * @returns The listed values by name.
 */
function listedValues(
  fields: readonly [SchemaField, readonly string[] | undefined][],
  parameters: readonly Parameter[],
): Map<string, readonly string[]> {
  const values = new Map<string, readonly string[]>();
  for (const [field, listed] of fields) if (listed) values.set(field.name, listed);
  for (const parameter of parameters) {
    const listed = parameter.schema?.enum ?? parameter.enum;
    if (listed && parameter.name) values.set(parameter.name, listed.map(String));
  }
  return values;
}

/**
 * Describes one operation.
 *
 * @param document - The description.
 * @param name - `METHOD /path`.
 * @param operation - The operation.
 * @param shared - The parameters of its path.
 * @returns The described operation.
 */
function describeOperation(
  document: ApiDescription,
  name: string,
  operation: Operation,
  shared: readonly Parameter[],
): DescribedOperation {
  const parameters = parametersOf(document, operation, shared);
  const schema = responseSchema(document, operation);
  const rows = schema ? rowsOf(document, schema) : undefined;
  const fields = rows ? rowFields(document, rows.row) : [];
  const sentences = [
    operation.summary ?? operation.description,
    parameters.length > 0 ? `Parameters: ${parameters.map(parameterLine).join('; ')}.` : undefined,
    rows?.pointer ? `Rows at ${rows.pointer}.` : undefined,
  ].filter(Boolean);
  const entity: SchemaEntity = {
    name,
    kind: 'endpoint',
    ...(sentences.length > 0 ? { description: sentences.join(' ') } : {}),
    fields: fields.map(([field]) => field),
  };
  return { entity, values: listedValues(fields, parameters) };
}

/**
 * The operations a connector allows, described.
 *
 * @param document - The parsed description.
 * @param methods - The methods the connector allows, lowercase.
 * @param paths - The paths the connector allows.
 * @returns The operations, by entity name.
 */
export function describeApi(
  document: ApiDescription,
  methods: readonly string[],
  paths: PathRules,
): Map<string, DescribedOperation> {
  const operations = new Map<string, DescribedOperation>();
  const allowed = Object.entries(document.paths ?? {}).filter(([path]) =>
    paths.allows(path.replace(/\{[^}]*\}/g, 'x')),
  );
  for (const [path, item] of allowed) {
    const shared = (item.parameters ?? []) as readonly Parameter[];
    const present = methods.filter((method) => item[method] !== undefined);
    for (const method of present.slice(0, Math.max(0, maxOperations - operations.size))) {
      const name = `${method.toUpperCase()} ${path}`;
      operations.set(name, describeOperation(document, name, item[method] as Operation, shared));
    }
  }
  return operations;
}
