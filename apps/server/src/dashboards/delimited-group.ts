/**
 * Recognises a repeated group whose iterations cannot overlap, such as `(?:-[a-z]+)*` or
 * `(?:\.\d{1,3}){3}`: each iteration starts with one literal character that nothing else in the
 * group matches, and each quantifier inside is followed by a literal it cannot match. A
 * backtracking engine then finds one way to split a value into iterations, so repeating the group
 * takes linear time although it holds a quantifier.
 */
import { type Token, tokenAt } from './pattern-tokens.ts';

/** An atom of a group's body, with the quantifier after it if any. */
interface Item {
  /** The atom, such as `-`, `\d` or `[a-z]`. */
  readonly source: string;
  /** Whether a quantifier follows it. */
  readonly quantified: boolean;
  /** How many counts its quantifier may take, 1 without one. */
  readonly choices: number;
}

/** An escape whose characters a test can stand for: a class such as `\d`, or a symbol. */
const plainEscape = /^\\(?:[dDwWsS]|[^A-Za-z0-9])$/;

/** An escaped symbol, such as `\.` or `\-`. */
const escapedSymbol = /^\\[^A-Za-z0-9]$/;

/**
 * Adds a quantifier to the last item.
 *
 * @param items - The items so far.
 * @param choices - How many counts the quantifier may take.
 * @returns `false` when there is no atom to quantify.
 */
function quantifyLast(items: Item[], choices: number): boolean {
  const last = items.pop();
  if (!last || last.quantified) return false;
  items.push({ ...last, quantified: true, choices });
  return true;
}

/**
 * Adds one token of a group's body to the items.
 *
 * @param items - The items so far.
 * @param token - The token.
 * @param source - Its text.
 * @returns `false` for a token the recogniser does not take.
 */
function addToken(items: Item[], token: Token, source: string): boolean {
  if (token.kind === 'quantifier') return quantifyLast(items, token.choices);
  if (token.kind !== 'atom') return false;
  if (source.startsWith('\\') && !plainEscape.test(source)) return false;
  items.push({ source, quantified: false, choices: 1 });
  return true;
}

/**
 * The items of a group's body: atoms with their quantifiers, and nothing else.
 *
 * @param body - The body, between the group's opening and its `)`.
 * @returns The items, or `undefined` for a body with a group, an alternation, a back-reference or
 *   an escape such as `\x2d` that a test cannot stand for.
 */
function itemsOf(body: string): Item[] | undefined {
  const items: Item[] = [];
  for (let index = 0; index < body.length; ) {
    const token = tokenAt(body, index);
    if (!addToken(items, token, body.slice(index, token.end))) return undefined;
    index = token.end;
  }
  return items;
}

/**
 * The one character an unquantified item matches, when it is a plain literal.
 *
 * @param item - The item.
 * @returns The character, or `undefined`.
 */
function literalOf(item: Item | undefined): string | undefined {
  if (!item || item.quantified) return undefined;
  if (item.source.length === 1 && !'.^$'.includes(item.source)) return item.source;
  return escapedSymbol.test(item.source) ? item.source[1] : undefined;
}

/**
 * Whether an item matches a character.
 *
 * @param item - The item.
 * @param character - The character.
 * @returns `true` when it does.
 */
function matches(item: Item, character: string): boolean {
  return new RegExp(item.source).test(character);
}

/**
 * Whether an item whose count varies ends where the next one starts, and nowhere else.
 *
 * @param item - The item.
 * @param next - The item after it, if any.
 * @returns `true` when the item is last, or the next is a literal the item cannot match.
 */
function endsApart(item: Item, next: Item | undefined): boolean {
  if (next === undefined) return true;
  const literal = literalOf(next);
  return literal !== undefined && !matches(item, literal);
}

/**
 * Whether a group can repeat in linear time although it holds a quantifier.
 *
 * @param body - The group's body, between its opening and its `)`.
 * @returns `true` when its iterations cannot overlap.
 */
export function delimitedGroup(body: string): boolean {
  const items = itemsOf(body);
  const delimiter = literalOf(items?.[0]);
  if (!items || delimiter === undefined) return false;
  if (items.slice(1).some((item) => matches(item, delimiter))) return false;
  return items.every((item, index) => item.choices === 1 || endsApart(item, items[index + 1]));
}
