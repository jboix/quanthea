/**
 * Turns the answer of a read command into a table, by the command's shape: one value; key and
 * value pairs (`MGET`, `HMGET`, `HGETALL`); members, with their scores when asked
 * (`ZRANGE … WITHSCORES`); stream entries with their time and fields (`XRANGE`); `INFO` lines.
 */
import type { Field, FieldType, Frame } from '@querent/shared';
import { createFrameBuilder, type ExecutionContext, type RedisQuery } from '../_shared/index.ts';

/** A table before its columns are typed. */
interface Table {
  /** The column names. */
  readonly columns: readonly string[];
  /** The rows, in column order. */
  readonly rows: readonly (readonly unknown[])[];
  /** Columns whose type is known whatever the values, such as a stream's time. */
  readonly types?: Readonly<Record<string, FieldType>>;
}

/** Commands that answer one value. */
const scalarCommands = new Set([
  'GET',
  'STRLEN',
  'EXISTS',
  'TYPE',
  'TTL',
  'PTTL',
  'HGET',
  'HLEN',
  'HEXISTS',
  'LLEN',
  'LINDEX',
  'SCARD',
  'SISMEMBER',
  'ZCARD',
  'ZCOUNT',
  'ZSCORE',
  'ZRANK',
  'ZREVRANK',
  'XLEN',
  'DBSIZE',
]);

/** Commands that answer a list of values. */
const listCommands = new Set(['HKEYS', 'HVALS', 'LRANGE', 'SMEMBERS']);

/**
 * Pairs a flat list, as RESP2 answers a hash: `[k1, v1, k2, v2]`.
 *
 * @param flat - The list.
 * @returns The pairs.
 */
function pairs(flat: readonly unknown[]): [unknown, unknown][] {
  const result: [unknown, unknown][] = [];
  for (let index = 0; index + 1 < flat.length; index += 2)
    result.push([flat[index], flat[index + 1]]);
  return result;
}

/**
 * The table of a hash answer, an object in RESP3 or a flat list in RESP2.
 *
 * @param answer - The answer.
 * @returns Field and value rows.
 */
function hashTable(answer: unknown): Table {
  const entries = Array.isArray(answer)
    ? pairs(answer)
    : Object.entries((answer ?? {}) as Record<string, unknown>);
  return { columns: ['field', 'value'], rows: entries };
}

/**
 * The table of a sorted set answer: members, with their scores when the answer has them.
 *
 * @param answer - The answer.
 * @returns Member rows, or member and score rows.
 */
function membersTable(answer: unknown): Table {
  const items = Array.isArray(answer) ? answer : [];
  if (items.length > 0 && items.every(Array.isArray))
    return { columns: ['member', 'score'], rows: items as unknown[][] };
  return { columns: ['member'], rows: items.map((item) => [item]) };
}

/**
 * The table of stream entries: the id, its time, and a column per field.
 *
 * @param answer - The entries, as `[id, [field, value, …]]`.
 * @returns The rows.
 */
function streamTable(answer: unknown): Table {
  const entries = (Array.isArray(answer) ? answer : []) as [string, unknown[]][];
  const records = entries.map(([id, fields]) => ({
    id,
    fields: Object.fromEntries(pairs(fields ?? [])),
  }));
  const names = [...new Set(records.flatMap((record) => Object.keys(record.fields)))];
  const rows = records.map((record) => [
    record.id,
    Number(String(record.id).split('-')[0]),
    ...names.map((name) => record.fields[name] ?? null),
  ]);
  return { columns: ['id', 'time', ...names], rows, types: { time: 'time' } };
}

/**
 * The table of `INFO`: one row per line, with its section.
 *
 * @param answer - The text.
 * @returns Section, key and value rows.
 */
function infoTable(answer: unknown): Table {
  let section = '';
  const rows: string[][] = [];
  for (const line of String(answer ?? '').split(/\r?\n/)) {
    if (line.startsWith('# ')) section = line.slice(2).trim();
    const colon = line.indexOf(':');
    if (colon > 0 && !line.startsWith('#'))
      rows.push([section, line.slice(0, colon), line.slice(colon + 1)]);
  }
  return { columns: ['section', 'key', 'value'], rows };
}

/**
 * The table of an answer, by the command's shape.
 *
 * @param query - The command and its arguments.
 * @param answer - The answer.
 * @returns The table.
 */
export function tableOf(query: RedisQuery, answer: unknown): Table {
  const { command, args } = query;
  if (scalarCommands.has(command)) return { columns: ['value'], rows: [[answer]] };
  const list = Array.isArray(answer) ? answer : [];
  if (command === 'MGET')
    return { columns: ['key', 'value'], rows: list.map((value, index) => [args[index], value]) };
  if (command === 'HMGET')
    return {
      columns: ['field', 'value'],
      rows: list.map((value, index) => [args[index + 1], value]),
    };
  if (command === 'HGETALL') return hashTable(answer);
  if (listCommands.has(command)) return { columns: ['value'], rows: list.map((value) => [value]) };
  if (command.startsWith('X')) return streamTable(answer);
  if (command === 'INFO') return infoTable(answer);
  return membersTable(answer);
}

/**
 * Whether a value reads as a number.
 *
 * @param value - The value.
 * @returns `true` for a number or numeric text.
 */
function numeric(value: unknown): boolean {
  if (typeof value === 'number') return Number.isFinite(value);
  return typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value));
}

/**
 * The type of a column: as known, else a number when every value is one, else text.
 *
 * @param table - The table.
 * @param index - The column.
 * @returns The type.
 */
function columnType(table: Table, index: number): FieldType {
  const known = table.types?.[table.columns[index] ?? ''];
  if (known) return known;
  const values = table.rows
    .map((row) => row[index])
    .filter((value) => value !== null && value !== undefined);
  return values.length > 0 && values.every(numeric) ? 'number' : 'string';
}

/**
 * A value as the frame holds it in a column of a type.
 *
 * @param type - The column type.
 * @param value - The value from the answer.
 * @returns A number, text, or `null`.
 */
function cellValue(type: FieldType, value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (type !== 'string') return Number(value);
  return typeof value === 'string' ? value : JSON.stringify(value);
}

/**
 * The frame of an answer.
 *
 * @param query - The command and its arguments.
 * @param answer - The answer.
 * @param context - The execution context.
 * @param durationMs - How long the command took.
 * @returns The frame.
 */
export function frameOf(
  query: RedisQuery,
  answer: unknown,
  context: ExecutionContext,
  durationMs: number,
): Frame {
  const table = tableOf(query, answer);
  const fields: Field[] = table.columns.map((name, index) => ({
    name,
    type: columnType(table, index),
  }));
  const builder = createFrameBuilder({ refId: context.refId, fields, maxRows: context.maxRows });
  for (const row of table.rows) {
    const values = fields.map((field, index) => cellValue(field.type, row[index]));
    if (!builder.add(values)) break;
  }
  return builder.build(durationMs);
}
