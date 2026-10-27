/**
 * The server's whole environment. SvelteKit 3's `$app/env/private` (and the deprecated
 * `$env/dynamic/private`, now an alias of it) exposes only variables declared in `src/env.ts`,
 * but the providers read whatever the operator's `.env` holds. In dev, `vite.config.ts` loads
 * `.env` into `process.env`; in production the process is started with it.
 */
export const env: Record<string, string | undefined> = process.env;
