/**
 * The commands the site shows, read at build time from the code blocks of `docs/deployment.md` and
 * the plugin generator's README, so the site and the docs always give the same commands.
 */

import deployment from '../../../../docs/deployment.md?raw';
import createPluginReadme from '../../../../packages/create-plugin/README.md?raw';
import { codeBlocksUnder } from './doc-text.ts';

/**
 * One code block of a section, or a build error when the docs no longer have it.
 *
 * @param markdown - The document.
 * @param heading - The section's heading.
 * @param index - Which block of the section.
 * @returns The block.
 */
function requireBlock(markdown: string, heading: string, index: number): string {
  const block = codeBlocksUnder(markdown, heading)[index];
  if (block === undefined) throw new Error(`No code block ${index} under "${heading}".`);
  return block;
}

/** The commands, by what they do. */
export const commands = {
  /** Start quanthea from the published image, with both volumes (the deployment guide). */
  quickStart: requireBlock(deployment, 'Quick start', 0),
  /** Read the password of the first admin from the log (the deployment guide). */
  firstPassword: requireBlock(deployment, 'Quick start', 1),
  /** Generate a connector plugin project (the generator's README). */
  createPlugin: requireBlock(createPluginReadme, '@quanthea/create-plugin', 0),
};
