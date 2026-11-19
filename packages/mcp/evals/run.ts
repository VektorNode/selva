// Runs tasks.json against a Selva MCP endpoint with Claude as the agent, and records per task:
// success, tool calls, tokens, invalid-argument errors and wall time. Not in CI: it needs
// Rhino.Compute behind the instance and spends Anthropic API credit.
//
//   SELVA_MCP_URL=http://localhost:5273/mcp SELVA_API_KEY=selva_… node evals/run.ts
//     [--task <id>]… [--held-out] [--model claude-opus-5-5] [--effort medium]
//
// Anthropic credentials come from the environment (ANTHROPIC_API_KEY, or an `ant auth login`
// profile). Results land in evals/results/<time>.json, which git ignores.

import Anthropic from '@anthropic-ai/sdk';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';

interface Expect {
	toolsCalled?: string[];
	toolsNotCalled?: string[];
	/** Upper bound on calls per tool. */
	maxCalls?: Record<string, number>;
	answerContains?: string[];
	/** A rubric an LLM judge grades the final answer against. */
	judge?: string;
	/** `expected: null` is uncalibrated: reported, not graded. */
	number?: { expected: number | null; tolerance: number };
}

interface Task {
	id: string;
	prompt: string;
	heldOut?: boolean;
	expect: Expect;
}

interface Result {
	id: string;
	pass: boolean;
	failures: string[];
	answer: string;
	toolCalls: { name: string; ms: number; isError: boolean }[];
	invalidArguments: number;
	inputTokens: number;
	outputTokens: number;
	turns: number;
	wallMs: number;
	uncalibrated?: number | null;
}

const MAX_TURNS = 25;
// Anthropic's fallback models answer a refused request instead of the run ending empty.
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

const { values: args } = parseArgs({
	options: {
		task: { type: 'string', multiple: true },
		'held-out': { type: 'boolean', default: false },
		model: { type: 'string', default: 'claude-opus-5-5' },
		effort: { type: 'string', default: 'medium' }
	}
});

const url = process.env.SELVA_MCP_URL;
const key = process.env.SELVA_API_KEY;
if (!url || !key) {
	console.error('Set SELVA_MCP_URL and SELVA_API_KEY.');
	process.exit(2);
}

const here = new URL('.', import.meta.url);
const { tasks } = JSON.parse(await readFile(new URL('tasks.json', here), 'utf8')) as {
	tasks: Task[];
};
const chosen = tasks.filter((t) =>
	args.task?.length ? args.task.includes(t.id) : !!t.heldOut === args['held-out']
);

const anthropic = new Anthropic();
const mcp = new Client({ name: 'selva-evals', version: '1.0.0' });
await mcp.connect(
	new StreamableHTTPClientTransport(new URL(url), {
		requestInit: { headers: { Authorization: `Bearer ${key}` } }
	})
);

// Only what a client shows the model: a tool its view alone calls stays out.
const listed = (await mcp.listTools()).tools.filter((t) => {
	const ui = (t._meta as { ui?: { visibility?: string[] } } | undefined)?.ui;
	return !ui?.visibility || ui.visibility.includes('model');
});
const tools: Anthropic.Tool[] = listed.map((t) => ({
	name: t.name,
	description: t.description ?? '',
	input_schema: t.inputSchema as Anthropic.Tool.InputSchema
}));
const system = mcp.getInstructions() ?? '';

function textOf(content: unknown[]): string {
	return content
		.map((c) =>
			(c as { type?: string; text?: string }).type === 'text' ? (c as { text: string }).text : ''
		)
		.join('\n');
}

/** MCP tool content as Claude takes it: text and images, nothing else. */
function toBlocks(content: unknown[]): Anthropic.ToolResultBlockParam['content'] {
	const blocks: Exclude<Anthropic.ToolResultBlockParam['content'], string | undefined> = [];
	for (const c of content as { type: string; text?: string; data?: string; mimeType?: string }[]) {
		if (c.type === 'text' && c.text) blocks.push({ type: 'text', text: c.text });
		if (c.type === 'image' && c.data) {
			blocks.push({
				type: 'image',
				source: {
					type: 'base64',
					media_type: c.mimeType as 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif',
					data: c.data
				}
			});
		}
	}
	return blocks;
}

