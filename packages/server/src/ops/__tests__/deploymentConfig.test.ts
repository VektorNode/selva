import { describe, expect, it } from 'vitest';
import { checkBodySizeLimit, checkClientAddress, parseBodySizeLimit } from '../deploymentConfig.js';
// @ts-expect-error — plain JS fixture table, shared with the CLI's node --test suite.
import { DEPLOYMENT_CONFIG_FIXTURES } from './deployment-config-fixtures.js';

describe('deployment config rules', () => {
	for (const fixture of DEPLOYMENT_CONFIG_FIXTURES) {
		it(fixture.name, () => {
			expect(checkClientAddress(fixture.env).verdict).toBe(fixture.clientAddress);
			expect(checkBodySizeLimit(fixture.env).verdict).toBe(fixture.bodySizeLimit);
		});
	}

	it('every non-ok finding carries a remediation', () => {
		for (const fixture of DEPLOYMENT_CONFIG_FIXTURES) {
			for (const finding of [checkClientAddress(fixture.env), checkBodySizeLimit(fixture.env)]) {
				if (finding.verdict !== 'ok') expect(finding.remediation).toBeTruthy();
			}
		}
	});
});

describe('parseBodySizeLimit', () => {
	it('reads only the last character as a unit, like adapter-node', () => {
		expect(parseBodySizeLimit('60m')).toBe(60 * 1024 * 1024);
		expect(parseBodySizeLimit('1G')).toBe(1024 * 1024 * 1024);
		expect(parseBodySizeLimit('512')).toBe(512);
		expect(parseBodySizeLimit('60mb')).toBeNull();
		expect(parseBodySizeLimit('')).toBeNull();
		expect(parseBodySizeLimit(undefined)).toBeNull();
	});
});
