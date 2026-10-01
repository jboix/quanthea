/** The OpenSearch connector kind: basic authentication or a bearer token from the security plugin. */
import { z } from 'zod';
import { opensearchIcon } from './icons.ts';
import { basicAuth, defineSearchKind } from './search-kind.ts';

/** The configuration of an OpenSearch connector. */
const configSchema = z.object({
  url: z
    .url({ protocol: /^https?$/ })
    .meta({ title: 'URL', examples: ['https://opensearch:9200'] }),
  auth: z.enum(['basic', 'bearer', 'none']).default('basic').meta({ title: 'Authentication' }),
  username: z
    .string()
    .trim()
    .optional()
    .meta({ title: 'Username', description: 'For basic authentication.' }),
  verifyTls: z.boolean().default(true).meta({ title: 'Verify the TLS certificate' }),
});

/** The credentials of an OpenSearch connector. */
const secretSchema = z.object({
  password: z
    .string()
    .optional()
    .meta({ title: 'Password', description: 'For basic authentication.' }),
  token: z
    .string()
    .optional()
    .meta({ title: 'Bearer token', description: 'A JWT the security plugin accepts.' }),
});

/** The OpenSearch connector kind. */
export const opensearchConnector = defineSearchKind({
  kind: 'opensearch',
  name: 'OpenSearch',
  icon: opensearchIcon,
  configSchema,
  secretSchema,
  headers(config, secret) {
    if (config.auth === 'none') return {};
    if (config.auth === 'basic') return basicAuth(config.username, secret.password);
    return secret.token ? { Authorization: `Bearer ${secret.token}` } : 'Set the token.';
  },
});
