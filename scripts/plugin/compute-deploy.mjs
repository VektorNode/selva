// Deploy or inspect Selva's own Rhino.Compute server.
//
//   pnpm run compute:deploy [status|logs|ssh]
//
// Runs vektornode-infra's deploy.sh for selva-gcp; COMPUTE_SERVER=selva-azure deploys the Azure one.
// vektornode-infra sits next to this repo (override with VEKTORNODE_INFRA=/path).

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const script = resolve(process.env.VEKTORNODE_INFRA ?? '../vektornode-infra', 'deploy.sh');
if (!existsSync(script)) {
	console.error(
		`${script} not found — check out vektornode-infra next to this repo or set VEKTORNODE_INFRA.`
	);
	process.exit(1);
}

// Through bash: Windows can't execute a .sh directly (Git Bash provides bash there).
const server = process.env.COMPUTE_SERVER ?? 'selva-gcp';
const result = spawnSync('bash', [script, server, ...process.argv.slice(2)], { stdio: 'inherit' });
if (result.error) console.error(`Couldn't run ${script}: ${result.error.message}`);
process.exit(result.status ?? 1);
