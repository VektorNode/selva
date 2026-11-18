// Fills a fresh dev server or staged deployment with every definition in examples/definitions:
// claims the instance (or signs in), registers `pnpm compute:local` when no Compute server is
// set, makes an org and project where multi-tenant has none, then uploads what is missing.
//
// Driven over HTTP as a browser would, so it reaches a staged container the same way it reaches
// a dev server. Uploads go through Compute: the schema is extracted before anything is saved.

import { createHmac, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const examplesDir = path.join(rootDir, 'examples', 'definitions');

export const SEED_EMAIL = 'admin@dev.local';
// Throwaway instances only; override when an existing admin has another password.
export const SEED_PASSWORD = process.env.SELVA_SEED_PASSWORD ?? 'selva-examples';
export const LOCAL_COMPUTE_PORT = process.env.SELVA_COMPUTE_LOCAL_PORT ?? '6510';

/** Where `pnpm compute:local` keeps the key it generated, or null before its first run. */
export function localComputeKey() {
	const file = path.join(rootDir, '.selva-data', 'compute-local', 'compute-key');
	return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim() : null;
}

/** Same derivation as `setupToken` in @selvajs/platform/config. */
export function setupToken(hmacKey) {
	return createHmac('sha256', hmacKey.trim()).update('selva:setup:v1').digest('base64url');
}

/** The "Shows" column of examples/README.md, by file name. */
function descriptions() {
	const readme = fs.readFileSync(path.join(rootDir, 'examples', 'README.md'), 'utf8');
	const out = {};
	for (const match of readme.matchAll(/^\|\s*`definitions\/([^`]+)`\s*\|\s*([^|]+?)\s*\|/gm)) {
		if (match[2] !== 'Not yet described') out[match[1]] = match[2];
	}
	return out;
}

function displayName(file) {
	return path
		.basename(file, path.extname(file))
		.split('-')
		.map((word) => word[0].toUpperCase() + word.slice(1))
		.join(' ');
}

export function client(appUrl) {
	const origin = new URL(appUrl).origin;
	const cookies = new Map();

	async function request(pathname, init = {}) {
		const headers = new Headers(init.headers);
		// SvelteKit refuses a form POST whose Origin isn't its own.
		headers.set('origin', origin);
		if (cookies.size > 0) {
			headers.set('cookie', [...cookies].map(([k, v]) => `${k}=${v}`).join('; '));
		}
		const res = await fetch(new URL(pathname, origin), { ...init, headers, redirect: 'manual' });
		for (const line of res.headers.getSetCookie()) {
			const [pair] = line.split(';');
			const at = pair.indexOf('=');
			cookies.set(pair.slice(0, at).trim(), pair.slice(at + 1));
		}
		return res;
	}

	async function json(pathname, init = {}) {
		const res = await request(pathname, {
			...init,
			headers: { accept: 'application/json', 'content-type': 'application/json', ...init.headers }
		});
		const text = await res.text();
		if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${pathname}: ${res.status} ${text}`);
		return text ? JSON.parse(text) : null;
	}

	/** A form action as `use:enhance` posts it: the outcome comes back as JSON, not a page. */
	async function action(pathname, fields) {
		const res = await request(pathname, {
			method: 'POST',
			headers: { accept: 'application/json', 'x-sveltekit-action': 'true' },
			body: new URLSearchParams(fields)
		});
		return res.json();
	}

	return { request, json, action };
}

async function signIn(api, { hmacKey, log }) {
	const setup = await api.action('/setup', {
		token: hmacKey ? setupToken(hmacKey) : '',
		companyName: 'Selva Examples',
		email: SEED_EMAIL,
		password: SEED_PASSWORD,
		confirm: SEED_PASSWORD
	});
	if (setup.type === 'redirect') {
		log(`  claimed the instance as ${SEED_EMAIL} / ${SEED_PASSWORD}`);
		return;
	}

	const login = await api.action('/login', { email: SEED_EMAIL, password: SEED_PASSWORD });
	if (login.type !== 'redirect') {
		throw new Error(
			`Couldn't sign in as ${SEED_EMAIL}. Setup said ${JSON.stringify(setup.data)}, login said ` +
				`${JSON.stringify(login.data)}. Another admin owns this instance: set SELVA_SEED_PASSWORD.`
		);
	}
	log(`  signed in as ${SEED_EMAIL}`);
}

