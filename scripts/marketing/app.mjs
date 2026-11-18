#!/usr/bin/env node

/**
 * Stills of the Selva app's admin and team pages, on an instance this script fills with a made-up
 * studio: people, pending invites, projects, API tokens.
 *
 *   node scripts/marketing/app.mjs [--url http://localhost:5373] [--only seed|stills]
 *
 * Point it at a throwaway instance only: it claims the instance as its own admin. Start one with
 * the command in scripts/marketing/README.md. Writes to marketing/app/.
 */

import fs from 'node:fs';
import path from 'node:path';

import { parseEnv } from '../develop/provider-mix.mjs';
import { client, setupToken } from '../develop/seed-examples.mjs';
import { PHONE, flag, launch, openPage, root, still } from './lib.mjs';

const appUrl = flag('url', 'http://localhost:5373');
const only = flag('only');

// A made-up studio on a reserved TLD: no real person or company, and no customer's domain.
const PASSWORD = 'selva-marketing-1';
const COMPANY = 'Northfold Studio';
const OWNER = { name: 'Mara Lindqvist', email: 'mara@northfold.example' };
const PEOPLE = [
	{
		name: 'Jonas Keller',
		email: 'jonas@northfold.example',
		orgRole: 'admin',
		permissions: ['manage_org_members', 'manage_projects']
	},
	{
		name: 'Aiko Tanaka',
		email: 'aiko@northfold.example',
		orgRole: 'member',
		permissions: ['manage_definitions']
	},
	{ name: 'Sam Okafor', email: 'sam@northfold.example', orgRole: 'member', permissions: [] },
	{
		name: 'Lena Fischer',
		email: 'lena@northfold.example',
		orgRole: 'member',
		permissions: ['manage_definitions']
	}
];
const PENDING = ['tomas@northfold.example', 'priya@fieldworks.example'];
const PROJECTS = [
	{
		name: 'Kitchens',
		description: 'Configurators the showroom sends to customers.',
		visibility: 'org',
		members: { 'Aiko Tanaka': 'editor', 'Sam Okafor': 'viewer' }
	},
	{
		name: 'Furniture',
		description: 'Shelving and storage, made to order.',
		visibility: 'org',
		members: { 'Lena Fischer': 'editor' }
	},
	{
		name: 'Lighting',
		description: 'Task lamps and pendants.',
		visibility: 'org',
		members: { 'Aiko Tanaka': 'owner' }
	},
	{
		name: 'Urban studies',
		description: 'Massing options for competition entries.',
		visibility: 'private',
		members: { 'Jonas Keller': 'editor', 'Lena Fischer': 'viewer' }
	},
	{
		name: 'Landscape',
		description: 'Gardens drawn on site.',
		visibility: 'private',
		members: { 'Sam Okafor': 'editor' }
	}
];
const TOKENS = [
	{ name: 'ERP integration', scopes: ['write:all'], expiresInDays: 180 },
	{ name: 'Nightly price check', scopes: ['read:all'], expiresInDays: 90 }
];

// ============================================================================
// Seed
// ============================================================================

