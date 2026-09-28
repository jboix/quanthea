/**
 * Builds the settings form of a connector kind from the JSON Schemas it publishes, and reads the
 * values back. Nothing here knows a kind, so a new kind needs no web code.
 */

/** How a setting is edited. */
export type SettingControl = 'text' | 'password' | 'integer' | 'number' | 'select' | 'switch';

/** One setting of a kind's form. */
export interface SettingField {
  /** `config` is stored in plain text; `secret` is sealed and never shown again. */
  readonly part: 'config' | 'secret';
  /** The property name. */
  readonly name: string;
  /** The label, from the schema's `title`. */
  readonly title: string;
  /** The hint under the input, from the schema's `description`. */
  readonly description: string | undefined;
  /** The placeholder, from the schema's first example. */
  readonly example: string | undefined;
  /** Whether the kind requires a value. */
  readonly required: boolean;
  /** How the value is edited. */
  readonly control: SettingControl;
  /** The choices of a `select`. */
  readonly options: readonly string[];
  /** The schema's default. */
  readonly defaultValue: unknown;
}

/** A value being edited: text for inputs and selects, a boolean for switches. */
export type SettingValue = string | boolean;

/** The values of a form, keyed by {@link fieldKey}. */
export type SettingValues = Readonly<Record<string, SettingValue>>;

/**
 * Reads a JSON value as an object.
 *
 * @param value - Any JSON value.
 * @returns The object, or an empty one for anything else.
 */
function asObject(value: unknown): Readonly<Record<string, unknown>> {
  const isObject = typeof value === 'object' && value !== null && !Array.isArray(value);
  return isObject ? (value as Record<string, unknown>) : {};
}

/**
 * Reads a JSON value as text.
 *
 * @param value - Any JSON value.
 * @returns The string, or `undefined` for anything else.
 */
function asText(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/**
 * Picks the control for a property.
 *
 * @param property - The property's JSON Schema.
 * @param part - Which part it belongs to. Secret text is a password input.
 * @returns The control.
 */
function controlOf(
  property: Readonly<Record<string, unknown>>,
  part: SettingField['part'],
): SettingControl {
  if (Array.isArray(property.enum)) return 'select';
  if (property.type === 'boolean') return 'switch';
  if (property.type === 'integer' || property.type === 'number') return property.type;
  return part === 'secret' ? 'password' : 'text';
}

/**
 * Builds one field from its property schema.
 *
 * @param part - Which part it belongs to.
 * @param name - The property name.
 * @param property - The property's JSON Schema.
 * @param required - The names the object schema requires.
 * @returns The field.
 */
function fieldOf(
  part: SettingField['part'],
  name: string,
  property: Readonly<Record<string, unknown>>,
  required: ReadonlySet<string>,
): SettingField {
  const examples = Array.isArray(property.examples) ? property.examples : [];
  return {
    part,
    name,
    title: asText(property.title) ?? name,
    description: asText(property.description),
    example: examples.length > 0 ? String(examples[0]) : undefined,
    required: required.has(name),
    control: controlOf(property, part),
    options: Array.isArray(property.enum) ? property.enum.map(String) : [],
    defaultValue: property.default,
  };
}

/**
 * The fields of one part, in the schema's order.
 *
 * @param schema - The part's JSON Schema, an object schema.
 * @param part - Which part it is.
 * @returns The fields.
 */
export function settingFields(schema: unknown, part: SettingField['part']): SettingField[] {
  const objectSchema = asObject(schema);
  const required = new Set(Array.isArray(objectSchema.required) ? objectSchema.required : []);
  return Object.entries(asObject(objectSchema.properties)).map(([name, property]) =>
    fieldOf(part, name, asObject(property), required),
  );
}

/**
 * The key of a field in the form values and in the server's validation issues.
 *
 * @param field - The field.
 * @returns `part.name`, such as `config.host`.
 */
export function fieldKey(field: Pick<SettingField, 'part' | 'name'>): string {
  return `${field.part}.${field.name}`;
}

/**
 * The value a field starts with.
 *
 * @param field - The field.
 * @param current - The stored value, if any.
 * @returns The stored value, else the default, as the control edits it.
 */
function initialValue(field: SettingField, current: unknown): SettingValue {
  const value = current ?? field.defaultValue;
  if (field.control === 'switch') return value === true;
  return value === undefined || value === null ? '' : String(value);
}

/**
 * The values a form starts with. Secrets always start empty: they are never sent back.
 *
 * @param fields - The fields of both parts.
 * @param config - The stored configuration, when editing.
 * @returns The values.
 */
export function initialValues(
  fields: readonly SettingField[],
  config: Readonly<Record<string, unknown>> = {},
): SettingValues {
  return Object.fromEntries(
    fields.map((field) => [
      fieldKey(field),
      initialValue(field, field.part === 'config' ? config[field.name] : undefined),
    ]),
  );
}

/**
 * Turns an edited value into the value sent to the server.
 *
 * @param field - The field.
 * @param value - The edited value.
 * @returns The value, or `undefined` for empty text so the kind's default (or the stored secret)
 *   applies. Text that is not a number is sent as is, for the server to report.
 */
function sentValue(field: SettingField, value: SettingValue | undefined): unknown {
  if (typeof value === 'boolean') return value;
  if (value === undefined || value.trim() === '') return undefined;
  if (field.control === 'password') return value;
  if (field.control !== 'integer' && field.control !== 'number') return value.trim();
  const number = Number(value);
  return Number.isFinite(number) ? number : value;
}

/**
 * Reads one part back from the form values.
 *
 * @param fields - The fields of both parts.
 * @param values - The form values.
 * @param part - The part to read.
 * @returns The part's settings, without empty values.
 */
export function readPart(
  fields: readonly SettingField[],
  values: SettingValues,
  part: SettingField['part'],
): Record<string, unknown> {
  const entries = fields
    .filter((field) => field.part === part)
    .map((field) => [field.name, sentValue(field, values[fieldKey(field)])] as const)
    .filter(([, value]) => value !== undefined);
  return Object.fromEntries(entries);
}
