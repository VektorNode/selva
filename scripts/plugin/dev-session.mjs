#!/usr/bin/env node

// Live UI Bridge sessions of a dev install (`pnpm install:plugin:dev`), from the files the plugin
// writes to `<LocalAppData>/Selva/dev/sessions/`. Each holds the full session URL, secret included.
//
//   pnpm plugin:session          every live session, newest first
//   pnpm plugin:session --url    the newest session's URL only, for scripts

import { readFileSync, readdirSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Where the plugin's `DevMode.Directory` points. */
export const devDir = () =>
	process.platform === 'win32'
		? join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData/Local'), 'Selva/dev')
		: join(homedir(), 'Library/Application Support/Selva/dev');

const alive = (pid) => {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		// EPERM: the process exists but belongs to someone else.
		return error.code === 'EPERM';
	}
};

/**
 * Sessions whose Rhino is still running, newest first. A crashed Rhino leaves its file behind, and
 * that file holds the session secret, so it is deleted here rather than skipped.
 */
export function liveSessions() {
	const folder = join(devDir(), 'sessions');
	let names;
	try {
		names = readdirSync(folder).filter((name) => name.endsWith('.json'));
	} catch {
		return [];
	}
	return names
		.map((name) => {
			try {
				return { name, ...JSON.parse(readFileSync(join(folder, name), 'utf8')) };
			} catch {
				return null;
			}
		})
		.filter((session) => {
			if (!session) return false;
			if (alive(session.pid)) return true;
			try {
				unlinkSync(join(folder, session.name));
			} catch {
				// Already gone or locked; the plugin sweeps it at its next start.
			}
			return false;
		})
		.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

/** The newest live session's URL, or a thrown error that says how to get one. */
export function latestSessionUrl() {
	const [latest] = liveSessions();
	if (!latest) {
		throw new Error(
			'No live Selva session. Install with `pnpm install:plugin:dev`, restart Rhino and enable a ' +
				'UI Bridge, or pass the URL from its Session URL output.'
		);
	}
	return latest.url;
}

/** A URL argument as given, else the newest live session's. */
export const sessionUrlOr = (arg) => (/^https?:\/\//.test(arg ?? '') ? arg : latestSessionUrl());

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	if (process.argv.includes('--url')) {
		console.log(latestSessionUrl());
	} else {
		const sessions = liveSessions();
		if (sessions.length === 0) console.log('No live Selva session.');
		for (const { sessionId, role, document, rhino, pid, startedAt, url } of sessions) {
			console.log(`${sessionId}  ${role}  ${document ?? '(unsaved)'}  Rhino ${rhino}  pid ${pid}`);
			console.log(`  since ${startedAt}`);
			console.log(`  ${url}\n`);
		}
	}
}
