import { describe, expect, test } from 'bun:test';
import { linkSchema } from './links.ts';
import { urlLinkAddress, urlLinkHost, urlLinkSchema } from './url-links.ts';

/**
 * The first message a link's address is refused with.
 *
 * @param url - The address.
 * @returns The message, or `undefined` when it is accepted.
 */
function refusal(url: string): string | undefined {
  const parsed = linkSchema.safeParse({ url });
  return parsed.success ? undefined : parsed.error.issues[0]?.message;
}

describe('a link to an address', () => {
  test('is https on a named host, with {value} once at most and outside the host', () => {
    expect(refusal('https://docs.example.com/items/{value}?tab=info')).toBeUndefined();
    expect(refusal('https://docs.example.com/')).toBeUndefined();
    expect(refusal('http://docs.example.com/{value}')).toBe('A link URL starts with https://.');
    expect(refusal('https://{value}.example.com/')).toBe(
      'A link URL holds {value} in its path or query, not its host.',
    );
    expect(refusal('https://a.com/{value}/{value}')).toBe('A link URL holds {value} once at most.');
    expect(refusal('https://10.0.0.1/x')).toContain('not an IP address');
    expect(refusal('https://a.com\\@evil.com/')).toBe(
      'A link URL is an https address such as https://example.com/items/{value}.',
    );
    expect(refusal('https://a.com:8443/x')).toBe('A link URL holds no port.');
    expect(refusal('https://me:secret@a.com/x')).toBe('A link URL holds no user or password.');
    expect(refusal('javascript:alert(1)')).toBe('A link URL starts with https://.');
  });

  test('fills in its value encoded, and leaves out a missing, empty or dot segment value', () => {
    const link = urlLinkSchema.parse({ url: 'https://a.com/items/{value}' });
    expect(urlLinkHost(link)).toBe('a.com');
    expect(urlLinkAddress(link, 'x y/z?$&')).toBe('https://a.com/items/x%20y%2Fz%3F%24%26');
    for (const value of [undefined, '', '.', '..'])
      expect(urlLinkAddress(link, value)).toBeUndefined();
    const fixed = urlLinkSchema.parse({ url: 'https://a.com/help' });
    expect(urlLinkAddress(fixed, undefined)).toBe('https://a.com/help');
  });
});
