// Builds the @selvajs/compute typedoc reference and copies it into static/ so
// the site serves it at /docs/api/compute. Both the typedoc output and the
// copy under static/ are gitignored — regenerated on every build.
import { execSync } from 'node:child_process';
import { cpSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');
const src = resolve(repoRoot, 'packages/compute/docs/api');
const dest = resolve(here, '../static/docs/api/compute');

execSync('pnpm --filter @selvajs/compute build-docs', { stdio: 'inherit', cwd: repoRoot });
rmSync(dest, { recursive: true, force: true });
cpSync(src, dest, { recursive: true });
