/** Definitions: business terms with one meaning, which every role reads and editors change. */

export { bodyPlace, bodyWords } from './body-words.ts';
export type {
  DefinitionsData,
  DefinitionsIntent,
  DefinitionsOutcome,
} from './data.ts';
export { definitionsAction, loadDefinitions } from './data.ts';
export { idFromName } from './definition-editor.tsx';
export type { AssistantOutletContext } from './definitions-screen.tsx';
