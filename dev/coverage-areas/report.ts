/**
 * `bun run coverage:areas`: reads `coverage/lcov.info`, writes the line coverage by area to
 * `coverage/areas.json` for octocov's custom metrics, and prints it as Markdown tables.
 * Run it after `bun run test:coverage`.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { areaSets, filesOf, tableOf } from './areas.ts';

const coverage = join(import.meta.dir, '..', '..', 'coverage');
const sets = areaSets(filesOf(readFileSync(join(coverage, 'lcov.info'), 'utf8')));
writeFileSync(join(coverage, 'areas.json'), `${JSON.stringify(sets, null, 2)}\n`);
process.stdout.write(`${sets.map(tableOf).join('\n\n')}\n`);