async function runTask(task: Task): Promise<Result> {
	const started = Date.now();
	const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: task.prompt }];
	const result: Result = {
		id: task.id,
		pass: false,
		failures: [],
		answer: '',
		toolCalls: [],
		invalidArguments: 0,
		inputTokens: 0,
		outputTokens: 0,
		turns: 0,
		wallMs: 0
	};

	for (let turn = 0; turn < MAX_TURNS; turn++) {
		result.turns = turn + 1;
		const response = await anthropic.beta.messages.create({
			model: args.model!,
			max_tokens: 16000,
			system,
			tools,
			messages,
			output_config: { effort: args.effort as 'low' | 'medium' | 'high' | 'xhigh' | 'max' },
			betas: [FALLBACK_BETA],
			fallbacks: 'default'
		});
		result.inputTokens += response.usage.input_tokens;
		result.outputTokens += response.usage.output_tokens;
		messages.push({ role: 'assistant', content: response.content });

		if (response.stop_reason === 'refusal') {
			result.failures.push('the model refused');
			break;
		}
		if (response.stop_reason === 'pause_turn') continue;
		const uses = response.content.filter(
			(b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use'
		);
		if (!uses.length) {
			result.answer = response.content
				.map((b) => (b.type === 'text' ? b.text : ''))
				.join('\n')
				.trim();
			break;
		}

		const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
		for (const use of uses) {
			const t = Date.now();
			const out = await mcp
				.callTool({ name: use.name, arguments: use.input as Record<string, unknown> })
				.catch((err: unknown) => ({
					isError: true,
					content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }]
				}));
			const content = (out.content ?? []) as unknown[];
			const isError = !!out.isError;
			result.toolCalls.push({ name: use.name, ms: Date.now() - t, isError });
			if (isError && textOf(content).startsWith('Invalid arguments')) result.invalidArguments++;
			results.push({
				type: 'tool_result',
				tool_use_id: use.id,
				content: toBlocks(content) as Anthropic.Beta.BetaToolResultBlockParam['content'],
				is_error: isError
			});
		}
		messages.push({ role: 'user', content: results });
	}

	result.wallMs = Date.now() - started;
	if (!result.answer && !result.failures.length)
		result.failures.push(`no answer in ${MAX_TURNS} turns`);
	await grade(task.expect, result);
	result.pass = result.failures.length === 0;
	return result;
}

async function grade(expect: Expect, r: Result): Promise<void> {
	const called = new Set(r.toolCalls.map((c) => c.name));
	for (const name of expect.toolsCalled ?? []) {
		if (!called.has(name)) r.failures.push(`did not call ${name}`);
	}
	for (const name of expect.toolsNotCalled ?? []) {
		if (called.has(name)) r.failures.push(`called ${name}`);
	}
	for (const [name, max] of Object.entries(expect.maxCalls ?? {})) {
		const n = r.toolCalls.filter((c) => c.name === name).length;
		if (n > max) r.failures.push(`called ${name} ${n} times, at most ${max}`);
	}
	for (const s of expect.answerContains ?? []) {
		if (!r.answer.includes(s)) r.failures.push(`answer lacks "${s}"`);
	}
	if (expect.number) {
		const found = /-?\d+(?:\.\d+)?/.exec(r.answer.replace(/,/g, ''));
		const value = found ? Number(found[0]) : null;
		if (expect.number.expected === null) r.uncalibrated = value;
		else if (value === null || Math.abs(value - expect.number.expected) > expect.number.tolerance) {
			r.failures.push(`answered ${value}, expected ${expect.number.expected}`);
		}
	}
	if (expect.judge && r.answer) {
		const verdict = await judge(expect.judge, r);
		if (verdict) r.failures.push(`judge: ${verdict}`);
	}
}

/** Null when the answer meets the rubric, else the judge's reason. */
async function judge(rubric: string, r: Result): Promise<string | null> {
	const calls = r.toolCalls.map((c) => `${c.name}${c.isError ? ' (error)' : ''}`).join(', ');
	const response = await anthropic.messages.create({
		model: args.model!,
		max_tokens: 2000,
		output_config: { effort: 'low' },
		system:
			'You grade an AI agent’s final answer against a rubric. Reply PASS on the first line if ' +
			'it meets the rubric, else FAIL, then one sentence saying why.',
		messages: [
			{
				role: 'user',
				content: `Rubric: ${rubric}\n\nTools it called, in order: ${calls || 'none'}\n\nAnswer:\n${r.answer}`
			}
		]
	});
	if (response.stop_reason === 'refusal') return 'the judge refused';
	const text = response.content
		.map((b) => (b.type === 'text' ? b.text : ''))
		.join('')
		.trim();
	return text.startsWith('PASS') ? null : text.replace(/^FAIL\s*/, '') || 'failed';
}

const results: Result[] = [];
for (const task of chosen) {
	process.stdout.write(`${task.id} … `);
	const r: Result = await runTask(task).catch((err: unknown): Result => ({
		id: task.id,
		pass: false,
		failures: [`crashed: ${err instanceof Error ? err.message : String(err)}`],
		answer: '',
		toolCalls: [],
		invalidArguments: 0,
		inputTokens: 0,
		outputTokens: 0,
		turns: 0,
		wallMs: 0
	}));
	results.push(r);
	const calls = r.toolCalls.length;
	const tokens = r.inputTokens + r.outputTokens;
	console.info(
		`${r.pass ? 'pass' : 'FAIL'}  ${calls} calls, ${tokens} tokens, ${Math.round(r.wallMs / 1000)}s` +
			(r.invalidArguments ? `, ${r.invalidArguments} invalid arguments` : '') +
			(r.uncalibrated !== undefined ? `, uncalibrated: answered ${r.uncalibrated}` : '') +
			(r.failures.length ? `\n    ${r.failures.join('\n    ')}` : '')
	);
}
await mcp.close();

const passed = results.filter((r) => r.pass).length;
console.info(`\n${passed}/${results.length} passed`);
const dir = new URL('results/', here);
await mkdir(dir, { recursive: true });
const file = new URL(`${new Date().toISOString().replace(/[:.]/g, '-')}.json`, dir);
await writeFile(
	file,
	JSON.stringify({ model: args.model, effort: args.effort, url, results }, null, '\t')
);
console.info(`Results: ${file.pathname}`);
process.exit(passed === results.length ? 0 : 1);
