import { describe, expect, test } from 'bun:test';
import { guideTools, markersTopic, readGuide } from './guide-tools.ts';
import { editRules } from './prompt-text.ts';

const guides = [
  { kind: 'postgres', text: 'PostgreSQL (SQL). Bind the range with :__from and :__to.' },
  { kind: 'loki', text: 'Loki (LogQL). Select streams by label.' },
];

describe('read_guide', () => {
  test('names the kinds it has, and gives a kind’s guide', () => {
    expect(guideTools(guides).read_guide.description).toContain('Kinds: postgres, loki.');
    expect(readGuide(guides, 'loki')).toEqual({
      kind: 'loki',
      guide: 'Loki (LogQL). Select streams by label.',
    });
  });

  test('gives how to set markers, which the instructions only point to', () => {
    const read = readGuide([...guides, markersTopic], 'markers');
    expect(read).toMatchObject({ kind: 'markers' });
    expect(JSON.stringify(read)).toContain('removeMarkers');
    expect(editRules).toContain('read_guide: { "kind": "markers" }');
    expect(editRules).not.toContain('removeMarkers');
  });

  test('says which kinds there are when asked for another', () => {
    expect(readGuide(guides, 'mysql')).toEqual({
      error: 'No guide for "mysql". Kinds: postgres, loki.',
    });
  });
});
