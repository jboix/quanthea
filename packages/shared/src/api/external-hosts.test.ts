import { describe, expect, test } from 'bun:test';
import {
  externalHostsSchema,
  hostNameSchema,
  imageHostAllowed,
  linkHostAllowed,
} from './external-hosts.ts';

describe('a host name', () => {
  test('takes a lowercase name with dots and dashes', () => {
    for (const host of ['media.example.com', 'cdn-1.example.ch', 'localhost', '123.example.com'])
      expect(hostNameSchema.safeParse(host).success).toBe(true);
  });

  test('refuses a scheme, a path, a port, a space, a semicolon, upper case and IP literals', () => {
    const refused = [
      'https://media.example.com',
      'media.example.com/x',
      'media.example.com:443',
      'media example.com',
      'media.example.com;',
      'Media.example.com',
      '10.0.0.1',
      '[::1]',
      '',
      '-x.example.com',
    ];
    for (const host of refused) expect(hostNameSchema.safeParse(host).success).toBe(false);
  });
});

describe('the external hosts', () => {
  test('let links go anywhere and images nowhere by default', () => {
    const settings = externalHostsSchema.parse({});
    expect(linkHostAllowed(settings, 'any.example.com')).toBe(true);
    expect(imageHostAllowed(settings, 'any.example.com')).toBe(false);
  });

  test('keep links to the hosts listed once narrowed, and images to those marked', () => {
    const settings = externalHostsSchema.parse({
      linksToAnyHost: false,
      hosts: [{ host: 'media.example.com', images: true }, { host: 'play.example.com' }],
    });
    expect(linkHostAllowed(settings, 'play.example.com')).toBe(true);
    expect(linkHostAllowed(settings, 'other.example.com')).toBe(false);
    expect(imageHostAllowed(settings, 'media.example.com')).toBe(true);
    expect(imageHostAllowed(settings, 'play.example.com')).toBe(false);
  });

  test('hold at most 50 hosts', () => {
    const hosts = Array.from({ length: 51 }, (_, index) => ({ host: `h${index}.example.com` }));
    expect(externalHostsSchema.safeParse({ hosts }).success).toBe(false);
  });
});
