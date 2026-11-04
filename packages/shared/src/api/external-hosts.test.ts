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

  test('keep links and images each to their own hosts, or let either go anywhere', () => {
    const settings = externalHostsSchema.parse({
      links: { anyHost: false, hosts: ['play.example.com'] },
      images: { anyHost: false, hosts: ['media.example.com'] },
    });
    expect(linkHostAllowed(settings, 'play.example.com')).toBe(true);
    expect(linkHostAllowed(settings, 'media.example.com')).toBe(false);
    expect(imageHostAllowed(settings, 'media.example.com')).toBe(true);
    expect(imageHostAllowed(settings, 'play.example.com')).toBe(false);
    const open = { ...settings, images: { anyHost: true, hosts: [] } };
    expect(imageHostAllowed(open, 'any.example.com')).toBe(true);
  });

  test('read settings saved as one list: every host for links, those marked for images', () => {
    const settings = externalHostsSchema.parse({
      linksToAnyHost: false,
      hosts: [{ host: 'media.example.com', images: true }, { host: 'play.example.com' }],
    });
    expect(settings).toEqual({
      links: { anyHost: false, hosts: ['media.example.com', 'play.example.com'] },
      images: { anyHost: false, hosts: ['media.example.com'] },
    });
  });

  test('hold at most 50 hosts in each list', () => {
    const hosts = Array.from({ length: 51 }, (_, index) => `h${index}.example.com`);
    const images = { anyHost: false, hosts: [] };
    const links = { anyHost: false, hosts };
    expect(externalHostsSchema.safeParse({ links, images }).success).toBe(false);
  });
});
