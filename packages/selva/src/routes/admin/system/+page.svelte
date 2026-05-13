<script lang="ts">
	import { Card, SectionHeader } from '@selvajs/ui';
	import UpdateSection from './UpdateSection.svelte';

	interface PageData {
		canManageUpdates: boolean;
		flags: {
			ALLOW_CROSS_ORG_PUBLIC: boolean;
			ALLOW_ORG_COMPUTE_OVERRIDE: boolean;
			ALLOW_ORG_CREATION: boolean;
			ENABLE_SHARING: boolean;
		};
	}
	let { data }: { data: PageData } = $props();

	const flagDescriptions: Record<keyof PageData['flags'], string> = {
		ALLOW_CROSS_ORG_PUBLIC:
			'When on, projects can be made visible to every authenticated user on the instance, not just their own org.',
		ALLOW_ORG_COMPUTE_OVERRIDE:
			'When on, individual orgs can configure their own Rhino.Compute server instead of the instance pool.',
		ALLOW_ORG_CREATION:
			'When on, signed-in users see a "Create organization" action. Off by default in self-hosted instances.',
		ENABLE_SHARING:
			'When on, editors can mint per-definition share links that grant anonymous external access. When off, the mint/list/revoke routes return 404 and any previously-minted tokens stop resolving.'
	};

	let updateRunning = $state(false);
	let updateLogs = $state('');
	let updateExitCode = $state<number | null>(null);
	let updateRestarting = $state(false);

	type HealthResponse = { status: string; commit?: string | null };

	async function fetchHealth(): Promise<HealthResponse | null> {
		try {
			const res = await fetch('/api/health', { cache: 'no-store' });
			if (!res.ok) return null;
			return (await res.json()) as HealthResponse;
		} catch {
			return null;
		}
	}

	// Poll until we're confident the *new* process is serving:
	//  - If we captured a startup commit, wait for the commit to change.
	//  - Otherwise fall back to requiring 2 consecutive successful health checks
	//    (avoids the race where we hit the old process right before PM2 kills it).
	async function waitForAppRestart(previousCommit: string | null | undefined) {
		updateLogs += '\nWaiting for app to come back online…\n';
		// Give PM2 a moment to actually kill the old process before we start polling.
		await new Promise((r) => setTimeout(r, 2000));

		const maxAttempts = 45; // ~90s
		let consecutiveOk = 0;
		for (let i = 0; i < maxAttempts; i++) {
			const health = await fetchHealth();
			if (health) {
				if (previousCommit && health.commit) {
					if (health.commit !== previousCommit) {
						updateLogs += `✓ App is back online on new commit ${health.commit.slice(0, 7)}\n`;
						updateExitCode = 0;
						updateRunning = false;
						updateRestarting = false;
						return;
					}
					// Same commit — likely still the old process, keep waiting.
					consecutiveOk = 0;
				} else {
					consecutiveOk += 1;
					if (consecutiveOk >= 2) {
						updateLogs += '✓ App is back online!\n';
						updateExitCode = 0;
						updateRunning = false;
						updateRestarting = false;
						return;
					}
				}
			} else {
				consecutiveOk = 0;
			}
			await new Promise((r) => setTimeout(r, 2000));
		}
		updateLogs += '⚠ App did not come back within 90s — check PM2 logs.\n';
		updateExitCode = -2;
		updateRunning = false;
		updateRestarting = false;
	}

	async function runUpdate() {
		updateRunning = true;
		updateRestarting = false;
		updateLogs = '';
		updateExitCode = null;

		// Snapshot the commit of the *currently running* process so we can detect
		// when a new one takes over.
		const preHealth = await fetchHealth();
		const previousCommit = preHealth?.commit ?? null;

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
				await waitForAppRestart(previousCommit);
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
				await waitForAppRestart(previousCommit);
			}
		} catch (err) {
			// Fetch threw — most likely because PM2 killed the connection mid-stream.
			// If we got far enough to see a restart, treat it as expected.
			if (updateRestarting) {
				await waitForAppRestart(previousCommit);
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
		description="Instance-wide configuration, platform flags, and the update runner. To change platform flags, edit your selva.config.ts configuration and restart the app."
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

	{#if data.canManageUpdates}
		<UpdateSection
			isRunning={updateRunning}
			isRestarting={updateRestarting}
			logs={updateLogs}
			exitCode={updateExitCode}
			onRun={runUpdate}
		/>
	{/if}
</div>
