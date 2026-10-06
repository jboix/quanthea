import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { connectorKinds } from '../../../server/src/connectors/registry.ts';
import { allowedSeriesTypes } from '../../../server/src/dashboards/check-option.ts';
import { channelRecipes, reportRecipes } from '../../../server/src/notifications/registry.ts';
import { connectors, notificationChannels, seriesTypes } from './facts.ts';

/**
 * The series types the dashboard spec's design names.
 *
 * @returns The types, from the "Allowed series types" sentence of `docs/dashboard-spec.md`.
 */
function seriesTypesInSpecDoc(): string[] {
  const spec = readFileSync(new URL('../../../../docs/dashboard-spec.md', import.meta.url), 'utf8');
  const sentence = /Allowed series\s+types:([^.]+)\./.exec(spec.replace(/\s*\/\/\s*/g, ' '))?.[1];
  if (sentence === undefined) throw new Error('The spec doc no longer lists the series types.');
  return sentence.split(',').map((type) => type.trim());
}

describe('the facts the website states', () => {
  test('name every connector kind of the server, and only those', () => {
    const serverKinds = connectorKinds.map((kind) => kind.kind).sort();
    const siteKinds = [...new Set(connectors.map((connector) => connector.kind))].sort();
    expect(siteKinds).toEqual(serverKinds);
  });

  test('name every notification channel the server sends to, and only those', () => {
    const siteKinds: string[] = notificationChannels.map((channel) => channel.kind).sort();
    expect(siteKinds).toEqual(Object.keys(channelRecipes).sort());
    expect(siteKinds).toEqual(Object.keys(reportRecipes).sort());
  });

  test('list the series types the server allows, as the spec doc names them', () => {
    const siteTypes = seriesTypes.map((series) => series.type);
    expect([...siteTypes].sort()).toEqual([...allowedSeriesTypes].sort());
    expect(siteTypes).toEqual(seriesTypesInSpecDoc());
  });
});
