import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { TitleHeader } from './title-header.tsx';

/** A title long enough to be cut in any header. */
const longTitle = 'Error rate above 5% (excl. DRM_NOT_SUPPORTED and business errors)';

test('the heading keeps its full text as a tooltip, so a cut title can still be read', () => {
  const html = renderToStaticMarkup(<TitleHeader title={longTitle} />);
  expect(html).toContain(`<h2 title="${longTitle}">${longTitle}</h2>`);
});

test('the level and the id of the heading are the caller’s', () => {
  const html = renderToStaticMarkup(<TitleHeader title="Checkout" level={1} titleId="heading" />);
  expect(html).toContain('<h1 id="heading" title="Checkout">Checkout</h1>');
});

test('what the heading shows can be a link, and the tooltip stays the plain text', () => {
  const html = renderToStaticMarkup(
    <TitleHeader title="Checkout" titleContent={<a href="/d/1">Checkout</a>} />,
  );
  expect(html).toContain('<h2 title="Checkout"><a href="/d/1">Checkout</a></h2>');
});

test('the badges follow the title and the actions come last, each in its own group', () => {
  const html = renderToStaticMarkup(
    <TitleHeader
      title="Checkout"
      before={<i>icon</i>}
      badges={<b>v5</b>}
      below={<p>target</p>}
      actions={<button type="button">Activate</button>}
    />,
  );
  const order = ['<i>icon</i>', '<h2', '<div><b>v5</b></div>', '<p>target</p>', '<button'];
  const found = order.map((part) => html.indexOf(part));
  expect(found.every((index) => index >= 0)).toBe(true);
  expect(found).toEqual([...found].sort((a, b) => a - b));
  expect(html).toContain('<div><button type="button">Activate</button></div></header>');
});

test('an empty slot draws no group, so it takes no gap', () => {
  const html = renderToStaticMarkup(
    <TitleHeader title="Checkout" badges={false} actions={null} eyebrow={undefined} />,
  );
  expect(html).toBe(
    '<header data-size="pane" data-align="center" data-mono="false" data-wrap="false">' +
      '<div><div><div><h2 title="Checkout">Checkout</h2></div></div></div></header>',
  );
});

test('the size, the alignment and the element are the caller’s', () => {
  const html = renderToStaticMarkup(
    <TitleHeader title="Checkout" size="screen" align="end" as="div" mono />,
  );
  expect(html).toStartWith(
    '<div data-size="screen" data-align="end" data-mono="true" data-wrap="false">',
  );
});

/**
 * The declarations of one rule of the header's stylesheet, read from the source: class names and
 * layout do not exist under the test runner, so the rules that hold the layout are checked as text.
 *
 * @param selector - The rule's selector, as written.
 * @returns The declarations, property to value.
 */
async function declarationsOf(selector: string): Promise<Record<string, string>> {
  const css = await Bun.file(new URL('./title-header.module.css', import.meta.url)).text();
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, '').split('}');
  const named = (rule: string) => rule.split('{')[0]?.trim().replace(/\s+/g, ' ') === selector;
  const body = rules.find(named)?.split('{')[1] ?? '';
  const pairs = body.split(';').map((line) => line.split(':').map((part) => part.trim()));
  return Object.fromEntries(pairs.filter((pair) => pair.length === 2));
}

test('the stylesheet cuts the title on one line, and lets it shrink', async () => {
  expect(await declarationsOf('.title')).toMatchObject({
    'min-width': '0',
    overflow: 'hidden',
    'text-overflow': 'ellipsis',
    'white-space': 'nowrap',
  });
});

test('the stylesheet keeps the badges and the actions at their size', async () => {
  expect(await declarationsOf('.badges, .actions')).toMatchObject({ flex: '0 0 auto' });
});

test('the stylesheet lets a group move below the title, and the text take the rest', async () => {
  expect(await declarationsOf('.header')).toMatchObject({ 'flex-wrap': 'wrap' });
  expect(await declarationsOf('.titleRow')).toMatchObject({ 'flex-wrap': 'wrap' });
  expect(await declarationsOf('.text')).toMatchObject({
    flex: '1 1 var(--title-header-text)',
    'min-width': '0',
  });
});
