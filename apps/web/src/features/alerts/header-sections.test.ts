import { expect, test } from 'bun:test';
import { evaluationAction, headerSections } from './header-sections.ts';
import { detailedAlert } from './test-alerts.ts';

test('each role sees its sections of the header, folded or not', () => {
  expect(headerSections('viewer', false)).toEqual(['Versions']);
  expect(headerSections('analyst', false)).toEqual(['Mute', 'Versions']);
  expect(headerSections('editor', true)).toEqual(['Change', 'Mute', 'Versions']);
  expect(headerSections('admin', true)).toEqual(['Change', 'Mute', 'Versions']);
});

test('an editor who may not change the alert gets no Change', () => {
  expect(headerSections('editor', false)).toEqual(['Mute', 'Versions']);
});

test('Change stops an active alert, and starts a deactivated one or a draft', () => {
  expect(evaluationAction(detailedAlert())).toMatchObject({
    label: 'Deactivate',
    intent: { intent: 'deactivate' },
  });
  expect(evaluationAction(detailedAlert({ deactivated: true }))).toMatchObject({
    label: 'Activate again',
    intent: { intent: 'activate', version: 1 },
  });
  const draft = detailedAlert({ activeVersion: null, latestVersion: 2 });
  expect(evaluationAction(draft)).toMatchObject({
    label: 'Activate v2',
    intent: { intent: 'activate', version: 2 },
  });
});
