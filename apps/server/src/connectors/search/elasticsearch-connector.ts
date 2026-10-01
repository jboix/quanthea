/** The Elasticsearch connector kind: basic authentication or an API key. */
import { z } from 'zod';
import { elasticsearchIcon } from './icons.ts';
import { basicAuth, defineSearchKind } from './search-kind.ts';

/** The configuration of an Elasticsearch connector. */
const configSchema = z.object({
  url: z.url({ protocol: /^https?$/ }).meta({ title: 'URL', examples: ['https://elastic:9200'] }),
  auth: z.enum(['basic', 'api-key', 'none']).default('basic').meta({ title: 'Authentication' }),
  username: z
    .string()
    .trim()
    .optional()
    .meta({ title: 'Username', description: 'For basic authentication.' }),
  verifyTls: z.boolean().default(true).meta({ title: 'Verify the TLS certificate' }),
});

/** The credentials of an Elasticsearch connector. */
const secretSchema = z.object({
  password: z
    .string()
    .optional()
    .meta({ title: 'Password', description: 'For basic authentication.' }),
  apiKey: z
    .string()
    .optional()
    .meta({ title: 'API key', description: 'The encoded key, as Elasticsearch returns it.' }),
});

/** The Elasticsearch connector kind. */
export const elasticsearchConnector = defineSearchKind({
  kind: 'elasticsearch',
  name: 'Elasticsearch',
  icon: elasticsearchIcon,
  configSchema,
  secretSchema,
  headers(config, secret) {
    if (config.auth === 'none') return {};
    if (config.auth === 'basic') return basicAuth(config.username, secret.password);
    return secret.apiKey ? { Authorization: `ApiKey ${secret.apiKey}` } : 'Set the API key.';
  },
});
