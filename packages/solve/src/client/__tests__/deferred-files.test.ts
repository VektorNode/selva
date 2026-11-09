import { describe, expect, it, vi } from 'vitest';
import type { UISchema } from '@selvajs/schemas';
import { createSolveSession } from '../session/solve-session.js';
import type { SolveDriver } from '../drivers/driver.js';
import type { SolveMode, SolveResult } from '../../shared/solve-fn.js';

function schema(previewSolves?: boolean): UISchema {
	return {
		id: 'test',
		name: 'Test',
		previewSolves,
		inputs: [{ id: 'a', paramId: 'a', paramType: 'text', default: 'x' }],
		outputs: [{ id: 'mesh' }, { id: 'dl' }],
		layout: { type: 'flat', groups: [{ items: [] }] }
	} as unknown as UISchema;
}

const FILE = [{ fileName: 'part', fileType: '.3dm', data: 'AA==' }];

/** A driver whose solves and file solves the test settles by hand. */
function manualDriver() {
	const solves: { values: Record<string, unknown>; solveMode?: SolveMode }[] = [];
	const fileSolves: {
		values: Record<string, unknown>;
		signal: AbortSignal;
		resolve: (r: SolveResult) => void;
		reject: (e: Error) => void;
	}[] = [];
	const driver: SolveDriver = {
		solve(values, options) {
			solves.push({ values, solveMode: options?.solveMode });
		},
		solveFiles(values, signal) {
			return new Promise((resolve, reject) => fileSolves.push({ values, signal, resolve, reject }));
		},
		cancel() {},
		get isSolving() {
			return false;
		}
	};
	return { driver, solves, fileSolves };
}

function previewResult(values: Record<string, unknown>): SolveResult {
	return { outputs: { mesh: 1, dl: null }, values, deferred: ['dl'] };
}

describe('deferred files', () => {
	it('solves edits as previews only when the schema turns previewSolves on', () => {
		for (const [flag, expected] of [
			[true, 'preview'],
			[false, undefined],
			[undefined, undefined]
		] as const) {
			const { driver, solves } = manualDriver();
			const session = createSolveSession({ schema: schema(flag), scopeKey: 's', driver });
			session.setValue('a', 'y');
			expect(solves.at(-1)?.solveMode).toBe(expected);
		}
	});

	it('waits on a preview that deferred files, and stays none for one that did not', () => {
		const { driver } = manualDriver();
		const session = createSolveSession({ schema: schema(true), scopeKey: 's', driver });
		session.report({ outputs: { mesh: 1, dl: FILE }, values: { a: 'x' } });
		expect(session.files).toEqual({ status: 'none' });
		session.report(previewResult({ a: 'y' }));
		expect(session.files).toEqual({ status: 'waiting', ids: ['dl'] });
	});

	it('makes the files from the shown values, and every later click joins the same solve', async () => {
		const { driver, fileSolves } = manualDriver();
		const session = createSolveSession({ schema: schema(true), scopeKey: 's', driver });
		session.report(previewResult({ a: 'shown' }));

		const first = session.makeFiles();
		const second = session.makeFiles();
		expect(fileSolves).toHaveLength(1);
		expect(fileSolves[0].values).toEqual({ a: 'shown' });
		expect(session.files.status).toBe('making');

		fileSolves[0].resolve({ outputs: { mesh: 1, dl: FILE } });
		await Promise.all([first, second]);
		expect(session.files).toMatchObject({ status: 'ready', ids: ['dl'], outputs: { dl: FILE } });
	});

	it('reads a full solve with no files as empty', async () => {
		const { driver, fileSolves } = manualDriver();
		const session = createSolveSession({ schema: schema(true), scopeKey: 's', driver });
		session.report(previewResult({ a: 'x' }));
		const made = session.makeFiles();
		fileSolves[0].resolve({ outputs: { mesh: 1, dl: [] } });
		await made;
		expect(session.files).toEqual({ status: 'empty', ids: ['dl'] });
	});

	it('shows the refusal of a full solve, and lets it be tried again', async () => {
		const { driver, fileSolves } = manualDriver();
		const session = createSolveSession({ schema: schema(true), scopeKey: 's', driver });
		session.report(previewResult({ a: 'x' }));

		const made = session.makeFiles();
		fileSolves[0].resolve({
			outputs: {},
			blocked: true,
			diagnostics: [{ level: 'error', message: 'Part 14 does not fit', source: 'Nesting' }]
		});
		await made;
		expect(session.files).toMatchObject({ status: 'failed', error: 'Part 14 does not fit' });

		void session.makeFiles();
		expect(fileSolves).toHaveLength(2);
		expect(session.files.status).toBe('making');
	});

	it('reports a transport failure as failed', async () => {
		const { driver, fileSolves } = manualDriver();
		const session = createSolveSession({ schema: schema(true), scopeKey: 's', driver });
		session.report(previewResult({ a: 'x' }));
		const made = session.makeFiles();
		fileSolves[0].reject(new Error('Response too large'));
		await made;
		expect(session.files).toMatchObject({ status: 'failed', error: 'Response too large' });
	});

	it('aborts the running file solve on an input change and drops it for the next result', async () => {
		const { driver, fileSolves } = manualDriver();
		const session = createSolveSession({ schema: schema(true), scopeKey: 's', driver });
		session.report(previewResult({ a: 'x' }));
		const made = session.makeFiles();

		session.setValue('a', 'y');
		expect(fileSolves[0].signal.aborted).toBe(true);
		expect(session.files).toEqual({ status: 'waiting', ids: ['dl'] });

		// A late answer for the old values must not land on the new result.
		session.report(previewResult({ a: 'y' }));
		fileSolves[0].resolve({ outputs: { dl: FILE } });
		await made;
		expect(session.files).toEqual({ status: 'waiting', ids: ['dl'] });
	});

	it('goes back to waiting on cancel', () => {
		const { driver, fileSolves } = manualDriver();
		const session = createSolveSession({ schema: schema(true), scopeKey: 's', driver });
		session.report(previewResult({ a: 'x' }));
		void session.makeFiles();
		session.cancelFiles();
		expect(fileSolves[0].signal.aborted).toBe(true);
		expect(session.files).toEqual({ status: 'waiting', ids: ['dl'] });
	});

	it('stays none on a transport that cannot make files', () => {
		const solve = vi.fn();
		const driver: SolveDriver = {
			solve,
			cancel() {},
			get isSolving() {
				return false;
			}
		};
		const session = createSolveSession({ schema: schema(true), scopeKey: 's', driver });
		session.report(previewResult({ a: 'x' }));
		expect(session.files).toEqual({ status: 'none' });
	});
});
