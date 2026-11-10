// Check against a live rhino.compute, skipped unless COMPUTE_CHECK is set:
//   COMPUTE_CHECK=1 npx vitest run src/lib/schema/__tests__/compute-roundtrip.check.test.ts
// Solves examples/definitions/kitchen-run.gh on a local rhino.compute (9.x.state) the way the
// browser would: the definition's stored schema, Selva's input trees, one session id, and only the
// user's own changes. Grasshopper resolves every pick in the solve, so after each solve the picks
// the form shows must equal the ones the result used. COMPUTE_URL overrides
// http://localhost:6500/grasshopper.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TreeBuilder } from '@selvajs/compute/grasshopper';
import type { UISchema } from '@selvajs/schemas';
import { buildFormModel, withRowPick } from '../dynamic-value-list';

const COMPUTE = process.env.COMPUTE_URL ?? 'http://localhost:6500/grasshopper';
const GH = fileURLToPath(
	new URL('../../../../../../examples/definitions/kitchen-run.gh', import.meta.url)
);
const SESSION = `check-${Date.now()}`;
const log: string[] = [];
let schema: UISchema;
let solves = 0;
const id = (nickname: string) => schema.inputs.find((i) => i.nickname === nickname)!.id;
const outputId = (nickname: string) => schema.outputs.find((o) => o.nickname === nickname)!.id;

async function solve(values: Record<string, unknown>) {
	solves++;
	const trees = TreeBuilder.fromValues(
		(schema?.inputs ?? [])
			.filter((i) => values[i.id] !== undefined)
			.map((i) => ({ paramName: i.nickname, paramType: i.paramType, value: values[i.id] }))
	);
	const t0 = Date.now();
	const res = await fetch(COMPUTE, {
		method: 'POST',
		headers: { 'content-type': 'application/json', 'x-session-id': SESSION },
		body: JSON.stringify({
			algo: readFileSync(GH).toString('base64'),
			pointer: null,
			values: trees
		})
	});
	const json = (await res.json()) as {
		values: { ParamName: string; InnerTree: Record<string, { data: string }[]> }[];
	};
	const timing = res.headers.get('server-timing') ?? '';
	const pick = (name: string) => timing.match(new RegExp(`${name};desc="?([^",]+)`))?.[1];
	const child = timing.match(/proxy_child;dur=(\d+)/)?.[1];
	log.push(
		`   solve ${solves}: ${res.status}, ${Date.now() - t0} ms round trip, child ${child} ms, ` +
			`affinity=${pick('affinity')}, recomputed=${pick('recomputed')}`
	);

	const raw = Object.fromEntries(
		json.values.map((v) => [v.ParamName, Object.values(v.InnerTree).flat()[0]?.data ?? ''])
	);
	schema ??= JSON.parse(raw['Schema']) as UISchema;
	// Keyed by output id, as Selva keys them. Payloads stay JSON strings: that is what Compute sends.
	const outputs: Record<string, unknown> = {};
	for (const o of schema.outputs) {
		if (!(o.nickname in raw)) continue;
		outputs[o.id] = o.type === 'dynamicValueList' ? raw[o.nickname] : JSON.parse(raw[o.nickname]);
	}
	return outputs;
}

const resultLines = (outputs: Record<string, unknown>) =>
	String(outputs[outputId('Cabinet list')] ?? '').split(/\r?\n/);

// The lines the result would read if it used the picks the form shows.
function shownLines(values: Record<string, unknown>, outputs: Record<string, unknown>) {
	const model = buildFormModel(schema, { ...values, ...outputs });
	const fronts = model.shown[id('Fronts')] as string[];
	const handles = model.shown[id('Handles')] as string[];
	return model.repeats[0].rows.map(
		(row, i) => `${row.label} · ${row.section}: ${fronts[i]} / ${handles[i]}`
	);
}

describe.runIf(process.env.COMPUTE_CHECK)('kitchen run on rhino.compute', () => {
	it(
		'solves once per change, and the form shows what the solve used',
		{ timeout: 300_000 },
		async () => {
			// Only to read the stored schema. A warm child keeps the last inputs it was given, so every
			// solve below sends every input, as Selva does.
			await solve({});
			log.length = 0;
			solves = 0;
			const values: Record<string, unknown> = {
				[id('Layout')]: 'Straight',
				[id('Style')]: 'Shaker',
				[id('Fronts')]: '{}',
				[id('Handles')]: '{}'
			};
			const step = async (title: string) => {
				log.push(title);
				const outputs = await solve(values);
				const gh = resultLines(outputs);
				log.push(...gh.slice(0, 2).map((l) => `     ${l}`));
				expect(shownLines(values, outputs)).toEqual(gh);
				return gh;
			};

			await step('1. page opens, no picks yet: every row takes its first option');
			values[id('Fronts')] = withRowPick(values[id('Fronts')], 'back/drawers', 'Shaker drawers');
			await step('2. Drawers -> Shaker drawers: its handles switch to the drawer handles');
			values[id('Style')] = 'Handleless';
			const handleless = await step(
				'3. Style -> Handleless: no picks sent, Grasshopper resolves them'
			);
			values[id('Style')] = 'Shaker';
			await step('4. back to Shaker: Drawers shows Shaker drawers again');
			values[id('Layout')] = 'L-shaped';
			const lShaped = await step('5. Layout -> L-shaped: rows change, picks follow their keys');

			console.info(log.join('\n'));
			if (process.env.COMPUTE_CHECK_LOG)
				writeFileSync(process.env.COMPUTE_CHECK_LOG, log.join('\n'));
			expect(solves).toBe(5);
			expect(handleless.every((l) => l.endsWith('Push door / None'))).toBe(true);
			expect(lShaped).toHaveLength(6);
			expect(lShaped).toContain('Drawers · Back wall: Shaker drawers / Cup pull');
		}
	);
});
