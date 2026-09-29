import { describe, expect, test } from 'bun:test';
import type { AuthMode } from '@querent/shared';
import { createSettingsStore, type SettingsStore } from '../settings/settings-store.ts';
import { captureLogs } from '../test/fixtures.ts';
import { resolveAuthMode } from './auth-mode.ts';
import { createAuthenticator } from './authenticator.ts';

/**
 * Creates a settings store whose auth section holds `mode`.
 *
 * @param mode - The stored authentication mode.
 * @returns The store.
 */
function storedMode(mode: AuthMode): SettingsStore {
  return createSettingsStore({ read: () => JSON.stringify({ mode }), write: () => undefined });
}

describe('resolveAuthMode', () => {
  test('uses the stored mode when there is no override', () => {
    const { logger, lines } = captureLogs();
    expect(resolveAuthMode(undefined, storedMode('accounts'), logger)).toBe('accounts');
    expect(lines).toEqual([]);
  });

  test('lets QUERENT_AUTH_MODE override the stored mode, with a warning', () => {
    const { logger, lines } = captureLogs();
    expect(resolveAuthMode('none', storedMode('accounts'), logger)).toBe('none');
    expect(lines).toContainEqual(
      expect.objectContaining({ level: 'warn', stored: 'accounts', override: 'none' }),
    );
  });
});

describe('createAuthenticator', () => {
  test('makes every request the anonymous admin in none mode', async () => {
    const principal = await createAuthenticator('none').authenticate(new Request('http://x/'));
    expect(principal).toEqual({ id: 'anonymous', name: 'Anonymous', role: 'admin' });
  });

  test('refuses accounts mode without sessions', () => {
    expect(() => createAuthenticator('accounts')).toThrow('QUERENT_SESSION_KEY');
  });
});
