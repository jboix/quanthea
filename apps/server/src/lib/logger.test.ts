import { describe, expect, test } from 'bun:test';
import { createLogger, errorFields } from './logger.ts';

/**
 * Creates a logger whose output is kept per stream.
 *
 * @param minimum - The least severe level written.
 * @returns The logger and the lines of each stream.
 */
function capture(minimum: Parameters<typeof createLogger>[0]) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const logger = createLogger(minimum, {
    stdout: (line) => stdout.push(line),
    stderr: (line) => stderr.push(line),
  });
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
