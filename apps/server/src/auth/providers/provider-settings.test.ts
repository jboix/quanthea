import { describe, expect, test } from 'bun:test';
import { githubPerson } from './drivers.ts';
import { checkedFields, gitlabOrigin } from './provider-settings.ts';

/**
 * Settings as an admin sends them.
 *
 * @param fields - The fields to set.
 * @returns The input.
 */
function input(
  fields: Partial<Parameters<typeof checkedFields>[0]>,
): Parameters<typeof checkedFields>[0] {
  return {
    kind: 'google',
    name: 'Google',
    baseUrl: null,
    tenant: null,
    join: { mode: 'invite', values: [] },
    ...fields,
  };
}

describe('provider settings', () => {
  test('need one Entra tenant, never a shared one', () => {
    expect(checkedFields(input({ kind: 'entra', tenant: 'contoso.onmicrosoft.com' })).tenant).toBe(
      'contoso.onmicrosoft.com',
    );
    for (const tenant of ['common', 'organizations', 'consumers', '', 'not a tenant']) {
      expect(() => checkedFields(input({ kind: 'entra', tenant }))).toThrow('one Entra tenant');
    }
  });

  test('take a GitLab over HTTPS, or HTTP on this machine, as an origin', () => {
    expect(gitlabOrigin('https://gitlab.example.com')).toBe('https://gitlab.example.com');
    expect(gitlabOrigin('http://127.0.0.1:8929')).toBe('http://127.0.0.1:8929');
    for (const bad of ['http://gitlab.example.com', 'https://gitlab.example.com/path', 'nope']) {
      expect(() => gitlabOrigin(bad)).toThrow('https://host');
    }
  });

  test('allow only the join rules each kind can check, with values when they need them', () => {
    expect(() =>
      checkedFields(input({ join: { mode: 'organisation', values: ['acme'] } })),
    ).toThrow('invite or domain');
    expect(() => checkedFields(input({ join: { mode: 'domain', values: [] } }))).toThrow(
      'at least one',
    );
    expect(
      checkedFields(input({ join: { mode: 'domain', values: ['Example.COM'] } })).join.values,
    ).toEqual(['example.com']);
  });
});

describe('GitHub', () => {
  test('takes the verified primary email only', async () => {
    const answers: Record<string, unknown> = {
      '/user': { id: 42, login: 'ada', name: null },
      '/user/emails': [
        { email: 'spoof@example.com', primary: false, verified: true },
        { email: 'ada@example.com', primary: true, verified: true },
      ],
    };
    const fetcher = (async (url: string) =>
      Response.json(answers[new URL(url).pathname])) as typeof fetch;
    expect(await githubPerson(fetcher, 'token')).toEqual({
      subject: '42',
      name: 'ada',
      email: 'ada@example.com',
    });
    answers['/user/emails'] = [{ email: 'ada@example.com', primary: true, verified: false }];
    expect((await githubPerson(fetcher, 'token')).email).toBeNull();
  });
});
