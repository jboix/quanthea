import { describe, expect, test } from 'bun:test';
import { type DashboardSpec, dashboardSpecSchema, type Section } from '@quanthea/shared';
import { renderToStaticMarkup } from 'react-dom/server';
import { FrozenCopies } from './section-copies.tsx';

/** A dashboard with one panel in a section repeated over the platform. */
const spec: DashboardSpec = dashboardSpecSchema.parse({
  specVersion: 1,
  title: 'Platforms',
  time: { from: 'now-6h', to: 'now' },
  variables: [
    {
      kind: 'custom',
      name: 'platform',
      options: ['web', { value: 'ios', label: 'iOS' }],
      default: ['web', 'ios'],
      multi: true,
    },
  ],
  panels: [
    {
      id: 'plays',
      title: 'Plays',
      grid: { x: 0, y: 0, w: 6, h: 4 },
      queries: [{ refId: 'A', connector: 'shop', language: 'sql', sql: 'SELECT 1' }],
      view: { kind: 'stat', ref: 'A', reduce: 'last', format: { $fmt: 'number' } },
      section: 'by',
    },
  ],
});

/**
 * The snapshot markup of the section's copies, each panel drawn as its id and copy's value.
 *
 * @param section - The section.
 * @returns The markup.
 */
function render(section: Section): string {
  return renderToStaticMarkup(
    <FrozenCopies
      spec={spec}
      section={section}
      panels={spec.panels}
      frozen={['plays#web', 'plays#ios']}
      card={(panel, copy) => <i key={panel.id}>{`${panel.id}:${copy?.value}`}</i>}
    />,
  );
}

describe('the copies of a repeated section', () => {
  test('show a tab per value and the first copy alone', () => {
    const markup = render({ id: 'by', title: 'By platform', repeat: 'platform' });
    expect(markup.match(/role="tab"/g)).toHaveLength(2);
    expect(markup).toContain('>iOS</button>');
    expect(markup).toContain('plays:web');
    expect(markup).not.toContain('plays:ios');
  });
});
