// Entry for the CLI's bundled copy (scripts/generate-cli-config.js). The CLI has
// no dependencies, so it carries the manifest and the pure logic over it.
export {
	buildConfigReport,
	diffSnapshots,
	fingerprint,
	PREVIOUS_KEY_DAYS,
	legacyValue,
	resolveConfig,
	takeSnapshot
} from '@selvajs/platform/config';
export {
	ALL_SETTINGS,
	deploymentManifest,
	deploymentReport,
	deploymentSnapshot,
	keyRotationStatus
} from './settings.js';
