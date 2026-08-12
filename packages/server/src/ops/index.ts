// Deployment/ops helpers — channel-aware semver comparison and engines.node
// range checks.

export {
	parseSemver,
	isNewer,
	compareCore,
	satisfiesRange,
	type ReleaseChannel
} from './semver.js';
