import { describe, expect, test } from 'bun:test';
import { ConnectorError } from '../_shared/index.ts';
import { elasticsearchFindings, opensearchAccess, readOnlySetups, searchAccess } from './access.ts';
import type { SearchApi } from './api.ts';

/**
 * An API that answers the question about the user with one status and body, and records what it
 * was asked.
 *
 * @param status - The status.
 * @param body - The answer.
 * @returns The API and the paths asked.
 */
function apiAnswering(status: number, body: unknown): { api: SearchApi; asked: string[] } {
  const asked: string[] = [];
  const refuse = () => Promise.reject(new ConnectorError('internal', 'Not asked in this test.'));
  const api: SearchApi = {
    request: refuse,
    server: refuse,
    ask: (path) => {
      asked.push(path);
      return Promise.resolve({ status, body });
    },
  };
  return { api, asked };
}

const signal = AbortSignal.timeout(1000);

describe('what an Elasticsearch user may do', () => {
  test('a user with read privileges only is read-only', async () => {
    const { api, asked } = apiAnswering(200, {
      cluster: ['monitor', 'manage_own_api_key'],
      indices: [{ names: ['logs-*'], privileges: ['read', 'view_index_metadata', 'monitor'] }],
      run_as: [],
    });
    expect(await searchAccess(api, 'Elasticsearch', signal)).toMatchObject({
      readOnly: true,
      canDo: [],
    });
    expect(asked).toEqual(['/_security/user/_privileges']);
  });

  test('a superuser can write, with what it holds', async () => {
    const { api } = apiAnswering(200, {
      cluster: ['all'],
      indices: [{ names: ['*'], privileges: ['all'] }],
      run_as: ['*'],
    });
    expect(await searchAccess(api, 'Elasticsearch', signal)).toEqual({
      readOnly: false,
      canDo: [
        'It holds the cluster privileges all.',
        'It holds all on *.',
        'It can act as the users *.',
      ],
      sentence: 'The user can write.',
    });
  });

  test('names each privilege that writes or manages, and the indices it holds on', () => {
    expect(
      elasticsearchFindings({
        cluster: ['monitor', 'manage_index_templates', 'read_ilm'],
        indices: [
          { names: ['logs-*'], privileges: ['read', 'write'] },
          { names: ['metrics-*'], privileges: ['read'] },
          { names: ['tmp-*', 'scratch'], privileges: ['create_index', 'delete_index', 'manage'] },
        ],
      }),
    ).toEqual([
      'It holds the cluster privileges manage_index_templates.',
      'It holds write on logs-*.',
      'It holds create_index, delete_index, manage on tmp-*, scratch.',
    ]);
  });

  test('a server without security takes every request, so the connection can write', async () => {
    const { api } = apiAnswering(400, {
      error: 'no handler found for uri [/_security/user/_privileges] and method [GET]',
    });
    const access = await searchAccess(api, 'Elasticsearch', signal);
    expect(access.readOnly).toBe(false);
    expect(access.canDo[0]).toContain('asks for no sign-in');
  });

  test('an answer that does not say is unknown, never read-only', async () => {
    for (const [status, body] of [
      [403, { error: { type: 'security_exception' } }],
      [401, { error: { type: 'security_exception' } }],
      [500, undefined],
      [400, { error: { type: 'illegal_argument_exception' } }],
    ] as const) {
      const access = await searchAccess(apiAnswering(status, body).api, 'Elasticsearch', signal);
      expect(access).toMatchObject({ readOnly: null, canDo: [] });
      expect(access.sentence).toContain('unknown');
    }
  });

  test('a server that cannot be asked is unknown', async () => {
    const { api } = apiAnswering(200, {});
    const failing = { ...api, ask: () => Promise.reject(new Error('down')) };
    expect((await searchAccess(failing, 'Elasticsearch', signal)).readOnly).toBeNull();
  });
});

describe('what an OpenSearch user may do', () => {
  test('asks the security plugin who the user is', async () => {
    const { api, asked } = apiAnswering(200, { user_name: 'dash', roles: ['readall'] });
    expect(await searchAccess(api, 'OpenSearch', signal)).toMatchObject({ readOnly: true });
    expect(asked).toEqual(['/_plugins/_security/authinfo']);
  });

  test('all_access can write', () => {
    expect(opensearchAccess({ user_name: 'admin', roles: ['own_index', 'all_access'] })).toEqual({
      readOnly: false,
      canDo: ['It holds the role all_access, which can do everything.'],
      sentence: 'User admin can write.',
    });
  });

  test('a role the plugin does not describe is unknown, never read-only', () => {
    for (const roles of [['quanthea_read'], ['readall', 'own_index'], []]) {
      const access = opensearchAccess({ user_name: 'dash', roles });
      expect(access).toMatchObject({ readOnly: null, canDo: [] });
      expect(access.sentence).toContain('unknown');
    }
  });

  test('the user to create is named as for every kind, and no mapping is replaced', () => {
    expect(readOnlySetups.Elasticsearch).toContain('POST /_security/user/quanthea_read\n');
    expect(readOnlySetups.OpenSearch).toContain('internalusers/quanthea_read\n');
    expect(readOnlySetups.OpenSearch).toContain('"opendistro_security_roles": ["readall"]');
    expect(readOnlySetups.OpenSearch).not.toContain('rolesmapping');
  });

  test('a server without the security plugin takes every request', async () => {
    const { api } = apiAnswering(400, {
      error: 'no handler found for uri [/_plugins/_security/authinfo] and method [GET]',
    });
    expect((await searchAccess(api, 'OpenSearch', signal)).readOnly).toBe(false);
  });
});
