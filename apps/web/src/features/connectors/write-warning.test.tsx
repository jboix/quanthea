import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { WriteWarning } from './write-warning.tsx';

test('shows the headline, what was found, the account to create and a copy button', () => {
  const html = renderToStaticMarkup(
    <WriteWarning
      access={{
        state: 'can-write',
        canDo: ['It is a superuser.', 'It can create roles.'],
        setup: "CREATE ROLE quanthea_read LOGIN PASSWORD 'choose-a-password';",
      }}
    />,
  );
  expect(html).toContain('These credentials can write. You may want to look at that.');
  expect(html).toContain('<li>It is a superuser.</li>');
  expect(html).toContain('<li>It can create roles.</li>');
  expect(html).toContain('CREATE ROLE quanthea_read LOGIN PASSWORD');
  expect(html).toMatch(/<button[^>]*>Copy<\/button>/);
  expect(html).toContain('Nothing is blocked');
});

test('offers no button that refuses or removes the connector', () => {
  const html = renderToStaticMarkup(
    <WriteWarning access={{ state: 'can-write', canDo: [], setup: undefined }} />,
  );
  expect(html).toContain('These credentials can write.');
  expect(html).not.toContain('<ul');
  expect(html).not.toContain('<button');
  expect(html).toContain('an account that can only read, if the source has one');
});

test('says the test could not tell when the source does not say, without the warning', () => {
  const html = renderToStaticMarkup(
    <WriteWarning access={{ state: 'unknown', setup: 'ACL SETUSER quanthea_read on' }} />,
  );
  expect(html).toContain('could not tell whether these credentials can write');
  expect(html).not.toContain('These credentials can write.');
  expect(html).toContain('ACL SETUSER quanthea_read on');
});

test('shows nothing for credentials that only read', () => {
  expect(renderToStaticMarkup(<WriteWarning access={{ state: 'quiet' }} />)).toBe('');
});
