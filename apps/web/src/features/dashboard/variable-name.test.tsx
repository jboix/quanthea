import { expect, test } from 'bun:test';
import type { Variable } from '@quanthea/shared';
import { renderToStaticMarkup } from 'react-dom/server';
import { VariableName } from './variable-chip.tsx';

const service: Variable = { kind: 'text', name: 'service', default: 'api' };

test('a chip shows the label of its variable, with $name as its tooltip', () => {
  const html = renderToStaticMarkup(<VariableName variable={{ ...service, label: 'Service' }} />);
  expect(html).toContain('>Service<');
  expect(html).toContain('title="$service"');
});

test('a chip without a label shows $name', () => {
  const html = renderToStaticMarkup(<VariableName variable={service} />);
  expect(html).toContain('>$service<');
  expect(html).not.toContain('title=');
});
