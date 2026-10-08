import { ApiCallError } from './errors.js';
import type { Operation, OperationIndex } from './spec.js';

// ============================================================================
// Types
// ============================================================================
//
// `Ops` is the `operations` interface `openapi-typescript` generates from the
// host's spec. Without it, calls are untyped.

type Params<O> = O extends { parameters: infer P } ? P : object;
type PathOf<O> = Params<O> extends { path?: infer X } ? X : never;
type QueryOf<O> = Params<O> extends { query?: infer X } ? X : never;
type BodyOf<O> = O extends { requestBody?: { content: { 'application/json': infer B } } }
	? B
	: never;
type JsonOf<R> = R extends { content: { 'application/json': infer B } } ? B : undefined;
type SuccessOf<O> = O extends { responses: infer R }
	? R extends { 200: infer S }
		? JsonOf<S>
		: R extends { 201: infer S }
			? JsonOf<S>
			: undefined
	: unknown;

interface CallOptions {
	signal?: AbortSignal;
	/** Overrides the client's default for this call. */
	timeoutMs?: number;
}

export type TypedCallArgs<O> = CallOptions & {
	params?: PathOf<O>;
	query?: QueryOf<O>;
	body?: BodyOf<O>;
};

export interface UntypedCallArgs extends CallOptions {
	params?: Record<string, string | number>;
	query?: Record<string, unknown>;
	body?: unknown;
}

export interface TypedApi<Ops> {
	call<K extends Extract<keyof Ops, string>>(
		operationId: K,
		args?: TypedCallArgs<Ops[K]>
	): Promise<SuccessOf<Ops[K]>>;
}

export interface UntypedApi {
	call(operationId: string, args?: UntypedCallArgs): Promise<unknown>;
}

export type Api<Ops = never> = [Ops] extends [never] ? UntypedApi : TypedApi<Ops>;

/** A binary success body. Tools describe it; the bytes are no use to a model. */
export interface BinaryBody {
	binary: true;
	contentType: string;
	bytes: number;
}

// ============================================================================
// Client
// ============================================================================

export interface ApiClientOptions {
	/** The host's origin, e.g. `https://selva.example.com`. Spec paths carry the `/api/v1` prefix. */
	baseUrl: string;
	apiKey: string;
	fetch?: typeof fetch;
	/** Default 30 s. */
	timeoutMs?: number;
	/** For `solve` operations, which run a whole Compute solve. Default 5 min. */
	solveTimeoutMs?: number;
	/** A 429 with a longer `Retry-After` goes back to the model instead of waiting. Default 10 s. */
	maxRetryWaitSeconds?: number;
}

const RATE_RETRIES = 2;
const NETWORK_RETRIES = 1;

export function createApiClient(
	index: OperationIndex,
	options: ApiClientOptions,
	/** Operations this client may call; anything else throws before reaching the network. */
	allowed?: ReadonlySet<string>
): UntypedApi {
	const doFetch = options.fetch ?? fetch;
	const base = options.baseUrl.replace(/\/$/, '');
	const maxWait = options.maxRetryWaitSeconds ?? 10;

	async function call(operationId: string, args: UntypedCallArgs = {}): Promise<unknown> {
		const op = index.get(operationId);
		if (!op)
			throw new Error(`Unknown operation ${operationId}: not in the host's OpenAPI document`);
		if (allowed && !allowed.has(operationId)) {
			throw new Error(
				`${operationId} is not in this tool's \`calls\`, so its annotations do not cover it`
			);
		}

		const url = base + fillPath(op, args.params) + queryString(args.query);
		const headers: Record<string, string> = {
			Authorization: `Bearer ${options.apiKey}`,
			Accept: 'application/json'
		};
		if (args.body !== undefined) headers['Content-Type'] = 'application/json';
		// One key for every attempt: a retry after a timeout replays instead of running twice.
		if (op.idempotent) headers['Idempotency-Key'] = crypto.randomUUID();

		const timeoutMs =
			args.timeoutMs ??
			(op.scope === 'solve' ? (options.solveTimeoutMs ?? 300_000) : (options.timeoutMs ?? 30_000));
		const canRetryNetwork = op.idempotent || op.method === 'GET';

		let rateRetries = 0;
		let networkRetries = 0;
		for (;;) {
			const timeout = AbortSignal.timeout(timeoutMs);
			const signal = args.signal ? AbortSignal.any([args.signal, timeout]) : timeout;
			let res: Response;
			try {
				res = await doFetch(url, {
					method: op.method,
					headers,
					body: args.body === undefined ? undefined : JSON.stringify(args.body),
					signal
				});
			} catch (err) {
				if (args.signal?.aborted) throw err;
				if (canRetryNetwork && networkRetries++ < NETWORK_RETRIES) continue;
				const timedOut = timeout.aborted;
				throw new ApiCallError(
					operationId,
					0,
					timedOut ? 'TIMEOUT' : 'UNREACHABLE',
					timedOut ? `No response within ${Math.round(timeoutMs / 1000)}s` : errorText(err)
				);
			}

			if (res.status === 429) {
				const wait = retryAfterSeconds(res.headers.get('Retry-After'));
				if (wait !== undefined && wait <= maxWait && rateRetries++ < RATE_RETRIES) {
					await res.body?.cancel();
					await sleep(wait * 1000, args.signal);
					continue;
				}
				throw await toError(operationId, res, wait);
			}
			if (!res.ok) throw await toError(operationId, res);
			return readBody(res);
		}
	}

	return { call };
}

function fillPath(op: Operation, params: UntypedCallArgs['params'] = {}): string {
	return op.path.replace(/\{(\w+)\}/g, (_, name: string) => {
		const value = params[name];
		if (value === undefined || value === '') throw new Error(`${op.operationId} needs \`${name}\``);
		return encodeURIComponent(String(value));
	});
}

function queryString(query: UntypedCallArgs['query']): string {
	const search = new URLSearchParams();
	for (const [key, value] of Object.entries(query ?? {})) {
		if (value === undefined || value === null) continue;
		for (const v of Array.isArray(value) ? value : [value]) search.append(key, String(v));
	}
	const s = search.toString();
	return s ? `?${s}` : '';
}

async function readBody(res: Response): Promise<unknown> {
	if (res.status === 204) return undefined;
	const type = res.headers.get('Content-Type') ?? '';
	if (type.includes('json')) return res.json();
	const bytes = (await res.arrayBuffer()).byteLength;
	return { binary: true, contentType: type, bytes } satisfies BinaryBody;
}

async function toError(
	operationId: string,
	res: Response,
	retryAfter?: number
): Promise<ApiCallError> {
	let body: {
		message?: string;
		code?: string;
		fields?: Record<string, string>;
		details?: Record<string, string>;
	} = {};
	try {
		body = (await res.json()) as typeof body;
	} catch {
		// Not the envelope: a proxy's HTML page or an empty body. The status still says enough.
	}
	return new ApiCallError(
		operationId,
		res.status,
		body.code ?? `HTTP_${res.status}`,
		body.message ?? res.statusText,
		body.fields,
		body.details,
		retryAfter
	);
}

function retryAfterSeconds(header: string | null): number | undefined {
	if (!header) return undefined;
	const seconds = Number(header);
	if (Number.isFinite(seconds)) return Math.max(0, seconds);
	const date = Date.parse(header);
	return Number.isNaN(date) ? undefined : Math.max(0, (date - Date.now()) / 1000);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(resolve, ms);
		signal?.addEventListener('abort', () => {
			clearTimeout(timer);
			reject(signal.reason);
		});
	});
}

function errorText(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}
