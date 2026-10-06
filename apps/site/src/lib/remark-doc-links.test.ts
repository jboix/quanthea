import { describe, expect, test } from 'bun:test';
import { rewriteDocImage, rewriteDocLink, rewriteMarkdownLinks } from './doc-links.ts';
import { docSlug, publishedSlug } from './doc-paths.ts';
import { codeBlocksUnder, docDescription, docTitle } from './doc-text.ts';
import { type MarkdownNode, remarkDocLinks } from './remark-doc-links.ts';
import { prefixedId, remarkDocTitle } from './remark-doc-title.ts';
import { joinBase } from './url.ts';

/** The repository the GitHub addresses point at. */
const github = 'https://github.com/jboix/quanthea';

describe('doc links', () => {
  test('send a link to a published doc to its page, under the base, with its fragment', () => {
    expect(rewriteDocLink('deployment.md', 'docs/README.md', '/')).toBe('/docs/deployment/');
    expect(rewriteDocLink('./alerts.md#what-fires', 'docs/guide/x.md', '/quanthea')).toBe(
      '/quanthea/docs/alerts/#what-fires',
    );
    expect(rewriteDocLink('../configuration.md#users', 'docs/guide/x.md', '/')).toBe(
      '/docs/configuration/#users',
    );
    expect(rewriteDocLink('../../docs/connectors.md', 'packages/plugin-kit/README.md', '/')).toBe(
      '/docs/connectors/',
    );
  });

  test('send the internals, the policies and any other doc to GitHub, never to a page', () => {
    expect(rewriteDocLink('./architecture.md#14-local-development', 'docs/x.md', '/')).toBe(
      `${github}/blob/main/docs/architecture.md#14-local-development`,
    );
    expect(rewriteDocLink('CODE_OF_CONDUCT.md', 'docs/CONTRIBUTING.md', '/')).toBe(
      `${github}/blob/main/docs/CODE_OF_CONDUCT.md`,
    );
    expect(rewriteDocLink('05-roadmap.md', 'docs/x.md', '/')).toBe(
      `${github}/blob/main/docs/05-roadmap.md`,
    );
    expect(rewriteDocLink('alert-spec.md#conditions', 'docs/x.md', '/')).toBe(
      `${github}/blob/main/docs/alert-spec.md#conditions`,
    );
  });

  test('send a link outside the published docs to GitHub, as a tree or a blob', () => {
    expect(rewriteDocLink('../deploy/', 'docs/deployment.md', '/')).toBe(
      `${github}/tree/main/deploy`,
    );
    expect(rewriteDocLink('../AGENTS.md', 'docs/CONTRIBUTING.md', '/')).toBe(
      `${github}/blob/main/AGENTS.md`,
    );
    expect(rewriteDocLink('../apps/server/src', 'docs/a.md', '/')).toBe(
      `${github}/tree/main/apps/server/src`,
    );
    expect(rewriteDocLink('brand/README.md#rules', 'docs/a.md', '/')).toBe(
      `${github}/blob/main/docs/brand/README.md#rules`,
    );
    expect(rewriteDocLink('configuration.schema.json', 'docs/a.md', '/')).toBe(
      `${github}/blob/main/docs/configuration.schema.json`,
    );
  });

  test('leave absolute links, anchors and links above the repository as written', () => {
    for (const url of ['https://bun.sh', '#quick-start', '/docs/', 'mailto:a@b.c', '']) {
      expect(rewriteDocLink(url, 'docs/a.md', '/')).toBe(url);
    }
    expect(rewriteDocLink('../../x.md', 'docs/a.md', '/')).toBe('../../x.md');
  });

  test('point images at their raw file, for text read off the site', () => {
    expect(rewriteDocImage('brand/quanthea-logo-preview.png', 'docs/brand/README.md')).toBe(
      'https://raw.githubusercontent.com/jboix/quanthea/main/docs/brand/brand/quanthea-logo-preview.png',
    );
    expect(rewriteDocImage('https://example.com/a.png', 'docs/a.md')).toBe(
      'https://example.com/a.png',
    );
  });

  test('rewrite the links of Markdown text, but not inside fenced code', () => {
    const markdown = [
      'See [deploy](deployment.md) and ![logo](brand/logo.png "Logo").',
      '```md',
      '[kept](deployment.md)',
      '```',
      '[ref]: ../AGENTS.md',
    ].join('\n');
    expect(rewriteMarkdownLinks(markdown, 'docs/a.md', 'https://quanthea.ch/').split('\n')).toEqual(
      [
        'See [deploy](https://quanthea.ch/docs/deployment/) and ![logo](https://raw.githubusercontent.com/jboix/quanthea/main/docs/brand/logo.png "Logo").',
        '```md',
        '[kept](deployment.md)',
        '```',
        `[ref]: ${github}/blob/main/AGENTS.md`,
      ],
    );
  });
});

