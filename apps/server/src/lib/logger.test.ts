import { describe, expect, test } from 'bun:test';
import { createLogger, errorFields, type LogFormat } from './logger.ts';

/**
 * Creates a logger whose output is kept per stream.
 *
 * @param minimum - The least severe level written.
 * @param format - How lines are written.
 * @returns The logger and the lines of each stream.
 */
function capture(minimum: Parameters<typeof createLogger>[0], format: LogFormat = 'json') {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const sinks = {
    stdout: (line: string) => stdout.push(line),
    stderr: (line: string) => stderr.push(line),
  };
  const logger = createLogger(minimum, sinks, format);
  return { logger, stdout, stderr };
}

describe('createLogger', () => {
  test('writes one JSON line with the time, level, message and fields', () => {
    const { logger, stdout } = capture('info');
    logger.info('hello', { requestId: 'r1' });
    expect(stdout).toHaveLength(1);
    expect(stdout[0]).toEndWith('\n');
    expect(JSON.parse(stdout[0] ?? '')).toMatchObject({
      level: 'info',
      message: 'hello',
      requestId: 'r1',
    });
  });

  test('drops lines below the minimum level and sends warnings and errors to stderr', () => {
    const { logger, stdout, stderr } = capture('info');
    logger.debug('hidden');
    logger.info('shown');
    logger.warn('careful');
    logger.error('broken');
    expect(stdout.map((line) => JSON.parse(line).message)).toEqual(['shown']);
    expect(stderr.map((line) => JSON.parse(line).message)).toEqual(['careful', 'broken']);
  });
});

describe('text lines', () => {
  test('write the time, the level, the message and the fields as key=value', () => {
    const { logger, stdout } = capture('info', 'text');
    logger.info('request', { method: 'GET', path: '/api/threads', status: 200, note: 'two words' });
    expect(stdout[0]).toMatch(
      /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.\d{3} INFO {2}request method=GET path=\/api\/threads status=200 note="two words"\n$/,
    );
  });

  test('put an error’s stack on the lines below', () => {
    const { logger, stderr } = capture('info', 'text');
    logger.error('run failed', { threadId: 't1', ...errorFields(new Error('boom')) });
    const [first, second] = (stderr[0] ?? '').split('\n');
    expect(first).toEndWith('ERROR run failed threadId=t1');
    expect(second).toBe('Error: boom');
  });
});

describe('errorFields', () => {
  test('keeps the name, message and stack of an Error', () => {
    expect(errorFields(new TypeError('bad'))).toMatchObject({
      error: { name: 'TypeError', message: 'bad' },
    });
  });

  test('stringifies anything else', () => {
    expect(errorFields(42)).toEqual({ error: '42' });
  });
});
