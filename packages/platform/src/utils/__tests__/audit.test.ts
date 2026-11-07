import { describe, expect, it } from 'vitest';
import { SYSTEM_CONTEXT, type RequestContext } from '../../context.js';
import { auditSoftDelete, auditUpdate } from '../audit.js';

const alice: RequestContext = { userId: 'alice', platformPermissions: [], orgPermissions: [] };

describe('audit stamps', () => {
	it('credit the caller', () => {
		expect(auditUpdate(alice, 'bob').updatedBy).toBe('alice');
		expect(auditSoftDelete(alice, 'bob').updatedBy).toBe('alice');
	});

	it('credit the fallback actor when a system context has no user', () => {
		expect(auditUpdate(SYSTEM_CONTEXT, 'bob').updatedBy).toBe('bob');
		expect(auditSoftDelete(SYSTEM_CONTEXT, 'bob').updatedBy).toBe('bob');
		expect(auditUpdate(SYSTEM_CONTEXT, null).updatedBy).toBe('');
	});

	it('stamp a soft delete and its update at the same instant', () => {
		const stamp = auditSoftDelete(alice, null);
		expect(stamp.deletedAt).toBe(stamp.updatedAt);
	});
});
