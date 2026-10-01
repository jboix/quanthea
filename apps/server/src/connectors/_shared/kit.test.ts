import { describe, expect, test } from 'bun:test';
import * as publicKit from '@querent/plugin-kit';
import { hostKit } from '@querent/plugin-kit/host';
import { createTestKit } from '@querent/plugin-kit/testing';
import { z } from 'zod';
import { ConnectorError } from './index.ts';

describe('the public kit', () => {
  test('holds types and the kit version only, none of the server’s policy lists', () => {
    expect(Object.keys(publicKit)).toEqual(['kitVersion']);
    expect(publicKit.kitVersion).toBe(1);
  });

  test('tests plugins against the live kit itself, not a second implementation', () => {
    expect(createTestKit()).toBe(hostKit);
  });

  test('hands plugins the server’s own Zod and error class', () => {
    const kit = createTestKit();
    expect(kit.z).toBe(z);
    expect(new kit.ConnectorError('timeout', 'Too slow.')).toBeInstanceOf(ConnectorError);
    expect(Object.isFrozen(kit)).toBe(true);
  });

  test('builds a plugin’s kinds whose schemas the server reads', () => {
    const plugin = (kit: publicKit.ConnectorKit) => [
      kit.defineConnector({
        kind: 'example',
        displayName: 'Example',
        language: 'sql',
        dialect: 'postgres',
        configSchema: kit.z.object({ host: kit.z.string().meta({ title: 'Host' }) }),
        secretSchema: kit.z.object({ password: kit.z.string().optional() }),
        open: () => {
          throw new kit.ConnectorError('unreachable', 'Not in this test.');
        },
      }),
    ];
    const [kind] = plugin(createTestKit());
    if (!kind) throw new Error('No kind.');
    const form = z.toJSONSchema(kind.configSchema, { io: 'input' }) as { properties: object };
    expect(Object.keys(form.properties)).toEqual(['host']);
    expect(() => kind.open({ config: { host: 'x' }, secret: {} })).toThrow(ConnectorError);
  });
});