/** Every step tolerates "already there", so a second run only adds what is missing. */
async function seed() {
	const api = client(appUrl);
	const env = parseEnv(fs.readFileSync(path.join(root, 'packages/selva/.env.dev-local'), 'utf8'));
	const hmacKey = process.env.SELVA_HMAC_KEY ?? env.SELVA_HMAC_KEY;

	const setup = await api.action('/setup', {
		token: setupToken(hmacKey),
		companyName: COMPANY,
		displayName: OWNER.name,
		email: OWNER.email,
		password: PASSWORD,
		confirm: PASSWORD
	});
	if (setup.type !== 'redirect') {
		const login = await api.action('/login', { email: OWNER.email, password: PASSWORD });
		if (login.type !== 'redirect') {
			throw new Error(
				`${appUrl} belongs to another admin: this script only runs on its own instance.`
			);
		}
	}

	let { orgs } = await api.json('/api/admin/orgs');
	if (orgs.length === 0) {
		await api.json('/api/admin/orgs', {
			method: 'POST',
			body: JSON.stringify({ name: COMPANY, slug: 'northfold' })
		});
		({ orgs } = await api.json('/api/admin/orgs'));
	}
	const orgId = orgs[0].id;

	const invites = await api.json(`/api/v1/orgs/${orgId}/invites`);
	const invited = new Set(invites.items.map((invite) => invite.email));

	for (const person of PEOPLE) {
		if (invited.has(person.email)) continue;
		const invite = await api.json(`/api/v1/orgs/${orgId}/invites`, {
			method: 'POST',
			body: JSON.stringify({
				email: person.email,
				orgRole: person.orgRole,
				permissions: person.permissions
			})
		});
		// Accepted in a session of its own, as the invited person would.
		const guest = client(appUrl);
		const token = new URL(invite.acceptUrl).searchParams.get('token');
		const accepted = await guest.action(`/accept-invite?token=${token}`, {
			token,
			displayName: person.name,
			password: PASSWORD,
			confirm: PASSWORD
		});
		console.info(`  ${person.name}: ${accepted.type}`);
	}
	for (const email of PENDING) {
		if (invited.has(email)) continue;
		await api.json(`/api/v1/orgs/${orgId}/invites`, {
			method: 'POST',
			body: JSON.stringify({ email })
		});
	}

	// The members listing carries ids only; names come from the instance's user list.
	const { users } = await api.json('/api/admin/users');
	const idOf = Object.fromEntries(
		PEOPLE.map((person) => [person.name, users.find((user) => user.email === person.email)?.id])
	);
	const existing = new Map((await api.json('/api/v1/projects')).items.map((p) => [p.name, p.id]));
	for (const project of PROJECTS) {
		const id =
			existing.get(project.name) ??
			(
				await api.json('/api/v1/projects', {
					method: 'POST',
					body: JSON.stringify({
						name: project.name,
						description: project.description,
						visibility: project.visibility
					})
				})
			).id;
		const members = await api.json(`/api/v1/projects/${id}/members`);
		const joined = new Set((members.items ?? members.members ?? []).map((member) => member.userId));
		for (const [name, role] of Object.entries(project.members)) {
			if (!idOf[name] || joined.has(idOf[name])) continue;
			await api.json(`/api/v1/projects/${id}/members`, {
				method: 'POST',
				body: JSON.stringify({ userId: idOf[name], role })
			});
		}
	}

	const tokens = await api.json(`/api/v1/orgs/${orgId}/tokens`);
	const named = new Set(tokens.items.map((token) => token.name));
	for (const token of TOKENS) {
		if (named.has(token.name)) continue;
		await api.json(`/api/v1/orgs/${orgId}/tokens`, { method: 'POST', body: JSON.stringify(token) });
	}
	console.info(`Seeded ${COMPANY} at ${appUrl}: sign in as ${OWNER.email} / ${PASSWORD}`);
}

// ============================================================================
// Stills
// ============================================================================

const PAGES = [
	'/admin',
	'/admin/users',
	'/admin/organizations',
	'/admin/projects',
	'/admin/compute',
	'/admin/audit',
	'/admin/system',
	'/team',
	'/team/members',
	'/team/projects',
	'/team/tokens',
	'/team/shares',
	'/team/activity',
	'/team/compute',
	'/team/settings',
	'/projects',
	'/library',
	'/docs/api'
];

async function signIn(page) {
	// The dev server compiles a route on its first visit, which can outlast the default wait.
	await page.goto(`${appUrl}/login`, { waitUntil: 'domcontentloaded', timeout: 180_000 });
	await page.getByLabel('Email').fill(OWNER.email);
	await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
	await page.getByRole('button', { name: /sign in with password/i }).click();
	await page.waitForURL((url) => !/\/login$/.test(url.pathname), { timeout: 180_000 });
}

async function visit(page, pathname) {
	await page.goto(appUrl + pathname, { waitUntil: 'domcontentloaded', timeout: 180_000 });
	await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => {});
	await page.waitForTimeout(900);
}

const fileFor = (pathname) => pathname.slice(1).replaceAll('/', '-');

async function stills() {
	const browser = await launch();
	try {
		const signedOut = await openPage(browser);
		await visit(signedOut, '/login');
		await still(signedOut, 'app/login');
		await signedOut.context().close();

		for (const dark of [false, true]) {
			const page = await openPage(browser, { dark });
			await signIn(page);
			for (const pathname of PAGES) {
				await visit(page, pathname);
				await still(page, `app/${dark ? 'dark' : 'light'}/${fileFor(pathname)}`, { tall: true });
			}
			await page.context().close();
		}

		const phone = await openPage(browser, { viewport: PHONE, scale: 3 });
		await signIn(phone);
		for (const pathname of ['/team/members', '/projects', '/library']) {
			await visit(phone, pathname);
			await still(phone, `app/phone/${fileFor(pathname)}`);
		}
		await phone.context().close();
	} finally {
		await browser.close();
	}
}

if (only !== 'stills') await seed();
if (only !== 'seed') await stills();