export async function ensureCompute(api, { computeUrl, computeKey, log }) {
	const config = await api.json('/api/admin/compute');
	if (config.servers.length > 0) return;
	if (!computeKey) {
		throw new Error(
			'No Compute server is set and `pnpm compute:local` has not run: start it first.'
		);
	}
	const id = randomUUID();
	await api.json('/api/admin/compute', {
		method: 'PUT',
		body: JSON.stringify({
			servers: [
				{ id, label: 'Local Compute', serverUrl: computeUrl, apiKey: computeKey, sharedWith: 'all' }
			],
			defaultServerId: id
		})
	});
	log(`  registered Compute at ${computeUrl}`);
}

async function ensureProject(api, { tenancy, log }) {
	if (tenancy === 'multi') {
		const { orgs } = await api.json('/api/admin/orgs');
		if (orgs.length === 0) {
			await api.json('/api/admin/orgs', {
				method: 'POST',
				body: JSON.stringify({ name: 'Selva Examples', slug: 'selva-examples' })
			});
			log('  created org "Selva Examples"');
		}
	}
	const { items } = await api.json('/api/v1/projects');
	const project = items.find((p) => p.canCreateDefinitions);
	if (project) return project.id;
	const created = await api.json('/api/v1/projects', {
		method: 'POST',
		body: JSON.stringify({ name: 'Examples' })
	});
	log('  created project "Examples"');
	return created.id;
}

/**
 * Returns how many uploads failed.
 *
 * @param {object} opts
 * @param {string} opts.appUrl Where a browser opens the app; for header auth, the proxy that signs in.
 * @param {'local'|'supabase'|'header'} opts.auth
 * @param {'single'|'multi'} opts.tenancy
 * @param {string} [opts.hmacKey] The deployment's SELVA_HMAC_KEY, to claim an unclaimed instance.
 * @param {string} opts.computeUrl `pnpm compute:local` as the app reaches it.
 * @param {string} [opts.computeKey]
 */
export async function seedExamples(opts) {
	const log = opts.log ?? console.info;
	const api = client(opts.appUrl);
	log('→ Seeding examples/definitions…');

	// Header auth has no password: the proxy in front of the app signs every request in.
	if (opts.auth !== 'header') await signIn(api, { ...opts, log });
	await ensureCompute(api, { ...opts, log });
	const projectId = await ensureProject(api, { ...opts, log });

	const existing = new Set();
	let cursor;
	do {
		const page = await api.json(`/api/v1/definitions${cursor ? `?cursor=${cursor}` : ''}`);
		for (const item of page.items) existing.add(item.displayName);
		cursor = page.nextCursor;
	} while (cursor);

	const described = descriptions();
	const files = fs
		.readdirSync(examplesDir)
		.filter((f) => /\.ghx?$/.test(f))
		.sort();
	let failed = 0;
	for (const file of files) {
		const name = displayName(file);
		if (existing.has(name)) {
			log(`  = ${name}`);
			continue;
		}
		const form = new FormData();
		form.set('file', new Blob([fs.readFileSync(path.join(examplesDir, file))]), file);
		form.set('displayName', name);
		form.set('projectId', projectId);
		if (described[file]) form.set('description', described[file]);
		// Test data: an example whose plugin this Compute lacks still gets seeded.
		form.set('acceptMissingPlugins', 'true');

		const started = Date.now();
		let res = await api.request('/api/v1/definitions', { method: 'POST', body: form });
		// An idle Compute has stopped its children; the first schema call can time out while
		// one boots. By the retry it is warm.
		if (res.status === 503) {
			res = await api.request('/api/v1/definitions', { method: 'POST', body: form });
		}
		if (res.ok) {
			log(`  + ${name} (${((Date.now() - started) / 1000).toFixed(1)} s)`);
		} else {
			failed += 1;
			log(`  ✗ ${name}: ${res.status} ${await res.text()}`);
		}
	}
	return failed;
}
