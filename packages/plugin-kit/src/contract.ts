/**
 * The contract between connectors and the rest of quanthea, with its runtime checks: the frames a
 * kind returns and the query languages it speaks. A workspace entry for `@quanthea/shared` and the
 * kit itself; plugins get the types from the kit's main entry.
 */
export {
  compareFrameValues,
  type Field,
  type FieldType,
  type Frame,
  fieldSchema,
  fieldTypes,
  frameProblems,
  frameSchema,
} from './frames.ts';
export { type QueryLanguage, queryLanguageSchema, queryLanguages } from './languages.ts';
