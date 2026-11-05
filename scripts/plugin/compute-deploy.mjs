// Deploy or inspect Selva's own Rhino.Compute server.
//
//   pnpm run compute:deploy [status|logs|ssh]
//
// Settings come from infra/compute/.env (template: infra/compute/.env.example), never from the
// app's .env. The deploy tooling is compute.rhino3d, checked out next to this repo (override with
// COMPUTE_REPO=/path).

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const envFile = resolve('infra/compute/.env');
const repo = resolve(process.env.COMPUTE_REPO ?? '../compute.rhino3d');
const script = resolve(repo, 'setup/deploy-server.sh');

if (!existsSync(envFile)) {
	console.error(
		'infra/compute/.env missing — cp infra/compute/.env.example infra/compute/.env and fill it in.'
	);
	process.exit(1);
}
if (!existsSync(script)) {
	console.error(
		`${script} not found — check out compute.rhino3d next to this repo or set COMPUTE_REPO.`
	);
	process.exit(1);
}

// Through bash: Windows can't execute a .sh directly (Git Bash provides bash there).
const result = spawnSync('bash', [script, ...process.argv.slice(2)], {
	stdio: 'inherit',
	env: { ...process.env, ENV_FILE: envFile }
});
if (result.error) console.error(`Couldn't run ${script}: ${result.error.message}`);
process.exit(result.status ?? 1);
