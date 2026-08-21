/**
 * A concrete {@link TestHarness} for the handler tests in this directory.
 *
 * `@selvajs/server` ships no provider — which stack a host runs on is the host's
 * decision, and a package that picked one would drag it into every consumer's
 * dependency tree. But a handler test needs *some* real stack to run against,
 * so this file builds one from `@selvajs/local-provider`, a **devDependency**.
 * It sits under `__tests__/`, which `package.json#files` excludes, so nothing
 * here reaches the published tarball.
 *
 * No module-global registry: these handlers reach every store through
 * `req.deps`, so a test needs only the harness it passes to `callHandler`.
 * That is the property that let the handlers move here at all.
 */

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
	LocalAuthProvider,
	LocalDataProvider,
	LocalStorageProvider
} from '@selvajs/local-provider';
import type {
	DomainEvent,
	IEventSink,
	SelvaConfig,
	SelvaFlags,
	TenancyMode
} from '@selvajs/platform';
import { silentLog } from '../../testing/index.js';
import type { TestHarness } from '../../testing/index.js';

const TEST_HMAC_KEY = 'test-hmac-key-32-chars-min-length';
// Deterministic 32-byte hex — `LocalComputeServerStore.fromEnv` needs a key to
// encrypt the per-server compute config. These tests never read the encrypted
// blob, but the constructor still requires one.
const TEST_AT_REST_KEY = '0'.repeat(64);

class RecordingEventSink implements IEventSink {
	readonly events: DomainEvent[] = [];
	async emit(event: DomainEvent): Promise<void> {
		this.events.push(event);
	}
}

export interface HandlerHarness extends TestHarness {
	/** Every event emitted since {@link freshHarness}, in order. */
	events: DomainEvent[];
	cleanup: () => Promise<void>;
}

export interface FreshHarnessOpts {
	tenancy?: TenancyMode;
	flags?: SelvaFlags;
}

export async function freshHarness(opts: FreshHarnessOpts = {}): Promise<HandlerHarness> {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), 'selva-handler-test-'));
	const env = {
		DATA_PATH: root,
		SELVA_HMAC_KEY: TEST_HMAC_KEY,
		SELVA_AT_REST_KEY: TEST_AT_REST_KEY
	};

	const events = new RecordingEventSink();
	const auth = LocalAuthProvider.fromEnv(env);
	const data = LocalDataProvider.fromEnv(env, events);
	const storage = LocalStorageProvider.fromEnv(env);

	// The provider's OWN store, not a second one on the same file: the seeders
	// write through this handle, and a second store would have its own
	// load-once cache, so seeded users would be invisible to the provider.
	const authUsers = auth.userStore;
	if (!authUsers) throw new Error('LocalAuthProvider has no user store (DATA_PATH unset)');

	const config: SelvaConfig = {
		auth,
		data,
		storage,
		events,
		tenancy: opts.tenancy ?? 'single',
		flags: opts.flags ?? {}
	};

	return {
		config,
		// `null` password marks an OAuth-allowlisted entry; these tests don't
		// authenticate, they just need ids to align across stores.
		auth: {
			createUser: (email) => authUsers.createUser(email, null),
			findById: (id) => authUsers.findById(id)
		},
		log: silentLog,
		events: events.events,
		cleanup: () => fs.rm(root, { recursive: true, force: true })
	};
}
