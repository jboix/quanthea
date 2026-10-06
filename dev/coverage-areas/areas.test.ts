import { describe, expect, test } from 'bun:test';
import { areaSets, filesOf, tableOf } from './areas.ts';

/** A small report: two server modules, a file at the server's root, the web app, and a stray. */
const lcov = [
  'SF:apps/server/src/agent/run.ts\nLF:100\nLH:80\nend_of_record',
  'SF:apps/server/src/agent/turn.ts\nLF:100\nLH:60\nend_of_record',
  'SF:apps/server/src/gate/view.ts\nLF:50\nLH:50\nend_of_record',
  'SF:apps/server/src/app.ts\nLF:10\nLH:5\nend_of_record',
  'SF:apps/web/src/charts/series.ts\nLF:40\nLH:30\nend_of_record',
  'SF:../../var/tmp/plugin.ts\nLF:20\nLH:0\nend_of_record',
  'SF:apps/web/src/empty.ts\nLF:0\nLH:0\nend_of_record',
].join('\n');

describe('coverage by area', () => {
  test('read each file, leaving out the files outside the repository and the empty ones', () => {
    expect(filesOf(lcov).map((file) => file.path)).toEqual([
      'apps/server/src/agent/run.ts',
      'apps/server/src/agent/turn.ts',
      'apps/server/src/gate/view.ts',
      'apps/server/src/app.ts',
      'apps/web/src/charts/series.ts',
    ]);
  });

  test('sum the lines by workspace and by module, the largest first', () => {
    const [byWorkspace, server] = areaSets(filesOf(lcov));
    expect(byWorkspace?.metrics).toEqual([
      { key: 'server', name: 'server (260 lines)', value: 75, unit: '%' },
      { key: 'web_app', name: 'web app (40 lines)', value: 75, unit: '%' },
    ]);
    expect(server?.metrics.map((metric) => [metric.key, metric.value])).toEqual([
      ['agent', 70],
      ['gate', 100],
      ['_root_', 50],
    ]);
  });

  test('print a set as a Markdown table', () => {
    const [, , web] = areaSets(filesOf(lcov));
    expect(web && tableOf(web)).toBe(
      '### Web app, by part\n\n| Area | Lines |\n| --- | ---: |\n| charts (40 lines) | 75% |',
    );
  });
});
