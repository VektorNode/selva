<script lang="ts">
	import { Card, SectionHeader } from '@selvajs/shared';
	import UpdateSection from './UpdateSection.svelte';

	interface PageData {
		canManageUpdates: boolean;
		flags: {
			ALLOW_CROSS_ORG_PUBLIC: boolean;
			ALLOW_ORG_COMPUTE_OVERRIDE: boolean;
			ALLOW_ORG_CREATION: boolean;
		};
	}
	let { data }: { data: PageData } = $props();

	const flagDescriptions: Record<keyof PageData['flags'], string> = {
		ALLOW_CROSS_ORG_PUBLIC:
			'When on, projects can be made visible to every authenticated user on the instance, not just their own org.',
		ALLOW_ORG_COMPUTE_OVERRIDE:
			'When on, individual orgs can configure their own Rhino.Compute server instead of the instance pool.',
		ALLOW_ORG_CREATION:
			'When on, signed-in users see a "Create organization" action. Off by default in self-hosted instances.'
	};

	let updateRunning = $state(false);
	let updateLogs = $state('');
	let updateExitCode = $state<number | null>(null);
	let updateRestarting = $state(false);

	async function waitForAppRestart() {
		updateLogs += '\nWaiting for app to come back online…\n';
		await new Promise((r) => setTimeout(r, 3000));
		for (let i = 0; i < 30; i++) {
			try {
				const res = await fetch('/api/health', { cache: 'no-store' });
				if (res.ok) {
					updateLogs += '✓ App is back online!\n';
					updateExitCode = 0;
					updateRunning = false;
					updateRestarting = false;
					return;
				}
			} catch {
				// still down, keep polling
			}
			await new Promise((r) => setTimeout(r, 2000));
		}
		updateLogs += '⚠ App did not come back within 60s - check PM2 logs.\n';
		updateRunning = false;
		updateRestarting = false;
	}

	async function runUpdate() {
		updateRunning = true;
		updateRestarting = false;
		updateLogs = '';
		updateExitCode = null;
		try {
			const response = await fetch('/admin/api/system/update', { method: 'POST' });
			if (!response.ok) {
				updateLogs = 'Failed to start update process';
				updateRunning = false;
				return;
			}
			const reader = response.body?.getReader();
			const decoder = new TextDecoder();
			if (!reader) {
				updateLogs = 'Failed to read response';
				updateRunning = false;
				return;
			}
			let buffer = '';
			let gotExit = false;
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
						if (event.type === 'log') updateLogs += event.data + '\n';
						else if (event.type === 'restarting') {
							updateLogs += event.data + '\n';
							updateRestarting = true;
						} else if (event.type === 'exit') {
							gotExit = true;
							updateExitCode = event.code;
							updateRunning = false;
						}
					} catch {
						// ignore malformed events
					}
				}
			}
			if (!gotExit) await waitForAppRestart();
		} catch (err) {
			if (updateRunning) {
				await waitForAppRestart();
			} else {
				updateLogs += '\nError: ' + (err instanceof Error ? err.message : 'Unknown error');
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
		description="Instance-wide configuration, platform flags, and the update runner."
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
							<code class="font-mono text-xs text-foreground">{name}</code>
							<p class="mt-1 text-xs text-muted-foreground">
								{flagDescriptions[name as keyof PageData['flags']]}
							</p>
						</div>
						<span
							class={`rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide ${
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
