import { test } from 'node:test';
import assert from 'node:assert/strict';
import { packagesToPublish, parseEnv, stageCaddyfile, stageVersion } from './stage.mjs';

const persona = { upn: 'ada@corp.example', email: 'ada@example.com', displayName: 'Ada Admin' };

test('a staged version keeps the tree version and names the round', () => {
	assert.equal(stageVersion('4.21.0', 1), '4.21.0-stage.1');
	assert.equal(stageVersion('4.21.0-beta.9', 2), '4.21.0-beta.9.stage.2');
});

test('the Caddyfile serves plain http and proxies to the app on loopback', () => {
	const text = stageCaddyfile();
	assert.match(text, /^:8080 \{$/m);
	assert.match(text, /reverse_proxy 127\.0\.0\.1:3000/);
	assert.doesNotMatch(text, /SELVA-/);
});

test('a persona is injected after the inbound headers are stripped', () => {
	const text = stageCaddyfile({ persona });
	const strip = text.indexOf('request_header -SELVA-Email');
	const inject = text.indexOf('request_header SELVA-Email "ada@example.com"');
	assert.ok(strip !== -1 && inject > strip);
	assert.ok(inject < text.indexOf('reverse_proxy'));
	assert.match(text, /SELVA-UserPrincipalName "ada@corp\.example"/);
});

test('a forwarded port answers on loopback only', () => {
	const text = stageCaddyfile({ forwardPort: 54421 });
	assert.match(
		text,
		/:54421 \{\n\tbind 127\.0\.0\.1\n\treverse_proxy host\.docker\.internal:54421/
	);
});

const workspace = [
	{ name: '@selvajs/cli', dependencies: {} },
	{ name: '@selvajs/selva', dependencies: { zod: '^4' } },
	{ name: '@selvajs/supabase-provider', dependencies: { '@selvajs/platform': '^1' } },
	{ name: '@selvajs/platform', dependencies: { '@selvajs/schemas': '^5' } },
	{ name: '@selvajs/schemas', dependencies: {} },
	{ name: '@selvajs/ui', dependencies: {} }
];

test('a local deployment publishes the app and the CLI', () => {
	const names = packagesToPublish('local', workspace).map((pkg) => pkg.name);
	assert.deepEqual(names, ['@selvajs/cli', '@selvajs/selva']);
});

test('a supabase deployment adds the provider and what it installs', () => {
	const packages = packagesToPublish('supabase', workspace);
	assert.deepEqual(
		packages.map((pkg) => [pkg.name, pkg.bump]),
		[
			['@selvajs/cli', true],
			['@selvajs/selva', true],
			['@selvajs/supabase-provider', true],
			['@selvajs/platform', false],
			['@selvajs/schemas', false]
		]
	);
});

test('parseEnv reads assignments and drops comments and quotes', () => {
	assert.deepEqual(parseEnv('# note\nA=1\r\nB="two words"\n\nnot a line'), {
		A: '1',
		B: 'two words'
	});
});
