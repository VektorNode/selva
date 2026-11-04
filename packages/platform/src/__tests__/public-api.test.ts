import { describe, expect, it } from 'vitest';
import * as root from '../index.js';
import * as computeServer from '../computeServer/index.js';
import * as definitions from '../definitions/index.js';
import * as organizations from '../organizations/index.js';
import * as permissions from '../permissions/index.js';
import * as platformProjects from '../platformProjects/index.js';
import * as storage from '../storage/index.js';
import * as apiTokens from '../apiTokens/index.js';

describe('the root barrel', () => {
	it.each(['encryptSecret', 'decryptSecret', 'decodeSecretKey', 'isEncryptedSecret'])(
		'leaves out %s, which needs node:crypto',
		(name) => {
			expect(root).not.toHaveProperty(name);
			expect(computeServer).toHaveProperty(name);
		}
	);

	it('re-exports each area', () => {
		for (const name of ['canView', 'SlugSchema', 'pickServer', 'classifyAssetPath']) {
			expect(root).toHaveProperty(name);
		}
	});
});

describe('what the major took out of the public API', () => {
	it.each([
		[root, 'root'],
		[computeServer, 'computeServer'],
		[definitions, 'definitions'],
		[organizations, 'organizations'],
		[platformProjects, 'platformProjects'],
		[storage, 'storage'],
		[apiTokens, 'apiTokens']
	])('is gone from %#', (barrel) => {
		for (const name of [
			'orgServersFor',
			'ApiTokenRevokeReasonSchema',
			'IMAGE_MAX_WIDTH',
			'IMAGE_WEBP_QUALITY',
			'isImageUpload',
			'toWebpPath',
			'isPublicAssetPath',
			'ALL_ORG_ASSET_KINDS',
			'DefinitionChannelSchema',
			'UUID_REGEX',
			'COVER_IMAGE_EXTENSIONS',
			'ALLOWED_UPLOAD_EXTENSIONS',
			'PlatformProjectGrantSchema',
			'PlatformProjectGranteeTypeSchema'
		]) {
			expect(barrel).not.toHaveProperty(name);
		}
	});

	it('removed the deprecated private asset path', () => {
		expect(root.orgPaths).not.toHaveProperty('privateAsset');
	});
});

describe('subpaths', () => {
	it('carries OPERATOR_PLATFORM_PERMISSIONS on permissions', () => {
		expect(permissions.OPERATOR_PLATFORM_PERMISSIONS).toBe(root.OPERATOR_PLATFORM_PERMISSIONS);
	});
});
