/**
 * `reconcileUpdateOutcome` is the exactly-once bridge between the detached
 * bash runner — which can only leave a log + exit marker behind, since the
 * app that launched it is killed mid-update — and the audit event log. These
 * tests exercise the classification against real runner log shapes and pin
 * the state-file lifecycle: it's the emission token, consumed on reconcile.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { DomainEvent } from '@selvajs/platform';
import {
	reconcileUpdateOutcome,
	updateLogPath,
	updateStatePath,
	type PendingUpdateState
} from '../selfUpdate.server.js';

let tempDir: string;
let emitted: DomainEvent[];
let reported: unknown[];

function deps() {
	return {
		deploymentDir: tempDir,
		emit: async (e: DomainEvent) => {
			emitted.push(e);
		},
		report: (err: unknown) => {
			reported.push(err);
		}
	};
}

function seedState(over: Partial<PendingUpdateState> = {}) {
	const state: PendingUpdateState = {
		startedAt: '2026-07-12T10:00:00.000Z',
		actorId: 'admin-1',
		channel: 'stable',
		fromVersion: '4.2.0',
		...over
	};
	writeFileSync(updateStatePath(tempDir), JSON.stringify(state));
}

function seedLog(content: string) {
	writeFileSync(updateLogPath(tempDir), content);
}

beforeEach(async () => {
	tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'selva-update-test-'));
	emitted = [];
	reported = [];
});

afterEach(async () => {
	await fs.rm(tempDir, { recursive: true, force: true });
});

describe('reconcileUpdateOutcome', () => {
	it('is a no-op without a pending-update state file', async () => {
		seedLog('[DONE] Update complete\n[EXIT] code=0\n');
		expect(await reconcileUpdateOutcome(deps())).toBe('no_pending_update');
		expect(emitted).toHaveLength(0);
	});

	it('reports still_running until the [EXIT] marker appears, without consuming state', async () => {
		seedState();
		seedLog('[STEP] Updating @selvajs/* packages\n');
		expect(await reconcileUpdateOutcome(deps())).toBe('still_running');
		expect(emitted).toHaveLength(0);
		// State survives so a later tick can still reconcile.
		expect(await reconcileUpdateOutcome(deps())).toBe('still_running');
	});

	it('emits system.update.finished with versions on a clean update', async () => {
		seedState({ fromVersion: '4.2.0' });
		seedLog(
			'[INFO] Current @selvajs/selva: 4.2.0\n' +
				'[INFO] New @selvajs/selva: 4.2.1\n' +
				'[DONE] Update complete\n' +
				'[EXIT] code=0\n'
		);
		expect(await reconcileUpdateOutcome(deps())).toBe('reconciled');
		expect(emitted).toEqual([
			{
				type: 'system.update.finished',
				fromVersion: '4.2.0',
				toVersion: '4.2.1',
				actorId: 'admin-1'
			}
		]);
		expect(reported).toHaveLength(0);
	});

	it('emits system.update.rolled_back (and reports it) on exit code 5', async () => {
		seedState();
		seedLog(
			'[FATAL] New process failed health check after 30s\n' +
				'[DONE] Rolled back to 4.2.0 — previous version is online\n' +
				'[EXIT] code=5\n'
		);
		expect(await reconcileUpdateOutcome(deps())).toBe('reconciled');
		expect(emitted).toHaveLength(1);
		expect(emitted[0].type).toBe('system.update.rolled_back');
		expect(reported).toHaveLength(1);
	});

	it('emits system.update.failed (and reports it) when rollback also failed', async () => {
		seedState();
		seedLog(
			'[FATAL] Rollback restart also failed health check (HTTP 000)\n' +
				'[FATAL] Manual recovery required. Check: pm2 logs selva-compute\n' +
				'[EXIT] code=6\n'
		);
		expect(await reconcileUpdateOutcome(deps())).toBe('reconciled');
		expect(emitted).toHaveLength(1);
		expect(emitted[0].type).toBe('system.update.failed');
		expect(reported).toHaveLength(1);
	});

	it('classifies the pre-flight no-op as finished', async () => {
		seedState();
		seedLog(
			"[INFO] Already on the 'latest' channel version (4.2.0)\n" +
				'[DONE] Nothing to do\n' +
				'[EXIT] code=0\n'
		);
		expect(await reconcileUpdateOutcome(deps())).toBe('reconciled');
		expect(emitted[0].type).toBe('system.update.finished');
		expect(reported).toHaveLength(0);
	});

	it('consumes the state file exactly once — a second reconcile is a no-op', async () => {
		seedState();
		seedLog('[DONE] Update complete\n[EXIT] code=0\n');
		expect(await reconcileUpdateOutcome(deps())).toBe('reconciled');
		expect(await reconcileUpdateOutcome(deps())).toBe('no_pending_update');
		expect(emitted).toHaveLength(1);
	});
});
