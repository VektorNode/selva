#!/usr/bin/env node
// Summarizes a SELVA_PERF_LOG file (JSON lines written by the plugin's PerfLog) into the numbers
// the display-pipeline decisions turn on: where a Display solve's time goes, how much of its input
// repeats between solves, and how long the bridge takes from a page's value update to the last
// mesh frame. Usage: node scripts/perf-report.mjs <log.jsonl> [more.jsonl ...]

import fs from 'node:fs';

const files = process.argv.slice(2);
if (files.length === 0) {
	console.error('Usage: node scripts/perf-report.mjs <log.jsonl> [more.jsonl ...]');
	process.exit(1);
}

const records = files.flatMap((file) =>
	fs
		.readFileSync(file, 'utf8')
		.split('\n')
		.filter((line) => line.trim())
		.flatMap((line) => {
			try {
				return [JSON.parse(line)];
			} catch {
				return [];
			}
		})
);

const quantile = (values, q) => {
	const sorted = values.filter((v) => typeof v === 'number').sort((a, b) => a - b);
	if (sorted.length === 0) return null;
	return sorted[Math.max(0, Math.ceil(q * sorted.length) - 1)]; // nearest rank
};
const fmt = (v, unit = '') => (v == null ? '-' : `${Math.round(v * 10) / 10}${unit}`);
const p50p90 = (values, unit = '') =>
	`${fmt(quantile(values, 0.5), unit)} / ${fmt(quantile(values, 0.9), unit)}`;
const groupBy = (items, key) =>
	items.reduce((map, item) => map.set(key(item), [...(map.get(key(item)) ?? []), item]), new Map());
const row = (label, value) => console.log(`  ${label.padEnd(34)} ${value}`);
const hitRate = (cache) => (100 * cache.hits) / Math.max(1, cache.hits + cache.misses);

console.log(`${records.length} records from ${files.length} file(s). Values are median / p90.\n`);

const displays = records.filter((r) => r.kind === 'display');
for (const [key, group] of groupBy(displays, (r) => `${r.host} · ${r.nickname} (${r.component})`)) {
	console.log(`Display ${key}: ${group.length} solves, meshing ${group[0].meshing}`);
	row('inputs (last solve)', JSON.stringify(group.at(-1).inputs));
	row(
		'vertices / triangles',
		`${p50p90(group.map((r) => r.vertices))} | ${p50p90(group.map((r) => r.triangles))}`
	);
	row('blob KB', p50p90(group.map((r) => r.blobBytes / 1024)));
	row('background total ms', p50p90(group.map((r) => r.ms.background)));
	for (const pass of ['extract', 'mesh', 'gather', 'encode', 'preview']) {
		row(`  ${pass} ms`, p50p90(group.map((r) => r.ms[pass])));
	}
	for (const stage of ['key', 'mesh', 'normals', 'uvs', 'weld', 'arrays']) {
		row(`  cpu ${stage} ms (all threads)`, p50p90(group.map((r) => r.cpuMs[stage])));
	}

	const cached = group.filter((r) => r.meshCache);
	if (cached.length > 0) {
		row(
			'mesh cache hits',
			p50p90(
				cached.map((r) => hitRate(r.meshCache)),
				'%'
			)
		);
		row('  cache MB (process)', p50p90(cached.map((r) => r.meshCache.bytes / (1024 * 1024))));
	}
	const blobs = group.filter((r) => r.blobCache);
	if (blobs.length > 0) {
		row(
			'geometry blob hits',
			p50p90(
				blobs.map((r) => hitRate(r.blobCache)),
				'%'
			)
		);
	}
	const compared = group.filter((r) => r.reuse?.comparedToPrevious);
	if (compared.length > 0) {
		row(
			'items unchanged since last solve',
			p50p90(
				compared.map((r) => (100 * r.reuse.unchangedItems) / Math.max(1, r.reuse.items)),
				'%'
			)
		);
	}
	const resent = group.filter((r) => r.resend?.comparedToPrevious);
	if (resent.length > 0) {
		row(
			'branches byte-identical to last',
			p50p90(
				resent.map((r) => (100 * r.resend.unchangedBranches) / Math.max(1, r.branches)),
				'%'
			)
		);
		row('  identical KB', p50p90(resent.map((r) => r.resend.unchangedBytes / 1024)));
	}
	const meshCompared = group.filter((r) => r.meshCompare && r.meshCompare.breps > 0);
	if (meshCompared.length > 0) {
		const ratio = (r) =>
			r.meshCompare.default.vertices / Math.max(1, r.meshCompare.current.vertices);
		row(
			'Default vs current vertices',
			p50p90(
				meshCompared.map((r) => 100 * ratio(r)),
				'%'
			)
		);
		row('  meshing ms, current', p50p90(meshCompared.map((r) => r.meshCompare.current.ms)));
		row('  meshing ms, Default', p50p90(meshCompared.map((r) => r.meshCompare.default.ms)));
	}
	console.log();
}

const bridges = records.filter((r) => r.kind === 'bridge');
for (const [trigger, group] of groupBy(bridges, (r) => r.trigger)) {
	console.log(`Bridge, solves started from the ${trigger}: ${group.length}`);
	for (const phase of ['wait', 'solve', 'collect', 'send', 'total']) {
		row(`${phase} ms`, p50p90(group.map((r) => r.ms[phase])));
	}
	row('updates superseded before solving', p50p90(group.map((r) => r.supersededUpdates)));
	row(
		'mesh frames / KB per solve',
		`${p50p90(group.map((r) => r.batches))} | ${p50p90(group.map((r) => r.blobBytes / 1024))}`
	);
	if (group.some((r) => r.sendFailed))
		row('sends failed', group.filter((r) => r.sendFailed).length);
	console.log();
}
