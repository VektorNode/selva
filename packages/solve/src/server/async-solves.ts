import { randomUUID } from 'node:crypto';
import { ASYNC_PREFERENCE, type AsyncSolveAccepted } from '../shared/async-solve.js';

/** True when the request asked to run detached (`Prefer: respond-async`). */
export function wantsAsync(request: Request): boolean {
	const prefer = request.headers.get('Prefer');
	if (!prefer) return false;
	return prefer
		.split(',')
		.some((token) => token.split(';')[0].trim().toLowerCase() === ASYNC_PREFERENCE);
}

/** A finished solve's response, held until it is read again or expires. */
export interface StoredResponse {
	status: number;
	headers: [string, string][];
	body: Uint8Array | null;
}

export type AsyncSolveRead =
	{ kind: 'unknown' } | { kind: 'running' } | ({ kind: 'done' } & StoredResponse);

export interface AsyncSolveStoreOptions {
	/** How long a finished result stays readable. Default 10 minutes. */
	resultTtlMs?: number;
	/** A running solve nobody has polled for this long is cancelled. Default 60 s. */
	abandonAfterMs?: number;
	/** Results held at once, in bytes. Past it the oldest finished ones go first. Default 512 MB. */
	maxResultBytes?: number;
	sweepIntervalMs?: number;
	now?: () => number;
}

interface Entry {
	/** Who may read it; null for a caller with no user (a share link), where the id is the capability. */
	owner: string | null;
	controller: AbortController;
	finished: Promise<void>;
	result?: StoredResponse;
	finishedAt?: number;
	/** Polls waiting right now: a solve someone is waiting on is never abandoned. */
	waiting: number;
	lastSeen: number;
}

/**
 * Solves that outlive their request. `start` runs the work with its own signal and hands back an
 * id at once; `read` long-polls for the response. One process only: a restart loses solves in
 * flight, and the client sees `unknown` and solves again.
 */
export class AsyncSolveStore {
	readonly #entries = new Map<string, Entry>();
	readonly #resultTtlMs: number;
	readonly #abandonAfterMs: number;
	readonly #maxResultBytes: number;
	readonly #now: () => number;
	#heldBytes = 0;
	#sweeper: ReturnType<typeof setInterval> | undefined;

	constructor(options: AsyncSolveStoreOptions = {}) {
		this.#resultTtlMs = options.resultTtlMs ?? 10 * 60_000;
		this.#abandonAfterMs = options.abandonAfterMs ?? 60_000;
		this.#maxResultBytes = options.maxResultBytes ?? 512 * 1024 * 1024;
		this.#now = options.now ?? Date.now;
		this.#sweeper = setInterval(() => this.sweep(), options.sweepIntervalMs ?? 10_000);
		this.#sweeper.unref?.();
	}

