// Markdown formatting and link checks: `bun run docs:check`, `bun run docs:format`.
import remarkGfm from 'remark-gfm';
import remarkValidateLinks from 'remark-validate-links';

export default {
  settings: {
    bullet: '-',
    emphasis: '_',
    strong: '*',
    fence: '`',
    rule: '-',
    listItemIndent: 'one',
  },
  plugins: [remarkGfm, [remarkValidateLinks, { repository: 'jboix/querent' }]],
};