describe('the remark plugins', () => {
  test('rewrite link and definition nodes of a repository file', () => {
    const tree: MarkdownNode = {
      type: 'root',
      children: [
        { type: 'paragraph', children: [{ type: 'link', url: 'alerts.md#settings' }] },
        { type: 'definition', url: '../../deploy/' },
        { type: 'image', url: 'brand/logo.png' },
      ],
    };
    const transform = remarkDocLinks({ base: '/quanthea/', repoRoot: '/repo' });
    transform(tree, { path: '/repo/docs/guide/dashboards.md' });
    expect(tree.children?.[0]?.children?.[0]?.url).toBe('/quanthea/docs/alerts/#settings');
    expect(tree.children?.[1]?.url).toBe(`${github}/tree/main/deploy`);
    expect(tree.children?.[2]?.url).toBe('brand/logo.png');
  });

  test('drop the first title, and move a section file’s headings down a level', () => {
    const heading = (depth: number): MarkdownNode => ({ type: 'heading', depth });
    const doc: MarkdownNode = { type: 'root', children: [heading(1), heading(2)] };
    remarkDocTitle()(doc, { path: '/repo/docs/a.md' });
    expect(doc.children).toEqual([heading(2)]);
    const readme: MarkdownNode = { type: 'root', children: [heading(1), heading(2), heading(3)] };
    remarkDocTitle({ demote: ['/packages/'] })(readme, { path: '/repo/packages/kit/README.md' });
    expect(readme.children?.map((node) => node.depth)).toEqual([3, 4]);
    expect(prefixedId('kit', 'Licence and terms')).toBe('kit-licence-and-terms');
    expect(prefixedId('kit', 'A & B: `code`')).toBe('kit-a--b-code');
  });
});

describe('doc paths and text', () => {
  test('slug file names and know which files the site publishes', () => {
    expect(docSlug('CODE_OF_CONDUCT.md')).toBe('code-of-conduct');
    expect(docSlug('dashboard-spec.md')).toBe('dashboard-spec');
    expect(docSlug('guide/getting-started.md')).toBe('getting-started');
    expect(publishedSlug('docs/deployment.md')).toBe('deployment');
    expect(publishedSlug('docs/guide/alerts.md')).toBe('alerts');
    expect(publishedSlug('docs/dashboard-spec.md')).toBeUndefined();
    expect(publishedSlug('docs/guide/nothing.md')).toBeUndefined();
    expect(publishedSlug('docs/SECURITY.md')).toBeUndefined();
    expect(publishedSlug('docs/architecture.md')).toBeUndefined();
    expect(publishedSlug('docs/02-decisions.md')).toBeUndefined();
    expect(publishedSlug('packages/plugin-kit/README.md')).toBe('plugins');
    expect(publishedSlug('docs/brand/README.md')).toBeUndefined();
    expect(publishedSlug('README.md')).toBeUndefined();
  });

  test('read the title and the first paragraph of a doc', () => {
    const markdown = [
      '# Deploying quanthea',
      '',
      '[![badge](x.svg)](y)',
      '',
      'quanthea ships as one image, `ghcr.io/jboix/quanthea`, for [linux](a.md) and **arm64**.',
      '',
      '## Quick start',
    ].join('\n');
    expect(docTitle(markdown)).toBe('Deploying quanthea');
    expect(docDescription(markdown)).toBe(
      'quanthea ships as one image, ghcr.io/jboix/quanthea, for linux and arm64.',
    );
    const long = `# T\n\n${'word '.repeat(60)}`;
    expect(docDescription(long).length).toBeLessThanOrEqual(155);
    expect(docDescription(long).endsWith('…')).toBe(true);
  });

  test('read the code blocks of one section, up to the next heading of its level', () => {
    const markdown = [
      '# Tool',
      '```sh',
      'npm create tool',
      '```',
      '## Run it',
      '```sh',
      'docker run',
      '# not a heading',
      '```',
      '### Without Docker',
      '```sh',
      'bun install',
      'bun run start',
      '```',
      '## Develop',
      '```sh',
      'bun run dev',
      '```',
    ].join('\n');
    expect(codeBlocksUnder(markdown, 'Tool')).toHaveLength(4);
    expect(codeBlocksUnder(markdown, 'Tool')[0]).toBe('npm create tool');
    expect(codeBlocksUnder(markdown, 'Run it')).toEqual([
      'docker run\n# not a heading',
      'bun install\nbun run start',
    ]);
    expect(codeBlocksUnder(markdown, 'Missing')).toEqual([]);
  });

  test('join the base and a path with one slash', () => {
    expect(joinBase('/', 'docs/')).toBe('/docs/');
    expect(joinBase('/quanthea', '/docs/')).toBe('/quanthea/docs/');
    expect(joinBase('/quanthea/', '')).toBe('/quanthea/');
  });
});
