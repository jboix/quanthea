/**
 * The JSON Schema of the configuration file, for editor completion and checks. It is built from the
 * same schemas the server validates the file with, and written to `docs/configuration.schema.json`
 * by `bun run config:schema`; a test fails when that file is out of date.
 */
import {
  chartSettingsSchema,
  connectorNameSchema,
  modelGatewaySchema,
  providerConfigSchema,
  querySettingsSchema,
  retentionSettingsSchema,
} from '@querent/shared';
import { z } from 'zod';
import { settingSpecs } from '../config/config.ts';
import { declaredSchema as declaredConnector } from './connectors.ts';
import { declaredSchema as declaredProvider } from './sign-in.ts';
import { declaredSchema as declaredUser } from './users.ts';

/** Where the published schema lives, for the `$schema` of an exported file. */
export const configSchemaUrl =
  'https://raw.githubusercontent.com/jboix/querent/main/docs/configuration.schema.json';

/** A secret, which the file only ever refers to. */
const secretReference = z
  .string()
  .regex(/^(\$\{[A-Za-z_][A-Za-z0-9_]*\}|file:.+)$/)
  .describe(
    'An environment variable in braces after a dollar sign, or file:/path. Never the secret.',
  );

/** The `server` section: the system settings, each optional. */
const serverSection = z
  .strictObject(
    Object.fromEntries(
      Object.entries(settingSpecs).map(([key, spec]) => [
        key,
        spec.schema.optional().describe(`${spec.label}. ${spec.variable} overrides it.`),
      ]),
    ),
  )
  .describe('System settings, read at startup.');

/** The `model` section, with an API key reference per provider; limits and behaviour default. */
const modelSection = z
  .object({
    ...modelGatewaySchema.shape,
    providers: z.array(providerConfigSchema.and(z.object({ apiKey: secretReference.optional() }))),
    limits: modelGatewaySchema.shape.limits.optional(),
    behaviour: modelGatewaySchema.shape.behaviour.optional(),
  })
  .describe('The model gateway, managed as a whole.');

/** The whole file. */
const configFileSchema = z
  .strictObject({
    $schema: z.string().optional(),
    server: serverSection.optional(),
    users: z
      .record(z.email(), declaredUser.safeExtend({ password: secretReference.optional() }))
      .optional()
      .describe('Users by email. A password is set only while the user has none.'),
    signIn: z
      .strictObject({
        passwordSignIn: z.boolean().optional(),
        providers: z
          .record(
            z.string().regex(/^[a-z0-9-]{1,40}$/),
            declaredProvider.safeExtend({ clientSecret: secretReference }),
          )
          .optional(),
      })
      .optional(),
    connectors: z
      .record(
        connectorNameSchema,
        declaredConnector.safeExtend({ secret: z.record(z.string(), secretReference).optional() }),
      )
      .optional()
      .describe('Connectors by name.'),
    model: modelSection.optional(),
    retention: retentionSettingsSchema.optional(),
    charts: chartSettingsSchema.optional(),
    queries: querySettingsSchema.optional(),
    provisioning: z
      .strictObject({ prune: z.boolean().optional() })
      .optional()
      .describe('prune: true deletes what the file no longer declares.'),
  })
  .describe('A querent configuration file.');

/**
 * The JSON Schema of the configuration file.
 *
 * @returns The schema.
 */
export function configJsonSchema(): Record<string, unknown> {
  return {
    ...z.toJSONSchema(configFileSchema, { io: 'input', unrepresentable: 'any' }),
    title: 'querent configuration',
  };
}
