import { describe, expect, test } from 'bun:test';
import { testConnectorConformance } from '../_shared/test/conformance.ts';
import { fieldTypeOfName, frameValue, inferredType, nativeTypeOf } from './columns.ts';
import { toConnectorError } from './errors.ts';
import { influxdbConnector } from './influxdb-connector.ts';

testConnectorConformance(influxdbConnector, {
  config: { url: 'http://influxdb:8181', database: 'telemetry' },
  secret: { token: 'x' },
  query: { language: 'sql', text: 'SELECT 1', parameters: [] },
  invalidQuery: { language: 'sql', text: 'SELEC 1', parameters: [] },
  sampleField: { entity: 'http_requests', field: 'service' },
  timeRange: { from: new Date(0), to: new Date(1000) },
  live: false,
});

describe('influxdb columns', () => {
  test('types columns from their values, reading zoneless timestamps as UTC', () => {
    expect(inferredType(['2026-09-27T12:02:00', '2026-09-27T12:02:00.123456789'])).toBe('time');
    expect(inferredType([1, null, 2.5])).toBe('number');
    expect(inferredType([true, false])).toBe('boolean');
    expect(inferredType(['checkout-svc', '2026-09-27T12:02:00'])).toBe('string');
    expect(frameValue('time', '2026-09-27T12:02:00.123456789')).toBe(
      Date.UTC(2026, 8, 27, 12, 2, 0, 123),
    );
    expect(frameValue('number', null)).toBeNull();
  });

  test('maps catalog types to frame types, and tags, fields and time to their kind', () => {
    expect(
      ['Int64', 'UInt64', 'Float64', 'Timestamp(ns)', 'Boolean', 'Utf8'].map(fieldTypeOfName),
    ).toEqual(['number', 'number', 'number', 'time', 'boolean', 'string']);
    expect(['Dictionary(Int32, Utf8)', 'Timestamp(ns)', 'Float64'].map(nativeTypeOf)).toEqual([
      'tag',
      'time',
      'field (Float64)',
    ]);
  });
});

describe('influxdb errors', () => {
  test('map text errors to codes with messages that quote no values', () => {
    const cases: [number, string, string, string][] = [
      [404, 'query error: database not found: secret', 'not_found', 'The database does not exist.'],
      [
        400,
        "Error during planning: table 'public.iox.nope' not found",
        'not_found',
        'Table "nope" does not exist.',
      ],
      [
        500,
        'Schema error: No field named nope. Valid fields are a, b.',
        'not_found',
        'Column "nope" does not exist.',
      ],
      [
        400,
        'Error during planning: DML not supported: Insert Into',
        'rejected',
        'The query tried to write; connectors only read.',
      ],
      [
        400,
        'SQL error: ParserError("Expected: an SQL statement, found: secret")',
        'syntax',
        'The query has a syntax error.',
      ],
      [
        500,
        "Arrow error: Cast error: Cannot cast string 'secret' to value of Int64 type",
        'syntax',
        'An argument or value has the wrong type or format.',
      ],
      [
        401,
        '{"error": "the request was not authenticated"}',
        'authentication',
        'InfluxDB refused the token.',
      ],
      [503, 'secret trouble', 'internal', 'InfluxDB failed (HTTP 503).'],
    ];
    for (const [status, text, code, safe] of cases) {
      const error = toConnectorError(status, text);
      expect(error).toMatchObject({ code, safeMessage: safe });
    }
  });
});
