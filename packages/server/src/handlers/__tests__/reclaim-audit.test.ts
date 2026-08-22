/**
 * Finding 16 — reclaim was invisible in the audit log, and the one rule that
 * forbids it outright never ran.
 *
 * 1. `addProjectMember` emits `project_member.added`, byte-identical to a
 *    project owner adding a teammate. §4 rests the entire escape hatch on the
 *    audit trail: the escalation is permitted *because* it is visible
 *    afterwards. An auditor could not tell "org admin forced entry into a
 *    private project" from routine roster maintenance — the only signal was
 *    `actorId === userId`, inferential and documented nowhere.
 *
 * 2. `canReclaim` refuses platform projects (§4a), but `requireCanReclaim` ran
 *    it inside `managementBypassOrRun`, which short-circuits for
 *    `instance_admin` — the only role that could reach a platform project. The
 *    refusal existed and never executed.
 */

import { describe, it, expect, afterEach } from 'vitest';
import type { DomainEvent } from '@selvajs/platform';
import { SYSTEM_CONTEXT } from '@selvajs/platform';
import { freshHarness, type HandlerHarness } from './harness.js';
import {
	seedAcme,
	seedProject,
	grantPlatformPermissions,
	actAs,
	callHandler
} from '../../testing/index.js';
import { reclaimProject } from '../reclaim.js';

let tp: HandlerHarness | null = null;

afterEach(async () => {
	if (tp) {
		await tp.cleanup();
		tp = null;
	}
});

function eventsOfType<T extends DomainEvent['type']>(
	events: HandlerHarness['events'],
	type: T
): Extract<DomainEvent, { type: T }>[] {
	return events.filter((e): e is Extract<DomainEvent, { type: T }> => e.type === type);
}

describe('POST /api/v1/projects/{id}/reclaim — audit trail', () => {
	it('emits project.reclaimed naming the actor and the visibility breached', async () => {
		tp = await freshHarness();
		const { acme, alice, bob, alicesPrivate } = await seedAcme(tp);
		await tp.config.data.orgs.updateOrgMemberRole(SYSTEM_CONTEXT, acme.id, bob.id, 'owner');

		const res = await callHandler(reclaimProject, {
			locals: await actAs(tp, bob.id),
			params: { id: alicesPrivate.id }
		});
		expect(res.status).toBe(201);

		const emitted = eventsOfType(tp.events, 'project.reclaimed');
		expect(emitted).toHaveLength(1);
		expect(emitted[0]).toMatchObject({
			projectId: alicesPrivate.id,
			orgId: acme.id,
			actorId: bob.id,
			// The state at the moment of the breach. Recorded here because a later
			// visibility flip would otherwise rewrite how serious this looks.
			priorVisibility: 'private'
		});
		expect(alice.id).not.toBe(bob.id);
	});

	it('stays distinguishable from a routine member add', async () => {
		tp = await freshHarness();
		const { acme, bob, alicesPrivate } = await seedAcme(tp);
		await tp.config.data.orgs.updateOrgMemberRole(SYSTEM_CONTEXT, acme.id, bob.id, 'owner');

		await callHandler(reclaimProject, {
			locals: await actAs(tp, bob.id),
			params: { id: alicesPrivate.id }
		});

		// The membership event still fires — the fix adds a signal rather than
		// replacing one, so anything reading the roster feed keeps working.
		expect(eventsOfType(tp.events, 'project_member.added')).not.toHaveLength(0);
		expect(eventsOfType(tp.events, 'project.reclaimed')).toHaveLength(1);
	});

	it('refuses to reclaim a platform project, even for instance_admin', async () => {
		tp = await freshHarness({ flags: { ENABLE_PLATFORM_PROJECTS: true } });
		const { acme, alice, bob } = await seedAcme(tp);
		const platformProject = await seedProject(tp, {
			orgId: acme.id,
			name: 'Platform Project',
			slug: 'platform-project',
			ownerId: alice.id,
			visibility: 'platform'
		});

		// Org owner *and* instance_admin: without the platform check ahead of the
		// bypass, either qualification alone would let this through.
		await tp.config.data.orgs.updateOrgMemberRole(SYSTEM_CONTEXT, acme.id, bob.id, 'owner');
		await grantPlatformPermissions(tp, bob.id, ['instance_admin']);

		const res = await callHandler(reclaimProject, {
			locals: await actAs(tp, bob.id),
			params: { id: platformProject.id }
		});

		expect(res.status).toBe(403);
		expect(eventsOfType(tp.events, 'project.reclaimed')).toHaveLength(0);
	});
});
