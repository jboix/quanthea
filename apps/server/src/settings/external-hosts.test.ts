import { expect, test } from 'bun:test';
import type { AuditEntry } from '../db/audit-repository.ts';
import type { SettingsRepository } from '../db/settings-repository.ts';
import { createExternalHosts } from './external-hosts.ts';
import { createSettingsStore } from './settings-store.ts';

test('the external hosts start open to links and closed to images, and audit every save', () => {
  const rows = new Map<string, string>();
  const repository: SettingsRepository = {
    read: (key) => rows.get(key),
    write: (key, value) => {
      rows.set(key, value);
    },
  };
  const entries: AuditEntry[] = [];
  const service = createExternalHosts({
    store: createSettingsStore(repository),
    audit: { append: (entry) => entries.push(entry) },
  });
  expect(service.get()).toEqual({ linksToAnyHost: true, hosts: [] });
  expect(service.imageHosts()).toEqual([]);
  const hosts = [
    { host: 'media.example.com', images: true },
    { host: 'docs.example.com', images: false },
  ];
  const saved = service.save({ linksToAnyHost: false, hosts }, 'admin-1');
  expect(service.imageHosts()).toEqual(['media.example.com']);
  expect(saved.hosts).toEqual(hosts);
  expect(entries).toEqual([
    {
      actor: 'admin-1',
      action: 'settings.external-hosts',
      detail: { before: { linksToAnyHost: true, hosts: [] }, after: saved },
    },
  ]);
});
