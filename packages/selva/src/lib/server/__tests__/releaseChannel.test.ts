import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
// Import the env stub through the SAME alias the module under test uses
// ($env/dynamic/private → env-stub), so mutating INSTALL_DIR here is visible to
// releaseChannel.server's deployment-dir probe. (`setEnv` imports './env-stub.js'
// which can resolve to a different module record than the aliased one.)
import { env } from '$env/dynamic/private';
import {
	readChannel,
	writeChannel,
	channelTag,
	channelRegistryUrl
} from '../releaseChannel.server';

// A temp dir that LOOKS like a CLI-scaffolded deployment (has
// node_modules/@selvajs/selva/package.json), pinned via INSTALL_DIR so the
// module's deployment-dir probe resolves to it deterministically.
let deployDir: string;

beforeEach(() => {
	deployDir = mkdtempSync(join(tmpdir(), 'selva-channel-'));
	mkdirSync(join(deployDir, 'node_modules', '@selvajs', 'selva'), { recursive: true });
	writeFileSync(
		join(deployDir, 'node_modules', '@selvajs', 'selva', 'package.json'),
		JSON.stringify({ name: '@selvajs/selva', version: '4.5.1' })
	);
	env.INSTALL_DIR = deployDir;
});

afterEach(() => {
	delete env.INSTALL_DIR;
	rmSync(deployDir, { recursive: true, force: true });
});

describe('release channel persistence', () => {
	it('defaults to stable when no file exists', () => {
		expect(readChannel()).toBe('stable');
	});

	it('round-trips a written channel', () => {
		writeChannel('beta');
		expect(readChannel()).toBe('beta');
		expect(existsSync(join(deployDir, 'selva-channel.json'))).toBe(true);

		writeChannel('stable');
		expect(readChannel()).toBe('stable');
	});

	it('writes valid JSON with the channel field', () => {
		writeChannel('beta');
		const parsed = JSON.parse(readFileSync(join(deployDir, 'selva-channel.json'), 'utf8'));
		expect(parsed).toEqual({ channel: 'beta' });
	});

	it('degrades to stable on malformed JSON', () => {
		writeFileSync(join(deployDir, 'selva-channel.json'), '{ not json');
		expect(readChannel()).toBe('stable');
	});

	it('degrades to stable on an unknown channel value', () => {
		writeFileSync(join(deployDir, 'selva-channel.json'), JSON.stringify({ channel: 'nightly' }));
		expect(readChannel()).toBe('stable');
	});

	it('rejects an invalid channel on write', () => {
		// @ts-expect-error — testing the runtime guard
		expect(() => writeChannel('nightly')).toThrow();
	});
});

describe('channel → npm tag mapping', () => {
	it('maps channels to dist-tags', () => {
		expect(channelTag('stable')).toBe('latest');
		expect(channelTag('beta')).toBe('beta');
	});

	it('builds the per-channel registry URL', () => {
		expect(channelRegistryUrl('stable')).toBe('https://registry.npmjs.org/@selvajs%2Fselva/latest');
		expect(channelRegistryUrl('beta')).toBe('https://registry.npmjs.org/@selvajs%2Fselva/beta');
	});
});
