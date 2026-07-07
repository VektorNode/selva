import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { ProviderError } from '@selvajs/platform';

/**
 * Allowlist row. Identity-only — per-user app state (permissions, profile,
 * starred definitions) lives in `user-data.json` owned by whatever data
 * provider is paired with this auth provider.
 *
 * The UPN is the lookup key the upstream proxy will send back on every
 * subsequent request. `email` and `displayName` start empty when an admin
 * pre-allowlists; they get filled in on the user's first visit from the
 * matching headers (one-time materialization).
 */
export interface AllowlistEntry {
	id: string;
	/** User Principal Name — case-folded for storage and lookup. */
	upn: string;
	email?: string;
	displayName?: string;
	createdAt: string;
	lastLoginAt?: string;
	disabled?: boolean;
}

interface AllowlistFile {
	users: AllowlistEntry[];
}

const empty = (): AllowlistFile => ({ users: [] });

const LAST_LOGIN_DEBOUNCE_MS = 60_000;

async function readFile(filePath: string): Promise<AllowlistFile> {
	try {
		const raw = await fs.readFile(filePath, 'utf-8');
		return JSON.parse(raw) as AllowlistFile;
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === 'ENOENT') return empty();
		throw err;
	}
}

async function writeFile(filePath: string, data: AllowlistFile): Promise<void> {
	await fs.mkdir(path.dirname(filePath), { recursive: true });
	const tmp = `${filePath}.tmp`;
	await fs.writeFile(tmp, JSON.stringify(data, null, '\t'), 'utf-8');
	await fs.rename(tmp, filePath);
}

export interface AllowlistStore {
	findByUpn(upn: string): Promise<AllowlistEntry | null>;
	/**
	 * Look up by email rather than UPN. Used as a fallback on first login when
	 * the proxy forwards a UPN that differs from the email an admin used to
	 * pre-allowlist the user (common on Entra: UPN `x@tenant.onmicrosoft.com`
	 * vs mail `x@company.com`). Without this, the UPN miss orphans the
	 * org-member row that was keyed to the allowlist UUID at provision time.
	 */
	findByEmail(email: string): Promise<AllowlistEntry | null>;
	findById(id: string): Promise<AllowlistEntry | null>;
	listUsers(): Promise<AllowlistEntry[]>;
	createUser(upn: string): Promise<AllowlistEntry>;
	/**
	 * Mirror identity fields from upstream-proxy headers. The proxy/IdP is the
	 * source of truth for email and display name: a stored value is replaced
	 * whenever the forwarded header differs, so IdP-side renames — and fixes to
	 * a misconfigured proxy that used to forward the wrong claim (e.g. the OIDC
	 * `sub` as display name) — heal the row on the user's next visit. An absent
	 * header leaves the stored value untouched; hand-edits to these two fields
	 * in the allowlist JSON do not survive the user's next login.
	 */
	syncFromHeaders(id: string, fields: { email?: string; displayName?: string }): Promise<void>;
	/**
	 * Repoint a row's UPN to the value the proxy actually forwards. Called once
	 * after an email-fallback match so subsequent logins resolve via the fast
	 * `findByUpn` path. No-ops if the new UPN already belongs to a different
	 * row (a collision means manual operator cleanup — never silently merge).
	 */
	rebindUpn(id: string, upn: string): Promise<void>;
	setDisabled(id: string, disabled: boolean): Promise<void>;
	touchLastLogin(id: string): Promise<void>;
	deleteUser(id: string): Promise<void>;
}

export function createAllowlistStore(filePath: string): AllowlistStore {
	const norm = (upn: string) => upn.trim().toLowerCase();

	return {
		async findByUpn(upn) {
			const { users } = await readFile(filePath);
			const key = norm(upn);
			return users.find((u) => u.upn === key) ?? null;
		},

		async findByEmail(email) {
			const { users } = await readFile(filePath);
			const key = norm(email);
			// Match the `email` column OR the `upn` column: admins pre-allowlist
			// via `createUser(email)`, which stores the email AS the upn (the
			// `email` column stays empty until first-login materialization). So
			// an email-keyed lookup has to consider both.
			return users.find((u) => norm(u.email ?? '') === key || u.upn === key) ?? null;
		},

		async findById(id) {
			const { users } = await readFile(filePath);
			return users.find((u) => u.id === id) ?? null;
		},

		async listUsers() {
			const { users } = await readFile(filePath);
			return users;
		},

		async createUser(upn) {
			const file = await readFile(filePath);
			const key = norm(upn);
			if (file.users.some((u) => u.upn === key)) {
				throw new ProviderError(`User with UPN "${upn}" already exists`, 409);
			}
			const entry: AllowlistEntry = {
				id: randomUUID(),
				upn: key,
				createdAt: new Date().toISOString()
			};
			file.users.push(entry);
			await writeFile(filePath, file);
			return entry;
		},

		async syncFromHeaders(id, fields) {
			const file = await readFile(filePath);
			const user = file.users.find((u) => u.id === id);
			if (!user) return;
			let dirty = false;
			if (fields.email && user.email !== fields.email) {
				user.email = fields.email;
				dirty = true;
			}
			if (fields.displayName && user.displayName !== fields.displayName) {
				user.displayName = fields.displayName;
				dirty = true;
			}
			if (dirty) await writeFile(filePath, file);
		},

		async rebindUpn(id, upn) {
			const file = await readFile(filePath);
			const key = norm(upn);
			const user = file.users.find((u) => u.id === id);
			if (!user || user.upn === key) return;
			// Don't merge into an existing row — a UPN collision is an operator
			// data issue, not something to paper over by reassigning identity.
			if (file.users.some((u) => u.id !== id && u.upn === key)) return;
			user.upn = key;
			await writeFile(filePath, file);
		},

		async setDisabled(id, disabled) {
			const file = await readFile(filePath);
			const user = file.users.find((u) => u.id === id);
			if (!user) throw new ProviderError(`User "${id}" not found`, 404);
			user.disabled = disabled;
			await writeFile(filePath, file);
		},

		async touchLastLogin(id) {
			const file = await readFile(filePath);
			const user = file.users.find((u) => u.id === id);
			if (!user) return;
			const now = Date.now();
			if (user.lastLoginAt) {
				const prev = Date.parse(user.lastLoginAt);
				if (Number.isFinite(prev) && now - prev < LAST_LOGIN_DEBOUNCE_MS) return;
			}
			user.lastLoginAt = new Date(now).toISOString();
			await writeFile(filePath, file);
		},

		async deleteUser(id) {
			const file = await readFile(filePath);
			const before = file.users.length;
			file.users = file.users.filter((u) => u.id !== id);
			if (file.users.length === before) throw new ProviderError(`User "${id}" not found`, 404);
			await writeFile(filePath, file);
		}
	};
}
