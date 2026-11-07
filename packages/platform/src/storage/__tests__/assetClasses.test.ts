import { describe, expect, it } from 'vitest';
import { classifyAssetPath } from '../assetClasses.js';

const GUID = '11111111-1111-4111-8111-111111111111';

describe('classifyAssetPath', () => {
	it('classifies a cover by the one name it can have', () => {
		expect(classifyAssetPath(`definitions/${GUID}/cover.webp`)?.class.id).toBe('definition-cover');
	});

	it('does not match a cover that is not .webp', () => {
		expect(classifyAssetPath(`definitions/${GUID}/cover.png`)).toBeNull();
	});

	it('classifies branding as public', () => {
		expect(classifyAssetPath('orgs/acme/branding/logo.webp')?.class.visibility).toBe('public');
	});

	it('has no class for orgs/{id}/private', () => {
		expect(classifyAssetPath('orgs/acme/private/quote.pdf')).toBeNull();
	});
});
