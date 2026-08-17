<script lang="ts">
	import { Card, SectionHeader } from '@selvajs/ui';
	import UpdateSection from './UpdateSection.svelte';
	import ChannelSection from './ChannelSection.svelte';
	import HealthSection from './HealthSection.svelte';
	import NetworkSection from './NetworkSection.svelte';
	import { pollForRestart, type RestartHealth } from '$lib/update-restart-poll';

	interface PageData {
		canManageUpdates: boolean;
		isInstanceAdmin: boolean;
		version: string;
		channel: 'stable' | 'beta';
		update: {
			latest: string | null;
			updateAvailable: boolean;
			nodeCompatibility: { compatible: boolean | null; required: string | null; running: string };
		};
		flags: {
			ALLOW_CROSS_ORG_PUBLIC: boolean;
			ALLOW_ORG_COMPUTE_OVERRIDE: boolean;
			ALLOW_ORG_CREATION: boolean;
			ENABLE_PLATFORM_PROJECTS: boolean;
			ENABLE_SHARING: boolean;
		};
		limits: {
			SOLVE_DEADLINE_MS: number;
			RATE_LIMIT_WINDOW_MS: number;
			RATE_LIMIT_MAX_REQUESTS: number;
			MAX_DEFINITION_FILE_SIZE: number;
			MAX_IMAGE_FILE_SIZE: number;
			COMPUTE_REQUEST_MAX_BYTES: number;
			COMPUTE_RESPONSE_MAX_BYTES: number;
			REMOTE_DEFINITION_MAX_BYTES: number;
			REMOTE_DEFINITION_FETCH_TIMEOUT_MS: number;
			REMOTE_DEFINITION_CACHE_TTL_MS: number;
			COMPUTE_DEFINITION_CACHE_BYTES: number;
			COMPUTE_SOLVE_CACHE_BYTES: number;
		};
	}
	let { data }: { data: PageData } = $props();

	function formatBytes(bytes: number): string {
		if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
		if (bytes >= 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MB`;
		if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
		return `${bytes} B`;
	}

	function formatMs(ms: number): string {
		if (ms >= 60_000) {
			const mins = ms / 60_000;
			return `${Number.isInteger(mins) ? mins : mins.toFixed(1)} min`;
		}
		if (ms >= 1000) {
			const s = ms / 1000;
			return `${Number.isInteger(s) ? s : s.toFixed(1)} s`;
		}
		return `${ms} ms`;
	}

	// Display metadata for each resolved limit, in render order. The `value`
	// thunk picks the right unit formatter; `env` is the override var name.
	// `note` is optional and only carries what the label and value can't: a
	// multiplier, a disable sentinel, what a limit is keyed on. What each var
	// means belongs in .env.example, not here.
	const limitRows: Array<{
		key: keyof PageData['limits'];
		label: string;
		env: string;
		value: (l: PageData['limits']) => string;
		note?: string;
	}> = [
		{
			key: 'SOLVE_DEADLINE_MS',
			label: 'Solve deadline',
			env: 'COMPUTE_SOLVE_DEADLINE_MS',
			value: (l) => formatMs(l.SOLVE_DEADLINE_MS)
		},
		{
			key: 'RATE_LIMIT_MAX_REQUESTS',
			label: 'Compute rate limit',
			// Two vars drive this row: the count and the window. Show both so an
			// operator who wants to change "/ 1.7 min" knows which knob to set.
			env: 'COMPUTE_RATE_LIMIT_MAX · COMPUTE_RATE_LIMIT_WINDOW_MS',
			value: (l) => `${l.RATE_LIMIT_MAX_REQUESTS} / ${formatMs(l.RATE_LIMIT_WINDOW_MS)}`,
			note: 'Counted per key — a user or a share link.'
		},
		{
			key: 'MAX_DEFINITION_FILE_SIZE',
			label: 'Max .gh upload size',
			env: 'MAX_DEFINITION_FILE_SIZE_BYTES',
			value: (l) => formatBytes(l.MAX_DEFINITION_FILE_SIZE)
		},
		{
			key: 'MAX_IMAGE_FILE_SIZE',
			label: 'Max cover image size',
			env: 'MAX_IMAGE_FILE_SIZE_BYTES',
			value: (l) => formatBytes(l.MAX_IMAGE_FILE_SIZE)
		},
		{
			key: 'COMPUTE_REQUEST_MAX_BYTES',
			label: 'Compute request body cap',
			env: 'COMPUTE_REQUEST_MAX_BYTES',
			value: (l) => formatBytes(l.COMPUTE_REQUEST_MAX_BYTES),
			note: 'Inputs plus base64 file values.'
		},
		{
			key: 'COMPUTE_RESPONSE_MAX_BYTES',
			label: 'Compute response body cap',
			env: 'COMPUTE_RESPONSE_MAX_BYTES',
			value: (l) => formatBytes(l.COMPUTE_RESPONSE_MAX_BYTES)
		},
		{
			key: 'REMOTE_DEFINITION_MAX_BYTES',
			label: 'Remote definition fetch cap',
			env: 'MAX_DEFINITION_FILE_SIZE_BYTES',
			value: (l) => formatBytes(l.REMOTE_DEFINITION_MAX_BYTES),
			note: 'Shares the upload cap above — one var sets both.'
		},
		{
			key: 'REMOTE_DEFINITION_FETCH_TIMEOUT_MS',
			label: 'Remote definition fetch timeout',
			env: 'REMOTE_DEFINITION_FETCH_TIMEOUT_MS',
			value: (l) => formatMs(l.REMOTE_DEFINITION_FETCH_TIMEOUT_MS)
		},
		{
			key: 'REMOTE_DEFINITION_CACHE_TTL_MS',
			label: 'Remote definition cache TTL',
			env: 'REMOTE_DEFINITION_CACHE_TTL_MS',
			value: (l) => formatMs(l.REMOTE_DEFINITION_CACHE_TTL_MS),
			note: 'Remote fetches only — uploads are keyed on an immutable version and never go stale.'
		},
		{
			key: 'COMPUTE_DEFINITION_CACHE_BYTES',
			label: 'Definition cache',
			env: 'COMPUTE_DEFINITION_CACHE_MB',
			value: (l) => formatBytes(l.COMPUTE_DEFINITION_CACHE_BYTES),
			note: '0 disables.'
		},
		{
			key: 'COMPUTE_SOLVE_CACHE_BYTES',
			label: 'Solve cache',
			env: 'COMPUTE_SOLVE_CACHE_MB',
			value: (l) => formatBytes(l.COMPUTE_SOLVE_CACHE_BYTES),
			note: 'Per compute server, up to 16 kept warm — worst case is 16× this. 0 disables.'
		}
	];

	// Only flags whose resolved value misleads on its own. What each flag *does* is
	// documented in .env.example — repeating it here just gives it somewhere to drift.
	const flagNotes: Partial<Record<keyof PageData['flags'], string>> = {
		ALLOW_ORG_CREATION:
			'Not wired up yet — no route consults this flag, so flipping it does nothing.'
	};

	let updateRunning = $state(false);
	let updateLogs = $state('');
	let updateExitCode = $state<number | null>(null);
	let updateRestarting = $state(false);

	// A probe against a stopped app usually does NOT fail fast: the reverse proxy
	// in front of it holds the connection open until its own read timeout rather
	// than refusing it. Bare `fetch` has no timeout, so without this the restart
	// poll below blocks for a minute or more per attempt — the banner freezes on
	// "PM2 is restarting…" and only a manual reload shows the real state.
	const PROBE_TIMEOUT_MS = 4000;

	// A 503 here means "up but degraded" (see /api/health) — the process is
	// answering, which is all this probe is asked to establish. Treating it as
	// unreachable stalls the restart wait on an instance that is genuinely back.
	async function fetchHealth(): Promise<RestartHealth | null> {
		try {
			const res = await fetch('/api/health', {
				cache: 'no-store',
				signal: AbortSignal.timeout(PROBE_TIMEOUT_MS)
			});
			if (!res.ok && res.status !== 503) return null;
			return (await res.json()) as RestartHealth;
		} catch {
			return null;
		}
	}

	// Probe readiness, not just liveness. /api/health answers the instant the Node
	// process boots — before the app can necessarily serve real routes through the
	// proxy — so keying "online" on it alone races: the UI said "back online"
	// while a health-check click moments later 502'd. `/api/health/ready` does one
	// provider read, the same one the auth hook makes on every gated request, so a
	// 200 means a real request would succeed.
	//
	// Deliberately NOT `/api/admin/system/health`: that route pings the compute
	// server, so it reports non-ok whenever an unrelated dependency is down and
	// can outlast any sane probe timeout. Using it here meant a finished update
	// could never be confirmed on a deployment whose compute server was down.
	async function isReadinessProbeWarm(): Promise<boolean> {
		try {
			const res = await fetch('/api/health/ready', {
				cache: 'no-store',
				signal: AbortSignal.timeout(PROBE_TIMEOUT_MS)
			});
			return res.ok;
		} catch {
			return false;
		}
	}

	// Pull the tee'd update log from the server. Returns the *full* log file
	// content — the script truncates at the start of every run so this isn't
	// cumulative across updates. Returns null if the request fails (typically
	// during the window where the old selva-compute is dead and the new one
	// hasn't booted yet).
	async function fetchUpdateLog(): Promise<string | null> {
		try {
			const res = await fetch('/api/admin/system/update', {
				cache: 'no-store',
				signal: AbortSignal.timeout(PROBE_TIMEOUT_MS * 2)
			});
			if (!res.ok) return null;
			return await res.text();
		} catch {
			return null;
		}
	}

	// Poll until the new process is serving. The loop itself lives in
	// `$lib/update-restart-poll` so it can be tested against a clock and probes
	// that misbehave on demand; this wrapper owns only the `$state` writes.
	async function waitForAppRestart(previousInstanceId: string | null | undefined) {
		// The daemonized runner never streams over SSE, so the SSE `restarting`
		// event can't drive this flag — set it here, where we actually begin the
		// restart wait, so the "PM2 is restarting…" banner reflects reality.
		updateRestarting = true;

		const { exitCode } = await pollForRestart(previousInstanceId, {
			probes: {
				health: fetchHealth,
				log: fetchUpdateLog,
				ready: isReadinessProbeWarm
			},
			now: () => Date.now(),
			sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
			onLog: (log) => {
				updateLogs = log;
			},
			appendLog: (line) => {
				updateLogs += line;
			}
		});

		updateExitCode = exitCode;
		updateRunning = false;
		updateRestarting = false;
	}

	async function runUpdate() {
		updateRunning = true;
		updateRestarting = false;
		updateLogs = '';
		updateExitCode = null;

		// Snapshot the instanceId of the *currently running* process so we can
		// detect when a new one takes over (the value changes on every boot).
		const preHealth = await fetchHealth();
		const previousInstanceId = preHealth?.instanceId ?? null;

		try {
			const response = await fetch('/api/admin/system/update', { method: 'POST' });
			if (!response.ok) {
				updateLogs = 'Failed to start update process';
				updateExitCode = response.status;
				updateRunning = false;
				return;
			}
			const reader = response.body?.getReader();
			const decoder = new TextDecoder();
			if (!reader) {
				updateLogs = 'Failed to read response';
				updateExitCode = -1;
				updateRunning = false;
				return;
			}
			let buffer = '';
			let sawRestarting = false;
			let sawExit = false;
			let streamExitCode: number | null = null;
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				buffer += decoder.decode(value, { stream: true });
				const parts = buffer.split('\n\n');
				buffer = parts.pop()!;
				for (const part of parts) {
					if (!part.startsWith('data: ')) continue;
					try {
						const event = JSON.parse(part.slice(6));
						if (event.type === 'log') {
							updateLogs += event.data + '\n';
						} else if (event.type === 'restarting') {
							updateLogs += event.data + '\n';
							updateRestarting = true;
							sawRestarting = true;
						} else if (event.type === 'exit') {
							sawExit = true;
							streamExitCode = event.code;
						}
					} catch {
						// ignore malformed events
					}
				}
			}

			// The POST spawns a LAUNCHER that daemonizes the real update runner and
			// then exits 0 on its own. So the SSE stream closing with exit 0 means
			// "runner launched", NOT "update finished" — and because the runner's
			// output (pm2 stop/start, npm, health probe, rollback) is redirected to
			// the log file, the SSE stream never carries the `restarting` signal or
			// the runner's real exit code. The only source of truth from here is
			// /api/health + the log file, which waitForAppRestart polls.
			//
			// The one case we can decide from the stream alone: the launcher itself
			// exiting non-zero means it failed before daemonizing anything, so nothing
			// is updating in the background — surface that directly.
			if (sawExit && !sawRestarting && streamExitCode !== null && streamExitCode !== 0) {
				updateExitCode = streamExitCode;
				updateRunning = false;
			} else {
				await waitForAppRestart(previousInstanceId);
			}
		} catch (err) {
			// Fetch threw — most likely because PM2 killed the connection mid-stream.
			// If we got far enough to see a restart, treat it as expected.
			if (updateRestarting) {
				await waitForAppRestart(previousInstanceId);
			} else {
				updateLogs += '\nError: ' + (err instanceof Error ? err.message : 'Unknown error');
				updateExitCode = -1;
				updateRunning = false;
			}
		}
	}
</script>

<svelte:head>
	<title>Admin · System</title>
</svelte:head>

<div class="space-y-6">
	<SectionHeader
		eyebrow="Admin"
		title="System settings"
		description="Instance-wide configuration, platform flags, and the update runner. Flags and limits are env-driven — change one in your .env and restart the app."
	/>

	<Card.Root>
		<Card.Header>
			<Card.Title class="text-sm font-medium">Platform flags</Card.Title>
			<Card.Description>
				Resolved state of the <code class="font-mono text-xs">SELVA_FLAG_*</code> env vars. See
				<code class="font-mono text-xs">.env.example</code> for what each one does.
			</Card.Description>
		</Card.Header>
		<Card.Content>
			<div class="divide-y rounded-lg border">
				{#each Object.entries(data.flags) as [name, value] (name)}
					<div class="flex items-center justify-between gap-4 px-4 py-2">
						<div class="min-w-0 flex-1">
							<code class="text-foreground font-mono text-xs">{name}</code>
							{#if flagNotes[name as keyof PageData['flags']]}
								<p class="text-muted-foreground mt-1 text-xs">
									{flagNotes[name as keyof PageData['flags']]}
								</p>
							{/if}
						</div>
						<span
							class={`rounded-full border px-2 py-0.5 font-mono text-[10px] tracking-wide uppercase ${
								value
									? 'border-success/40 bg-success/10 text-success'
									: 'border-border text-muted-foreground'
							}`}
						>
							{value ? 'On' : 'Off'}
						</span>
					</div>
				{/each}
			</div>
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header>
			<Card.Title class="text-sm font-medium">Platform limits</Card.Title>
			<Card.Description>
				Caps currently enforced by the instance — each value is its environment override, or the
				built-in default where unset. Set the listed variable and restart to change one.
			</Card.Description>
		</Card.Header>
		<Card.Content>
			<div class="divide-y rounded-lg border">
				{#each limitRows as row (row.key)}
					<div class="flex items-start justify-between gap-4 px-4 py-3">
						<div class="min-w-0 flex-1">
							<span class="text-foreground text-sm font-medium">{row.label}</span>
							<code class="text-muted-foreground mt-0.5 block font-mono text-[10px]">{row.env}</code
							>
							{#if row.note}
								<p class="text-muted-foreground mt-1 text-xs">{row.note}</p>
							{/if}
						</div>
						<span
							class="border-border text-foreground shrink-0 rounded-full border px-2 py-0.5 font-mono text-[10px] tracking-wide whitespace-nowrap"
						>
							{row.value(data.limits)}
						</span>
					</div>
				{/each}
			</div>
		</Card.Content>
	</Card.Root>

	{#if data.isInstanceAdmin}
		<HealthSection />
		<NetworkSection />
	{/if}

	{#if data.canManageUpdates}
		{#key data.channel}
			<ChannelSection channel={data.channel} disabled={updateRunning} />
		{/key}
		<UpdateSection
			currentVersion={data.version}
			latestVersion={data.update.latest}
			updateAvailable={data.update.updateAvailable}
			channel={data.channel}
			isRunning={updateRunning}
			isRestarting={updateRestarting}
			logs={updateLogs}
			exitCode={updateExitCode}
			nodeCompatibility={data.update.nodeCompatibility}
			onRun={runUpdate}
		/>
	{/if}
</div>
