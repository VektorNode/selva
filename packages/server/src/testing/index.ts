/**
 * Test harness for the transport-free API handlers.
 *
 * A host builds a {@link TestHarness} around its own provider stack and gets
 * the seeders, `actAs`, and `callHandler` that the handler tests are written
 * against — so the tests travel with the handlers instead of being rewritten
 * per host.
 *
 * This entry point constructs no provider. Which stack a test runs on is the
 * host's decision, and a package that picked one would drag that provider into
 * every consumer's dependency tree.
 */

export type { SeedAuthAdapter } from './seed-adapter.js';
export {
	seedUser,
	seedOrg,
	seedOrgMember,
	seedProject,
	seedProjectMember,
	actAs,
	anon,
	callHandler,
	silentLog
} from './harness.js';
export type {
	TestHarness,
	SeededUser,
	ActingLocals,
	CallHandlerOpts,
	CallResult
} from './harness.js';
export { seedAcme, seedBigClient, seedThirdOrg } from './scenarios.js';
export type { AcmeFixture, BigClientFixture, ThirdOrgFixture } from './scenarios.js';
