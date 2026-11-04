import { expect, test } from 'bun:test';
import type { DashboardLayout } from '@quanthea/shared';
import {
  addSection,
  groupsOf,
  hasBlankSection,
  moveSection,
  moveToSection,
  removeSection,
  renameSection,
  withSections,
} from './layout-section-edit.ts';

/** A dashboard of three panels, two in a section, its panels lower on the one grid. */
const version = {
  panels: [
    { id: 'errors', grid: { x: 0, y: 0, w: 12, h: 3 } },
    { id: 'crashes', grid: { x: 0, y: 3, w: 6, h: 3 }, section: 'apps' },
    { id: 'installs', grid: { x: 6, y: 3, w: 6, h: 3 }, section: 'apps' },
  ],
  sections: [{ id: 'apps', title: 'Apps' }],
};

/** The layout of the spec, before any section is set on it. */
const plain: DashboardLayout = {
  panels: version.panels.map(({ id, grid }) => ({ id, grid, hidden: false })),
};

/**
 * Where each panel sits: its section and its row.
 *
 * @param layout - The layout.
 * @returns The id, the section and the row of each panel.
 */
function places(layout: DashboardLayout) {
  return layout.panels.map((entry) => [entry.id, entry.section, entry.grid.y]);
}

test('starts from the spec sections, each section from its own top', () => {
  const start = withSections(version, plain);
  expect(start.sections).toEqual([{ id: 'apps', title: 'Apps' }]);
  expect(places(start)).toEqual([
    ['errors', undefined, 0],
    ['crashes', 'apps', 0],
    ['installs', 'apps', 0],
  ]);
  expect(groupsOf(start)).toEqual([undefined, 'apps']);
  expect(withSections({ panels: version.panels }, plain)).toBe(plain);
});

test('moves a panel into a section, under its panels, and out of every section', () => {
  const start = withSections(version, plain);
  const inside = moveToSection(start, 'errors', 'apps');
  expect(places(inside)).toEqual([
    ['errors', 'apps', 3],
    ['crashes', 'apps', 0],
    ['installs', 'apps', 0],
  ]);
  expect(groupsOf(inside)).toEqual(['apps']);
  const outside = moveToSection(inside, 'installs', undefined);
  expect(places(outside)).toEqual([
    ['errors', 'apps', 3],
    ['crashes', 'apps', 0],
    ['installs', undefined, 0],
  ]);
});

test('adds, names, orders and removes sections, a removed one leaving its panels', () => {
  const added = addSection(withSections(version, plain));
  expect(added.sections?.map((each) => each.id)).toEqual(['apps', 'section-2']);
  expect(hasBlankSection(renameSection(added, 'section-2', ' '))).toBe(true);
  const named = renameSection(added, 'section-2', 'Health');
  expect(hasBlankSection(named)).toBe(false);
  const ordered = moveSection(named, 'section-2', -1);
  expect(ordered.sections?.map((each) => each.title)).toEqual(['Health', 'Apps']);
  expect(moveSection(ordered, 'section-2', -1)).toBe(ordered);
  const removed = removeSection(ordered, 'apps');
  expect(removed.sections).toEqual([{ id: 'section-2', title: 'Health' }]);
  expect(places(removed)).toEqual([
    ['errors', undefined, 0],
    ['crashes', undefined, 3],
    ['installs', undefined, 3],
  ]);
});