	/** `work` must resolve to every outcome, errors included: nobody is left to catch a rejection. */
	start(owner: string | null, work: (signal: AbortSignal) => Promise<Response>): string {
		const solveId = randomUUID();
		const controller = new AbortController();
		const entry: Entry = {
			owner,
			controller,
			waiting: 0,
			lastSeen: this.#now(),
			finished: Promise.resolve()
		};
		entry.finished = work(controller.signal)
			.then(buffer, (err: unknown) => internalError(err))
			.then((result) => {
				// Cancelled or abandoned while it ran: nobody will read it.
				if (this.#entries.get(solveId) !== entry) return;
				entry.result = result;
				entry.finishedAt = this.#now();
				this.#heldBytes += result.body?.byteLength ?? 0;
				this.#evictOverCap();
			});
		this.#entries.set(solveId, entry);
		return solveId;
	}

	/**
	 * The solve's response once it has one, else `running` after `waitMs`. `owner` must match the
	 * one it started under; a mismatch reads as `unknown`, so an id leaks nothing about others.
	 */
	async read(
		solveId: string,
		owner: string | null,
		waitMs: number,
		signal?: AbortSignal
	): Promise<AsyncSolveRead> {
		const entry = this.#readable(solveId, owner);
		if (!entry) return { kind: 'unknown' };
		if (!entry.result && waitMs > 0) {
			entry.waiting += 1;
			try {
				await waitFor(entry.finished, waitMs, signal);
			} finally {
				entry.waiting -= 1;
				entry.lastSeen = this.#now();
			}
		}
		entry.lastSeen = this.#now();
		if (this.#entries.get(solveId) !== entry) return { kind: 'unknown' };
		return entry.result ? { kind: 'done', ...entry.result } : { kind: 'running' };
	}

	/** Stops a running solve, or drops a finished one. False when there is nothing to cancel. */
	cancel(solveId: string, owner: string | null): boolean {
		const entry = this.#readable(solveId, owner);
		if (!entry) return false;
		this.#drop(solveId, entry);
		return true;
	}

	/** Cancels abandoned solves and drops expired results. Runs on a timer; public for tests. */
	sweep(): void {
		const now = this.#now();
		for (const [solveId, entry] of this.#entries) {
			if (entry.result) {
				if (now - (entry.finishedAt ?? now) > this.#resultTtlMs) this.#drop(solveId, entry);
			} else if (entry.waiting === 0 && now - entry.lastSeen > this.#abandonAfterMs) {
				this.#drop(solveId, entry);
			}
		}
	}

	/** Cancels everything, for shutdown. */
	close(): void {
		clearInterval(this.#sweeper);
		for (const [solveId, entry] of this.#entries) this.#drop(solveId, entry);
	}

	get size(): number {
		return this.#entries.size;
	}

	#readable(solveId: string, owner: string | null): Entry | undefined {
		const entry = this.#entries.get(solveId);
		if (!entry) return undefined;
		return entry.owner === null || entry.owner === owner ? entry : undefined;
	}

	#drop(solveId: string, entry: Entry): void {
		this.#entries.delete(solveId);
		if (entry.result) this.#heldBytes -= entry.result.body?.byteLength ?? 0;
		else entry.controller.abort(new DOMException('The solve was cancelled.', 'AbortError'));
	}

	#evictOverCap(): void {
		if (this.#heldBytes <= this.#maxResultBytes) return;
		const finished = [...this.#entries]
			.filter(([, e]) => e.result)
			.sort(([, a], [, b]) => (a.finishedAt ?? 0) - (b.finishedAt ?? 0));
		for (const [solveId, entry] of finished) {
			if (this.#heldBytes <= this.#maxResultBytes) break;
			this.#drop(solveId, entry);
		}
	}
}

/** The 202 that hands the caller its solve id and where to poll. */
export function acceptedResponse(solveId: string, pollUrl: string): Response {
	const body: AsyncSolveAccepted = { solveId };
	return new Response(JSON.stringify(body), {
		status: 202,
		headers: {
			'Content-Type': 'application/json',
			'Cache-Control': 'no-store',
			Location: pollUrl,
			'Preference-Applied': ASYNC_PREFERENCE
		}
	});
}

/** Sends a held result. A gzip body keeps its `Content-Encoding`, so it goes out as stored. */
export function storedToResponse(stored: StoredResponse): Response {
	return new Response(stored.body as ConstructorParameters<typeof Response>[0], {
		status: stored.status,
		headers: stored.headers
	});
}

async function buffer(response: Response): Promise<StoredResponse> {
	const body = response.body ? new Uint8Array(await response.arrayBuffer()) : null;
	return { status: response.status, headers: [...response.headers], body };
}

function internalError(err: unknown): StoredResponse {
	const message = err instanceof Error ? err.message : String(err);
	return {
		status: 500,
		headers: [['content-type', 'application/json']],
		body: new TextEncoder().encode(JSON.stringify({ message, code: 'INTERNAL' }))
	};
}

function waitFor(done: Promise<void>, ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve) => {
		const timer = setTimeout(finish, ms);
		signal?.addEventListener('abort', finish, { once: true });
		void done.then(finish);
		function finish() {
			clearTimeout(timer);
			signal?.removeEventListener('abort', finish);
			resolve();
		}
	});
}
