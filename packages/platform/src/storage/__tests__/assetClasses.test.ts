import { describe, expect, it } from 'vitest';
import { classifyAssetPath } from '../assetClasses.js';

const GUID = '11111111-1111-4111-8111-111111111111';

describe('classifyAssetPath', () => {
	it('classifies a cover by the one name it can have', () => {
		expect(classifyAssetPath(`definitions/${GUID}/cover.webp`)?.class.id).toBe('definition-cover');
	});

	it.each(['png', 'jpg', 'jpeg', 'gif'])('does not match a .%s cover', (ext) => {
		expect(classifyAssetPath(`definitions/${GUID}/cover.${ext}`)).toBeNull();
	});

	it('classifies branding as public', () => {
		expect(classifyAssetPath('orgs/acme/branding/logo.webp')?.class.visibility).toBe('public');
	});

	it('has no class for orgs/{id}/private', () => {
		expect(classifyAssetPath('orgs/acme/private/quote.pdf')).toBeNull();
	});
});
