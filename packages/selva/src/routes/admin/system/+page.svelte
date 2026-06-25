<script lang="ts">
	import { Card, SectionHeader } from '@selvajs/ui';
	import UpdateSection from './UpdateSection.svelte';
	import ChannelSection from './ChannelSection.svelte';
	import HealthSection from './HealthSection.svelte';

	interface PageData {
		canManageUpdates: boolean;
		isInstanceAdmin: boolean;
		version: string;
		channel: 'stable' | 'beta';
		update: { latest: string | null; updateAvailable: boolean };
		flags: {
			ALLOW_CROSS_ORG_PUBLIC: boolean;
			ALLOW_ORG_COMPUTE_OVERRIDE: boolean;
			ALLOW_ORG_CREATION: boolean;
			ENABLE_PLATFORM_PROJECTS: boolean;
			ENABLE_SHARING: boolean;
		};
		limits: {
			MAX_SOLVE_DURATION_MS: number;
			RATE_LIMIT_WINDOW_MS: number;
			RATE_LIMIT_MAX_REQUESTS: number;
			MAX_GH_FILE_SIZE: number;
			MAX_IMAGE_FILE_SIZE: number;
			COMPUTE_REQUEST_MAX_BYTES: number;
			COMPUTE_RESPONSE_MAX_BYTES: number;
			REMOTE_DEFINITION_MAX_BYTES: number;
			REMOTE_DEFINITION_FETCH_TIMEOUT_MS: number;
			DEFINITION_CACHE_TTL_MS: number;
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
	const limitRows: Array<{
		key: keyof PageData['limits'];
		label: string;
		env: string;
		value: (l: PageData['limits']) => string;
		description: string;
	}> = [
		{
			key: 'MAX_SOLVE_DURATION_MS',
			label: 'Max solve duration',
			env: 'MAX_SOLVE_DURATION_MS',
			value: (l) => formatMs(l.MAX_SOLVE_DURATION_MS),
			description: 'Longest a single /api/compute solve may run before it is aborted.'
		},
		{
			key: 'RATE_LIMIT_MAX_REQUESTS',
			label: 'Compute rate limit',
			// Two vars drive this row: the count and the window. Show both so an
			// operator who wants to change "/ 1.7 min" knows which knob to set.
			env: 'COMPUTE_RATE_LIMIT_MAX · COMPUTE_RATE_LIMIT_WINDOW_MS',
			value: (l) => `${l.RATE_LIMIT_MAX_REQUESTS} / ${formatMs(l.RATE_LIMIT_WINDOW_MS)}`,
			description: 'Max solves per key (user or share-link) within the fixed window.'
		},
		{
			key: 'MAX_GH_FILE_SIZE',
			label: 'Max .gh upload size',
			env: 'MAX_GH_FILE_SIZE_BYTES',
			value: (l) => formatBytes(l.MAX_GH_FILE_SIZE),
			description: 'Largest Grasshopper definition accepted on upload.'
		},
		{
			key: 'MAX_IMAGE_FILE_SIZE',
			label: 'Max cover image size',
			env: 'MAX_IMAGE_FILE_SIZE_BYTES',
			value: (l) => formatBytes(l.MAX_IMAGE_FILE_SIZE),
			description: 'Largest cover image accepted on upload.'
		},
		{
			key: 'COMPUTE_REQUEST_MAX_BYTES',
			label: 'Compute request body cap',
			env: 'COMPUTE_REQUEST_MAX_BYTES',
			value: (l) => formatBytes(l.COMPUTE_REQUEST_MAX_BYTES),
			description: 'Max /api/compute JSON request size (inputs + base64 file values).'
		},
		{
			key: 'COMPUTE_RESPONSE_MAX_BYTES',
			label: 'Compute response body cap',
			env: 'COMPUTE_RESPONSE_MAX_BYTES',
			value: (l) => formatBytes(l.COMPUTE_RESPONSE_MAX_BYTES),
			description: 'Max /api/compute JSON response size before it 413s.'
		},
		{
			key: 'REMOTE_DEFINITION_MAX_BYTES',
			label: 'Remote definition fetch cap',
			env: 'MAX_GH_FILE_SIZE_BYTES',
			value: (l) => formatBytes(l.REMOTE_DEFINITION_MAX_BYTES),
			description: 'Max size of a remotely-fetched .gh (tracks the upload cap).'
		},
		{
			key: 'REMOTE_DEFINITION_FETCH_TIMEOUT_MS',
			label: 'Remote definition fetch timeout',
			env: 'REMOTE_DEFINITION_FETCH_TIMEOUT_MS',
			value: (l) => formatMs(l.REMOTE_DEFINITION_FETCH_TIMEOUT_MS),
			description: 'Deadline for fetching a remote .gh before the request is dropped.'
		},
		{
			key: 'DEFINITION_CACHE_TTL_MS',
			label: 'Definition cache TTL',
			env: 'DEFINITION_CACHE_TTL_MS',
			value: (l) => formatMs(l.DEFINITION_CACHE_TTL_MS),
			description: 'How long remotely-fetched .gh bytes stay cached in-process.'
		}
	];

	const flagDescriptions: Record<keyof PageData['flags'], string> = {
		ALLOW_CROSS_ORG_PUBLIC:
			'When on, projects can be made visible to every authenticated user on the instance, not just their own org.',
		ALLOW_ORG_COMPUTE_OVERRIDE:
			'When on, individual orgs can configure their own Rhino.Compute server instead of the instance pool.',
		ALLOW_ORG_CREATION:
			'When on, signed-in users see a "Create organization" action. Off by default in self-hosted instances.',
		ENABLE_PLATFORM_PROJECTS:
			'When on, the Admin → Projects surface is reachable: instance admins can create platform-owned projects and grant view/solve access to orgs or individual users. When off, the surface 404s and platform-visibility projects are hidden everywhere — existing rows are preserved.',
		ENABLE_SHARING:
			'When on, editors can mint per-definition share links that grant anonymous external access. When off, the mint/list/revoke routes return 404 and any previously-minted tokens stop resolving.'
	};

	let updateRunning = $state(false);
	let updateLogs = $state('');
	let updateExitCode = $state<number | null>(null);
	let updateRestarting = $state(false);

	type HealthResponse = {
		status: string;
		instanceId?: string | null;
		version?: string | null;
	};

	async function fetchHealth(): Promise<HealthResponse | null> {
		try {
			const res = await fetch('/api/health', { cache: 'no-store' });
			if (!res.ok) return null;
			return (await res.json()) as HealthResponse;
		} catch {
			return null;
		}
	}

	// Probe the *heavier* readiness endpoint (`/admin/api/system/health`), not
	// just /api/health. The lightweight /api/health answers the instant the Node
	// process boots — before the app can necessarily serve real routes through
	// the proxy — so keying "online" on it alone races: the UI said "back online"
	// while a health-check click moments later 502'd. The admin health route
	// exercises the provider stores / config the way a real request does, so a
	// 200 here means the app is genuinely warm. We gate on HTTP reachability
	// only: this route returns 200 even when its *verdict* is "degraded" (e.g. an
	// unreachable compute server), and degraded-but-up must not block "online".
	// Returns true only on a real 200; false on any non-2xx or transport error.
	async function isReadinessProbeWarm(): Promise<boolean> {
		try {
			const res = await fetch('/admin/api/system/health', { cache: 'no-store' });
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
			const res = await fetch('/admin/api/system/update', { cache: 'no-store' });
			if (!res.ok) return null;
			return await res.text();
		} catch {
			return null;
		}
	}

	// The health poller only proves the app is *reachable* — NOT that the update
	// succeeded. A rollback (runner exit 5) leaves the app perfectly healthy on
	// the OLD version; if we reported that as exit 0 the operator would think
	// the update worked. So once the app is back we read the runner's own
	// verdict out of the log file and map it to the exit code the UI classifies.
	// Returns null when the log carries no terminal marker (fall back to health).
	function exitCodeFromLog(log: string): number | null {
		if (/\bManual recovery required\b/.test(log)) return 6; // rollback failed — app may be DOWN
		if (/\bRolled back to .* — previous version is online\b/.test(log)) return 5; // safe rollback
		if (/New process failed health check/.test(log) && !/Rolled back/.test(log)) return 3;
		if (/\[FATAL\]/.test(log) && !/\[DONE\]/.test(log)) return 1; // fatal with no clean finish
		if (/\[DONE\]/.test(log)) return 0; // runner reported clean completion
		return null;
	}

	// Poll until we're confident the *new* process is serving.
	//
	// The reliable signal is `instanceId`: a per-boot fingerprint from
	// /api/health that changes on every restart. We wait for it to differ from
	// the process that was running before we started — that's the ONLY moment
	// we know the old process is gone and a fresh one is answering. This works
	// in every deployment shape (npm has no git commit) and even when the new
	// build is the same version (rollback / reinstall).
	//
	// Crucially we do NOT treat "reachable" as "ready": fetchHealth returns null
	// for a 503 (degraded / still booting) or a refused connection, and we keep
	// waiting. A bare 200 from the OLD process carries the OLD instanceId, so it
	// can't satisfy the check either. And even a fresh instanceId isn't enough on
	// its own — /api/health answers the instant the process boots, a beat before
	// real routes serve through the proxy, so we additionally require the heavier
	// /admin/api/system/health route to answer 200 (isReadinessProbeWarm). That
	// pairing is what prevents the premature "online" verdict that left an
	// immediate reload / health-check click hitting a 502.
	//
	// While polling we also fetch the update log file. The SSE stream died at
	// `pm2 stop`, so any output the script produced afterwards (npm update,
	// pm2 start, health probe, rollback) is invisible until the new process is
	// reachable. Each successful log fetch replaces the displayed logs with
	// the full file content, surfacing the blackout chunk in one shot.
	async function waitForAppRestart(previousInstanceId: string | null | undefined) {
		updateLogs += '\nWaiting for app to come back online…\n';
		// Give PM2 a moment to actually kill the old process before we start polling.
		await new Promise((r) => setTimeout(r, 2000));

		// 5 minutes. npm update on a slow VPS with a cold packument cache plus
		// pm2 cold-start can legitimately take 60–90s; 90s total wasn't enough
		// headroom and was failing live customers even when the update was
		// otherwise succeeding in the background.
		const maxAttempts = 150; // ~5min
		for (let i = 0; i < maxAttempts; i++) {
			const [health, log, ready] = await Promise.all([
				fetchHealth(),
				fetchUpdateLog(),
				isReadinessProbeWarm()
			]);
			// Backfill blackout output as soon as either the old process briefly
			// recovers or the new one comes up. We ignore empty bodies — those
			// mean either the file isn't there yet or we'd needlessly clobber
			// the SSE-collected prefix with nothing.
			if (log && log.trim().length > 0) {
				updateLogs = log;
			}
			// A *new* instanceId means the new process is up and serving (status
			// was 'ok', or fetchHealth would have returned null). Trust the
			// runner's logged verdict over a bare assumption of success — a
			// rollback also brings up a fresh process but must not be reported
			// as a clean update.
			//
			// If we never captured a baseline instanceId (the pre-update health
			// fetch failed, or an old build with no fingerprint), we can't tell
			// the new process from the old one by id alone — so we hold out for
			// the runner's own terminal marker in the log ([DONE]/rollback/fatal)
			// before accepting. That avoids latching onto the still-running old
			// process and reporting "online" prematurely.
			// "Online" requires BOTH a fresh process (new instanceId) AND the
			// heavier readiness probe answering 200 — the latter is what closes the
			// premature-online race, where /api/health flips to the new instanceId a
			// beat before the app can actually serve real routes through the proxy.
			const newProcessUp =
				!!health?.instanceId && health.instanceId !== previousInstanceId && ready;
			const logVerdict = exitCodeFromLog(updateLogs);
			if (newProcessUp) {
				updateExitCode = logVerdict ?? 0;
				updateRunning = false;
				updateRestarting = false;
				return;
			}
			if (!previousInstanceId && health && ready && logVerdict !== null) {
				updateExitCode = logVerdict;
				updateRunning = false;
				updateRestarting = false;
				return;
			}
			await new Promise((r) => setTimeout(r, 2000));
		}
		// Final log fetch so the post-mortem has the latest content the script
		// managed to write before the timeout.
		const finalLog = await fetchUpdateLog();
		if (finalLog && finalLog.trim().length > 0) updateLogs = finalLog;
		updateLogs += '\n⚠ App did not come back within 5 minutes — check PM2 logs.\n';
		updateExitCode = -2;
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
			const response = await fetch('/admin/api/system/update', { method: 'POST' });
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

			// PM2 kills the SSE stream as part of the restart — so a dropped stream
			// (or a non-zero "exit" arriving moments before death) after we've seen
			// the "restarting" signal is EXPECTED, not a failure. Treat it as such
			// and let the health poller decide whether the new process came up.
			if (sawRestarting) {
				await waitForAppRestart(previousInstanceId);
			} else if (sawExit && streamExitCode === 0) {
				// Clean exit, no restart (e.g. --no-restart or "already up to date").
				updateExitCode = 0;
				updateRunning = false;
			} else if (sawExit) {
				// Real failure before we ever got to the restart phase.
				updateExitCode = streamExitCode ?? -1;
				updateRunning = false;
			} else {
				// Stream ended without exit and without restart signal — unusual,
				// but still poll health in case the script silently restarted.
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
		description="Instance-wide configuration, platform flags, and the update runner. To change platform flags, edit SELVA_FLAG_* in your .env and restart the app."
	/>

	<Card.Root>
		<Card.Header>
			<Card.Title class="text-sm font-medium">Platform flags</Card.Title>
			<Card.Description>
				Resolved state of the env-driven flags that control instance behavior. To change a flag,
				edit your environment configuration and restart the app.
			</Card.Description>
		</Card.Header>
		<Card.Content>
			<div class="divide-y rounded-lg border">
				{#each Object.entries(data.flags) as [name, value] (name)}
					<div class="flex items-start justify-between gap-4 px-4 py-3">
						<div class="min-w-0 flex-1">
							<code class="text-foreground font-mono text-xs">{name}</code>
							<p class="text-muted-foreground mt-1 text-xs">
								{flagDescriptions[name as keyof PageData['flags']]}
							</p>
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
				Resolved compute, upload, and timeout caps currently enforced by the instance. Each value
				reflects its environment override or the built-in default. To change one, set the listed
				variable in your environment configuration and restart the app.
			</Card.Description>
		</Card.Header>
		<Card.Content>
			<div class="divide-y rounded-lg border">
				{#each limitRows as row (row.key)}
					<div class="flex items-start justify-between gap-4 px-4 py-3">
						<div class="min-w-0 flex-1">
							<span class="text-foreground text-sm font-medium">{row.label}</span>
							<p class="text-muted-foreground mt-1 text-xs">{row.description}</p>
							<code class="text-muted-foreground mt-1 block font-mono text-[10px]">{row.env}</code>
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
			onRun={runUpdate}
		/>
	{/if}
</div>
