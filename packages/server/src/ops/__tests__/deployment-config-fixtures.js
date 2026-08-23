// Verdicts both implementations of the deployment-config rules must agree on:
// `@selvajs/server/ops` (TypeScript, imported by the admin health endpoint) and
// `packages/cli/src/checks/config.js` (JavaScript, dependency-free by design).
//
// Plain JS with no imports so `node --test` in the CLI and vitest in this
// package can both load it. Add a case here when you add or change a rule —
// whichever side you forget to update then fails CI.

/** @typedef {{ name: string, env: Record<string, string>, clientAddress: 'ok'|'warn'|'fail', bodySizeLimit: 'ok'|'warn'|'fail' }} ConfigFixture */

/** @type {ConfigFixture[]} */
export const DEPLOYMENT_CONFIG_FIXTURES = [
	{
		name: 'no proxy, no limits set',
		env: {},
		clientAddress: 'ok',
		bodySizeLimit: 'fail'
	},
	{
		name: 'proxy set up correctly',
		env: {
			ORIGIN: 'https://example.com',
			ADDRESS_HEADER: 'X-Forwarded-For',
			XFF_DEPTH: '1',
			BODY_SIZE_LIMIT: '256M'
		},
		clientAddress: 'ok',
		bodySizeLimit: 'ok'
	},
	{
		name: 'ORIGIN set but ADDRESS_HEADER missing — shared rate-limit bucket',
		env: { ORIGIN: 'https://example.com', BODY_SIZE_LIMIT: '256M' },
		clientAddress: 'fail',
		bodySizeLimit: 'ok'
	},
	{
		name: 'X-Forwarded-For without XFF_DEPTH — spoofable',
		env: {
			ORIGIN: 'https://example.com',
			ADDRESS_HEADER: 'X-Forwarded-For',
			BODY_SIZE_LIMIT: '256M'
		},
		clientAddress: 'warn',
		bodySizeLimit: 'ok'
	},
	{
		name: 'non-XFF address header needs no depth',
		env: {
			ORIGIN: 'https://example.com',
			ADDRESS_HEADER: 'CF-Connecting-IP',
			BODY_SIZE_LIMIT: '256M'
		},
		clientAddress: 'ok',
		bodySizeLimit: 'ok'
	},
	{
		name: 'XFF_DEPTH is not a positive integer',
		env: {
			ORIGIN: 'https://example.com',
			ADDRESS_HEADER: 'X-Forwarded-For',
			XFF_DEPTH: '0',
			BODY_SIZE_LIMIT: '256M'
		},
		clientAddress: 'fail',
		bodySizeLimit: 'ok'
	},
	{
		name: 'body limit below the compute request cap',
		env: {
			ORIGIN: 'https://example.com',
			ADDRESS_HEADER: 'X-Forwarded-For',
			XFF_DEPTH: '1',
			BODY_SIZE_LIMIT: '210M'
		},
		clientAddress: 'ok',
		bodySizeLimit: 'warn'
	},
	{
		name: 'body limit adapter-node cannot parse — throws on boot',
		env: { BODY_SIZE_LIMIT: '256mb' },
		clientAddress: 'ok',
		bodySizeLimit: 'fail'
	},
	{
		name: 'explicit COMPUTE_REQUEST_MAX_BYTES lowers the bar',
		env: { BODY_SIZE_LIMIT: '100M', COMPUTE_REQUEST_MAX_BYTES: String(64 * 1024 * 1024) },
		clientAddress: 'ok',
		bodySizeLimit: 'ok'
	}
];
