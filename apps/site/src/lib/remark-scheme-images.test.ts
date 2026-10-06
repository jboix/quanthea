import { describe, expect, test } from 'bun:test';
import type { MarkdownNode } from './remark-doc-links.ts';
import { type ImageNode, remarkSchemeImages, schemeImage } from './remark-scheme-images.ts';

describe('scheme images', () => {
  test("read GitHub's fragments as the scheme an image shows in", () => {
    expect(schemeImage('screenshots/a-light.webp#gh-light-mode-only')).toEqual({
      url: 'screenshots/a-light.webp',
      className: 'on-light',
    });
    expect(schemeImage('screenshots/a-dark.webp#gh-dark-mode-only')).toEqual({
      url: 'screenshots/a-dark.webp',
      className: 'on-dark',
    });
  });

  test('leave any other image alone', () => {
    expect(schemeImage('screenshots/a.webp')).toBeUndefined();
    expect(schemeImage('screenshots/a.webp#figure')).toBeUndefined();
  });

  test('drop the fragment and set the class on the image node', () => {
    const image: ImageNode = {
      type: 'image',
      url: '../screenshots/x-dark.webp#gh-dark-mode-only',
    };
    const tree: MarkdownNode = {
      type: 'root',
      children: [{ type: 'paragraph', children: [image] }],
    };
    remarkSchemeImages()(tree);
    expect(image).toEqual({
      type: 'image',
      url: '../screenshots/x-dark.webp',
      data: { hProperties: { className: ['on-dark'] } },
    });
  });
});
