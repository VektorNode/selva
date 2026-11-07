import { describe, expect, it } from 'vitest';
import { validateProjectFlags } from '../schemas.js';

describe('validateProjectFlags', () => {
	it('accepts a commons on a public project, and any project that is not one', () => {
		expect(validateProjectFlags({ visibility: 'public', autoJoinOnUpload: true })).toEqual([]);
		expect(validateProjectFlags({ visibility: 'private', autoJoinOnUpload: false })).toEqual([]);
		expect(validateProjectFlags({ visibility: 'org' })).toEqual([]);
	});

	it('refuses a commons on an org or private project', () => {
		for (const visibility of ['org', 'private'] as const) {
			expect(validateProjectFlags({ visibility, autoJoinOnUpload: true })).toEqual([
				{ path: 'autoJoinOnUpload', message: 'autoJoinOnUpload requires visibility=public' }
			]);
		}
	});

	it('reports a commons on a platform project once', () => {
		expect(validateProjectFlags({ visibility: 'platform', autoJoinOnUpload: true })).toEqual([
			{ path: 'autoJoinOnUpload', message: 'autoJoinOnUpload is not allowed on platform projects' }
		]);
	});
});
