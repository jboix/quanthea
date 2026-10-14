import { describe, expect, test } from 'bun:test';
import { type DefinitionVersion, definitionSchema, type Panel } from '@quanthea/shared';
import {
  definitionIndexBudget,
  definitionsSection,
  definitionsTopic,
  ignoredDefinitionNotes,
} from './definition-facts.ts';

/**
 * A stored version of a definition.
 *
 * @param definition - The definition, unchecked.
 * @returns The version.
 */
function version(definition: unknown): DefinitionVersion {
  return {
    definition: definitionSchema.parse(definition),
    version: 2,
    author: 'e',
    origin: 'ui',
    createdAt: 1,
  };
}

const errorRate = version({
  id: 'error-rate',
  name: 'Error rate',
  synonyms: ['failure rate'],
  meaning: 'ERROR events, excluding business errors, over START events.',
  bodies: [
    {
      shape: 'ratio',
      request: { kind: 'search-ratio', index: 'events', match: [{ field: 'e', value: 'ERROR' }] },
    },
  ],
});
const sessions = version({ id: 'sessions', name: 'Sessions', meaning: 'One playback.' });

describe('the definitions in the instructions', () => {
  test('give the rule and a line per definition, saying where each is checked', () => {
    const section = definitionsSection([errorRate, sessions]) ?? '';
    expect(section).toContain('never read the word literally');
    expect(section).toContain(
      '- error-rate "Error rate" (also: failure rate): ERROR events, excluding business errors, over START events. [checked: search (ratio)]',
    );
    expect(section).toContain('- sessions "Sessions": One playback. [meaning only]');
    expect(definitionsSection([])).toBeUndefined();
  });

  test('name the definitions only, and point to the guide, once their lines pass the budget', () => {
    const many = Array.from({ length: 40 }, (_, index) =>
      version({ id: `term-${index}`, name: `Term ${index}`, meaning: 'x'.repeat(100) }),
    );
    const section = definitionsSection(many) ?? '';
    expect(section.length).toBeLessThan(definitionIndexBudget);
    expect(section).toContain('read_guide: { "kind": "definitions" }');
    expect(definitionsTopic(many).text).toContain('term-39 "Term 39": x');
  });
});

describe('a written panel', () => {
  /**
   * A panel with a title.
   *
   * @param title - The title.
   * @param copied - Whether its data was copied from the error rate.
   * @returns The panel.
   */
  const panel = (title: string, copied = false) =>
    ({
      id: 'p',
      title,
      ...(copied ? { definition: { id: 'error-rate', version: 2 } } : {}),
    }) as Panel;

  test('that names a defined term without its definition gets a note', () => {
    expect(ignoredDefinitionNotes([panel('Failure rate per platform')], [errorRate])).toEqual([
      '"Failure rate per platform" names Error rate but does not use the definition error-rate. Rebuild it from the definition, or say in its description why not.',
    ]);
  });

  test('copied from the definition, or naming no term, gets none', () => {
    expect(ignoredDefinitionNotes([panel('Error rate', true)], [errorRate])).toEqual([]);
    expect(ignoredDefinitionNotes([panel('Errorless rates')], [errorRate])).toEqual([]);
  });
});
