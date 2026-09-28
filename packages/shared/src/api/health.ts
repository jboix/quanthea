/** `GET /api/health`: liveness and version. Public. */
import { z } from 'zod';
import { defineEndpoint } from './contract.ts';

/** Reports that the server is up and which version it runs. */
export const healthEndpoint = defineEndpoint({
  method: 'GET',
  path: '/health',
  output: z.object({
    status: z.literal('ok'),
    version: z.string(),
  }),
});
