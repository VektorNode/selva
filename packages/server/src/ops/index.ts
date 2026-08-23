// Deployment/ops helpers — channel-aware semver comparison, engines.node range
// checks, and the reverse-proxy/body-limit configuration rules.

export {
	parseSemver,
	isNewer,
	compareCore,
	satisfiesRange,
	type ReleaseChannel
} from './semver.js';

export {
	checkClientAddress,
	checkBodySizeLimit,
	checkDeploymentConfig,
	parseBodySizeLimit,
	type ConfigFinding,
	type ConfigVerdict,
	type DeploymentEnv
} from './deploymentConfig.js';
