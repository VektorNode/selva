// The CLI's config rules are a deliberate duplicate of @selvajs/server/ops
// deploymentConfig.ts — the CLI is dependency-free by design, since it scaffolds
// the deployment that installs the runtime and so cannot import from it.
//
// Both sides assert the same fixture table, so a rule changed on one side and
// not the other fails here. The severity vocabularies differ by design
// (green/yellow/red for a terminal, ok/warn/fail for the admin panel); this maps
// between them rather than forcing either side to adopt the other's words.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkBodySizeLimit, checkClientAddress } from '../checks/config.js';
import { DEPLOYMENT_CONFIG_FIXTURES } from '../../../server/src/ops/__tests__/deployment-config-fixtures.js';

const VERDICT_OF = { green: 'ok', yellow: 'warn', red: 'fail' };

for (const fixture of DEPLOYMENT_CONFIG_FIXTURES) {
	test(`matches @selvajs/server/ops: ${fixture.name}`, () => {
		assert.equal(VERDICT_OF[checkClientAddress(fixture.env).severity], fixture.clientAddress);
		assert.equal(VERDICT_OF[checkBodySizeLimit(fixture.env).severity], fixture.bodySizeLimit);
	});
}
