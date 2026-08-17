// The generated Caddyfile is the deployment's entire network edge. Every
// assertion here is a property something downstream depends on — TLS, the
// loopback bind, or the header set — not a formatting preference.
//
// Run by `pnpm test` via node's built-in runner.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderCaddyfile, isServableDomain, originFor } from '../caddyfile.js';

const render = (over = {}) =>
	renderCaddyfile({ domain: 'app.example.dev', acmeEmail: 'ops@example.dev', ...over });

test('the site block proxies to the app on loopback', () => {
	// The app binds 127.0.0.1 deliberately; a proxy pointing anywhere else means
	// either the wrong process or an app exposed directly to the network.
	assert.match(render(), /reverse_proxy 127\.0\.0\.1:3000/);
});

test('ACME email is set globally so certificates can actually issue', () => {
	assert.match(render(), /^\{\n\temail ops@example\.dev\n\}/);
});

test('HSTS is present — the cookie policy depends on it', () => {
	assert.match(render(), /Strict-Transport-Security/);
});

test('API responses are never cached at the edge', () => {
	// A cached /api/* response serves one user's data to another.
	const out = render();
	assert.match(out, /@api path \/api\/\*/);
	assert.match(out, /header @api Cache-Control "no-cache, no-store, must-revalidate"/);
});

test('an apex domain gets a www redirect', () => {
	const out = renderCaddyfile({ domain: 'example.dev', acmeEmail: 'a@b.c' });
	assert.match(out, /www\.example\.dev \{/);
	assert.match(out, /redir https:\/\/example\.dev\{uri\} permanent/);
});

test('a subdomain gets no www block', () => {
	// www.app.example.dev is not a name anyone points at, and Caddy would retry
	// a doomed certificate request for it on every boot.
	assert.ok(!render().includes('www.app.example.dev'));
});

test('the body limit matches what the app accepts', () => {
	// A smaller edge limit rejects uploads the app would have taken, and the
	// error surfaces as a bare 413 with no app-side log. Tracks the app's
	// COMPUTE_REQUEST_MAX_BYTES / BODY_SIZE_LIMIT defaults (both 256 MB).
	assert.match(render(), /max_size 256mb/);
});

test('a custom port is honoured', () => {
	assert.match(render({ port: 4000 }), /reverse_proxy 127\.0\.0\.1:4000/);
});

test('domains are validated before they reach a certificate request', () => {
	for (const good of ['example.dev', 'app.example.dev', 'a-b.example.co.uk']) {
		assert.ok(isServableDomain(good), `${good} should be accepted`);
	}
	for (const bad of [
		'localhost',
		'https://app.example.dev',
		'app.example.dev/path',
		'app.example.dev:443',
		'',
		'   ',
		null,
		undefined
	]) {
		assert.ok(!isServableDomain(bad), `${JSON.stringify(bad)} should be rejected`);
	}
});

test('the origin a domain implies is always https', () => {
	// Plain HTTP drops the Secure session cookie, so there is no http variant to
	// generate here — that is the whole reason this helper exists.
	assert.equal(originFor('app.example.dev'), 'https://app.example.dev');
});
