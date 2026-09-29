/** Writes the configuration file's JSON Schema to `docs/configuration.schema.json`. */
import { resolve } from 'node:path';
import { configJsonSchema } from './file-schema.ts';

const target = resolve(import.meta.dir, '../../../../docs/configuration.schema.json');
await Bun.write(target, `${JSON.stringify(configJsonSchema(), null, 2)}\n`);
process.stdout.write(`Wrote ${target}\n`);
