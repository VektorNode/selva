import { describe, it, expect } from 'vitest';
import { ERASED_ACTOR_ID } from '@selvajs/platform';
import { SupabaseDataProvider } from '../SupabaseDataProvider.js';
import type { ClientBundle } from '../client.js';

/**
 * User-erasure hook (audit P1). `onUserDeleted` must scrub the personal data
 * that FK cascade does NOT reach: audit rows by actor_id, invites + audit
 * payloads by email, and solve_metrics (anonymized, not deleted). It runs
 * against a live DB in production, so this test injects a recording fake for
 * the service client and asserts the exact table/op/filter each step issues —
 * no live stack needed. What matters is the dispatch, not PostgREST behavior.
 */

interface Op {
	table?: string;
	rpc?: string;
	kind: 'delete' | 'update' | 'rpc';
	filterCol?: string;
	filterVal?: unknown;
	updatePayload?: Record<string, unknown>;
	rpcArgs?: Record<string, unknown>;
}

/** A chainable stub matching the subset of the client the hook uses. */
function recordingBundle(errorOn?: string): { bundle: ClientBundle; ops: Op[] } {
	const ops: Op[] = [];

	function result(marker: string) {
		return { error: errorOn === marker ? { message: `boom:${marker}` } : null };
	}

	const serviceClient = {
		from(table: string) {
			return {
				delete() {
					const op: Op = { table, kind: 'delete' };
					return {
						eq(col: string, val: unknown) {
							op.filterCol = col;
							op.filterVal = val;
							ops.push(op);
							return result(`delete:${table}`);
						}
					};
				},
				update(payload: Record<string, unknown>) {
					const op: Op = { table, kind: 'update', updatePayload: payload };
					return {
						eq(col: string, val: unknown) {
							op.filterCol = col;
							op.filterVal = val;
							ops.push(op);
							return result(`update:${table}`);
						}
					};
				}
			};
		},
		rpc(name: string, args: Record<string, unknown>) {
			const op: Op = { rpc: name, kind: 'rpc', rpcArgs: args };
			ops.push(op);
			return result(`rpc:${name}`);
		}
	};

	return { bundle: { serviceClient } as unknown as ClientBundle, ops };
}

const CTX = { system: true } as never;
const USER = 'user-123';
const EMAIL = 'gone@example.com';

describe('SupabaseDataProvider.onUserDeleted — erasure (audit P1)', () => {
	it('deletes audit rows the user authored and anonymizes solve_metrics', async () => {
		const { bundle, ops } = recordingBundle();
		const provider = SupabaseDataProvider.fromBundle(bundle);

		await provider.onUserDeleted(CTX, USER);

		const auditDelete = ops.find((o) => o.table === 'audit_events' && o.kind === 'delete');
		expect(auditDelete).toMatchObject({ filterCol: 'actor_id', filterVal: USER });

		const metricsUpdate = ops.find((o) => o.table === 'solve_metrics' && o.kind === 'update');
		expect(metricsUpdate).toMatchObject({
			filterCol: 'actor_id',
			filterVal: USER,
			updatePayload: { actor_id: ERASED_ACTOR_ID }
		});
	});

	it('anonymizes rather than deletes solve_metrics (retention telemetry survives)', async () => {
		const { bundle, ops } = recordingBundle();
		await SupabaseDataProvider.fromBundle(bundle).onUserDeleted(CTX, USER);
		// No delete against solve_metrics — only an update tombstoning actor_id.
		expect(ops.some((o) => o.table === 'solve_metrics' && o.kind === 'delete')).toBe(false);
		expect(ops.some((o) => o.table === 'solve_metrics' && o.kind === 'update')).toBe(true);
	});

	it('skips email-keyed scrubs when no email is provided', async () => {
		const { bundle, ops } = recordingBundle();
		await SupabaseDataProvider.fromBundle(bundle).onUserDeleted(CTX, USER);
		expect(ops.some((o) => o.table === 'invites')).toBe(false);
		expect(ops.some((o) => o.kind === 'rpc')).toBe(false);
	});

	it('deletes invites by email and redacts audit payloads when email is given', async () => {
		const { bundle, ops } = recordingBundle();
		await SupabaseDataProvider.fromBundle(bundle).onUserDeleted(CTX, USER, { email: EMAIL });

		const inviteDelete = ops.find((o) => o.table === 'invites' && o.kind === 'delete');
		expect(inviteDelete).toMatchObject({ filterCol: 'email', filterVal: EMAIL });

		const redact = ops.find((o) => o.kind === 'rpc');
		expect(redact).toMatchObject({
			rpc: 'redact_audit_event_email',
			rpcArgs: { p_email: EMAIL }
		});
	});

	it('surfaces a failed audit scrub instead of silently swallowing it', async () => {
		const { bundle } = recordingBundle('delete:audit_events');
		await expect(SupabaseDataProvider.fromBundle(bundle).onUserDeleted(CTX, USER)).rejects.toThrow(
			/audit_events/
		);
	});

	it('surfaces a failed invite scrub', async () => {
		const { bundle } = recordingBundle('delete:invites');
		await expect(
			SupabaseDataProvider.fromBundle(bundle).onUserDeleted(CTX, USER, { email: EMAIL })
		).rejects.toThrow(/invites/);
	});
});
