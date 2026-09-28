import { describe, expect, test } from 'bun:test';
import { fieldKey, initialValues, readPart, settingFields } from './settings-form.ts';

const configSchema = {
  type: 'object',
  properties: {
    host: { type: 'string', title: 'Host', description: 'The server.', examples: ['db.internal'] },
    port: { type: 'integer', title: 'Port', default: 5432 },
    tls: { type: 'string', enum: ['verify-full', 'disable'], default: 'verify-full' },
    verifyTls: { type: 'boolean', default: true },
    ratio: { type: 'number' },
  },
  required: ['host'],
};

const secretSchema = {
  type: 'object',
  properties: { password: { type: 'string', title: 'Password' } },
  required: ['password'],
};

const fields = [...settingFields(configSchema, 'config'), ...settingFields(secretSchema, 'secret')];

describe('settingFields', () => {
  test('reads titles, hints, examples, requirements and controls in schema order', () => {
    expect(fields.map((field) => [fieldKey(field), field.control, field.required])).toEqual([
      ['config.host', 'text', true],
      ['config.port', 'integer', false],
      ['config.tls', 'select', false],
      ['config.verifyTls', 'switch', false],
      ['config.ratio', 'number', false],
      ['secret.password', 'password', true],
    ]);
    expect(fields[0]).toMatchObject({
      title: 'Host',
      description: 'The server.',
      example: 'db.internal',
    });
    expect(fields[2]?.options).toEqual(['verify-full', 'disable']);
    expect(fields[3]?.title).toBe('verifyTls');
  });

  test('gives no fields for a schema without properties', () => {
    expect(settingFields({ type: 'object' }, 'secret')).toEqual([]);
    expect(settingFields(null, 'config')).toEqual([]);
  });
});

describe('initialValues', () => {
  test('starts from the defaults, with secrets empty', () => {
    expect(initialValues(fields)).toEqual({
      'config.host': '',
      'config.port': '5432',
      'config.tls': 'verify-full',
      'config.verifyTls': true,
      'config.ratio': '',
      'secret.password': '',
    });
  });

  test('starts from the stored configuration when editing', () => {
    const values = initialValues(fields, { host: 'db', port: 5433, verifyTls: false });
    expect(values).toMatchObject({ 'config.host': 'db', 'config.port': '5433' });
    expect(values['config.verifyTls']).toBe(false);
  });
});

describe('readPart', () => {
  test('sends numbers and booleans typed, and leaves empty text out', () => {
    const values = { ...initialValues(fields), 'config.host': ' db ', 'config.ratio': '0.5' };
    expect(readPart(fields, values, 'config')).toEqual({
      host: 'db',
      port: 5432,
      tls: 'verify-full',
      verifyTls: true,
      ratio: 0.5,
    });
    expect(readPart(fields, values, 'secret')).toEqual({});
  });

  test('keeps passwords as typed and sends text that is not a number for the server to report', () => {
    const values = { 'config.port': 'abc', 'secret.password': ' pw ' };
    expect(readPart(fields, values, 'config')).toEqual({ port: 'abc' });
    expect(readPart(fields, values, 'secret')).toEqual({ password: ' pw ' });
  });
});
