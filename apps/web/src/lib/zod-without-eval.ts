/**
 * Turns off Zod's JIT, which probes `new Function`. The CSP forbids it, and the browser reports
 * the probe as a violation. Zod reads the flag when a schema is built, so this module must run
 * before anything builds one: `main.tsx` imports it first, and the build puts it in Zod's own
 * chunk, which runs before the chunks that import Zod.
 */
import { z } from 'zod';

z.config({ jitless: true });
