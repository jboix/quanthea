import { describe, expect, test } from 'bun:test';
import { guideTools, readGuide, settingsTopic } from './guide-tools.ts';
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

  test('gives how to set variables, colours and markers, which the instructions only point to', () => {
    const read = readGuide([...guides, settingsTopic], 'settings');
    expect(read).toMatchObject({ kind: 'settings' });
    expect(JSON.stringify(read)).toContain('removeMarkers');
    expect(JSON.stringify(read)).toContain('Variables replace the list');
    expect(editRules).toContain('read_guide: { "kind": "settings" }');
    expect(editRules).not.toContain('removeMarkers');
    expect(editRules).not.toContain('"includeAll"');
  });

  test('says which guide was read, and nothing for one it does not have', () => {
    const read: string[] = [];
    const tool = guideTools([settingsTopic], (kind) => read.push(kind)).read_guide;
    const options = { toolCallId: 'call', messages: [] } as never;
    void tool.execute?.({ kind: 'settings' }, options);
    void tool.execute?.({ kind: 'mysql' }, options);
    expect(read).toEqual(['settings']);
  });

  test('says which kinds there are when asked for another', () => {
    expect(readGuide(guides, 'mysql')).toEqual({
      error: 'No guide for "mysql". Kinds: postgres, loki.',
    });
  });
});
