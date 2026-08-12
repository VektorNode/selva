import { describe, it, expect, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import type { IAuthProvider, IDataProvider, IStorageProvider } from '@selvajs/platform';
import { createSelvaProviders, type ProviderRegistry } from '../create-selva-providers.js';

class FakeData {}
class FakeStorage {}

function makeRegistry() {
	const authLocal = vi.fn(() => ({ name: 'local-auth' }) as unknown as IAuthProvider);
	const authSupabase = vi.fn(() => ({ name: 'supabase-auth' }) as unknown as IAuthProvider);
	const dataLocal = vi.fn(() => new FakeData() as unknown as IDataProvider);
	const dataSupabase = vi.fn(() => new FakeData() as unknown as IDataProvider);
	const storageLocal = vi.fn(() => new FakeStorage() as unknown as IStorageProvider);
	const registry: ProviderRegistry = {
		auth: { local: authLocal, supabase: authSupabase },
		data: { local: dataLocal, supabase: dataSupabase },
		storage: { local: storageLocal }
	};
	return { registry, authLocal, authSupabase, dataLocal, dataSupabase, storageLocal };
}

const noBoot = { onBoot: () => {} };

describe('registry selection', () => {
	it('falls back to "local" for every slot when env is empty', async () => {
		const { registry, authLocal, dataLocal, storageLocal } = makeRegistry();
		const runtime = await createSelvaProviders({}, { registry, ...noBoot });
		runtime.resolve();
		expect(authLocal).toHaveBeenCalledTimes(1);
		expect(dataLocal).toHaveBeenCalledTimes(1);
		expect(storageLocal).toHaveBeenCalledTimes(1);
	});

	it('honors SELVA_*_PROVIDER env choices, case-insensitively', async () => {
		const { registry, authSupabase, dataSupabase } = makeRegistry();
		const runtime = await createSelvaProviders(
			{ SELVA_AUTH_PROVIDER: 'Supabase', SELVA_DATA_PROVIDER: 'SUPABASE' },
			{ registry, ...noBoot }
		);
		runtime.resolve();
		expect(authSupabase).toHaveBeenCalledTimes(1);
		expect(dataSupabase).toHaveBeenCalledTimes(1);
	});

	it('honors the defaults option over the built-in "local"', async () => {
		const { registry, authSupabase } = makeRegistry();
		const runtime = await createSelvaProviders(
			{},
			{ registry, defaults: { auth: 'supabase' }, ...noBoot }
		);
		runtime.resolve();
		expect(authSupabase).toHaveBeenCalledTimes(1);
	});

	it('rejects an unknown choice, listing the registered names', async () => {
		const { registry } = makeRegistry();
		const runtime = await createSelvaProviders(
			{ SELVA_AUTH_PROVIDER: 'okta' },
			{ registry, ...noBoot }
		);
		expect(() => runtime.resolve()).toThrow(/SELVA_AUTH_PROVIDER="okta".*local \| supabase/);
	});
});

describe('laziness and memoization', () => {
	it('does not instantiate providers until resolve() is called', async () => {
		const { registry, authLocal } = makeRegistry();
		await createSelvaProviders({}, { registry, ...noBoot });
		expect(authLocal).not.toHaveBeenCalled();
	});

	it('instantiates once and logs the boot summary once across repeated resolves', async () => {
		const { registry, authLocal } = makeRegistry();
		const onBoot = vi.fn();
		const runtime = await createSelvaProviders({}, { registry, onBoot });
		runtime.resolve();
		runtime.resolve();
		runtime.flag('ENABLE_SHARING');
		expect(authLocal).toHaveBeenCalledTimes(1);
		expect(onBoot).toHaveBeenCalledTimes(1);
		expect(onBoot.mock.calls[0][0]).toContain('auth=local-auth');
		expect(onBoot.mock.calls[0][0]).toContain('data=FakeData');
		expect(onBoot.mock.calls[0][0]).toContain('tenancy=single');
	});
});

describe('config parsing', () => {
	it('parses flags from SELVA_FLAG_* (omitted → false)', async () => {
		const { registry } = makeRegistry();
		const runtime = await createSelvaProviders(
			{ SELVA_FLAG_ENABLE_SHARING: 'true', SELVA_FLAG_ALLOW_ORG_CREATION: 'no' },
			{ registry, ...noBoot }
		);
		expect(runtime.flag('ENABLE_SHARING')).toBe(true);
		expect(runtime.flag('ALLOW_ORG_CREATION')).toBe(false);
		expect(runtime.flag('ALLOW_CROSS_ORG_PUBLIC')).toBe(false);
	});

	it('parses tenancy and rejects unknown values', async () => {
		const { registry } = makeRegistry();
		const multi = await createSelvaProviders({ SELVA_TENANCY: 'multi' }, { registry, ...noBoot });
		expect(multi.tenancy()).toBe('multi');

		const bad = await createSelvaProviders({ SELVA_TENANCY: 'galactic' }, { registry, ...noBoot });
		expect(() => bad.tenancy()).toThrow(/SELVA_TENANCY="galactic"/);
	});

	it('brands with defaults; copyright falls back to the overridden name', async () => {
		const { registry } = makeRegistry();
		const plain = await createSelvaProviders({}, { registry, ...noBoot });
		expect(plain.branding().name).toBe('Selva');
		expect(plain.branding().copyrightName).toBe('Selva');
		expect(plain.branding().tagline).toBeTruthy();

		const branded = await createSelvaProviders(
			{ SELVA_BRAND_NAME: '  Acme  ' },
			{ registry, ...noBoot }
		);
		expect(branded.branding().name).toBe('Acme');
		expect(branded.branding().copyrightName).toBe('Acme');
		expect(branded.branding().description).toContain('Acme');
	});
});

describe('solve metric sink', () => {
	it('falls back to a noop sink when the data provider has no solveMetrics', async () => {
		const { registry } = makeRegistry();
		const runtime = await createSelvaProviders({}, { registry, ...noBoot });
		const sink = runtime.solveMetricSink();
		expect(typeof sink.record).toBe('function');
		expect(runtime.solveMetricSink()).toBe(sink); // same instance — memoized
	});

	it('reuses a duck-typed solveMetrics sink carried by the data provider', async () => {
		const { registry } = makeRegistry();
		const carried = { record: vi.fn() };
		registry.data.local = vi.fn(() => ({ solveMetrics: carried }) as unknown as IDataProvider);
		const runtime = await createSelvaProviders({}, { registry, ...noBoot });
		expect(runtime.solveMetricSink()).toBe(carried);
	});
});

describe('config-path override', () => {
	it('loads the module default export and hands it the env', async () => {
		const { registry, authLocal } = makeRegistry();
		const configPath = fileURLToPath(new URL('./fixtures/override-config.mjs', import.meta.url));
		const runtime = await createSelvaProviders(
			{ OVERRIDE_MARKER: 'hello' },
			{ registry, configPath, ...noBoot }
		);
		const config = runtime.resolve();
		expect(config.auth.name).toBe('override-auth');
		expect((config.data as unknown as { marker: string }).marker).toBe('hello');
		expect(runtime.tenancy()).toBe('multi');
		// The registry is bypassed entirely.
		expect(authLocal).not.toHaveBeenCalled();
	});

	it('rejects at load time when the path does not exist', async () => {
		const { registry } = makeRegistry();
		await expect(
			createSelvaProviders({}, { registry, configPath: './does-not-exist.js', ...noBoot })
		).rejects.toThrow(/does-not-exist\.js/);
	});
});
