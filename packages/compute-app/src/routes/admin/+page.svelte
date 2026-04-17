<script lang="ts">
	import { Card } from 'selva-shared';
	import { FileCode, FolderOpen, Users } from '@lucide/svelte';
	import ServerInfoSection from './ServerInfoSection.svelte';
	import UpdateSection from './UpdateSection.svelte';

	interface PageData {
		stats: { definitions: number; projects: number; users: number | null };
	}
	interface Props {
		data: PageData;
	}
	let { data }: Props = $props();

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
		updateLogs += '⚠ App did not come back within 60s — check PM2 logs.\n';
		updateRunning = false;
		updateRestarting = false;
	}

	async function runUpdate() {
		updateRunning = true;
		updateRestarting = false;
		updateLogs = '';
		updateExitCode = null;
		try {
			const response = await fetch('/admin/api/update', { method: 'POST' });
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
	<title>Admin Dashboard - Selva Compute</title>
</svelte:head>

<div class="w-full space-y-6 p-6 lg:px-12 xl:px-16">
	<!-- Stats -->
	<div class="grid gap-4 sm:grid-cols-3">
		<a href="/admin/definitions">
			<Card.Root class="hover:bg-muted/40 cursor-pointer transition-colors">
				<Card.Content class="flex items-center gap-4 pt-6">
					<div class="bg-primary/10 rounded-lg p-3">
						<FileCode class="text-primary h-5 w-5" />
					</div>
					<div>
						<p class="text-2xl font-bold">{data.stats.definitions}</p>
						<p class="text-muted-foreground text-sm">
							Definition{data.stats.definitions === 1 ? '' : 's'}
						</p>
					</div>
				</Card.Content>
			</Card.Root>
		</a>
		<Card.Root>
			<Card.Content class="flex items-center gap-4 pt-6">
				<div class="bg-primary/10 rounded-lg p-3">
					<FolderOpen class="text-primary h-5 w-5" />
				</div>
				<div>
					<p class="text-2xl font-bold">{data.stats.projects}</p>
					<p class="text-muted-foreground text-sm">Project{data.stats.projects === 1 ? '' : 's'}</p>
				</div>
			</Card.Content>
		</Card.Root>
		<a href="/admin/users">
			<Card.Root class="hover:bg-muted/40 cursor-pointer transition-colors">
				<Card.Content class="flex items-center gap-4 pt-6">
					<div class="bg-primary/10 rounded-lg p-3">
						<Users class="text-primary h-5 w-5" />
					</div>
					<div>
						<p class="text-2xl font-bold">{data.stats.users ?? '—'}</p>
						<p class="text-muted-foreground text-sm">
							{data.stats.users === null
								? 'Single-password mode'
								: `User${data.stats.users === 1 ? '' : 's'}`}
						</p>
					</div>
				</Card.Content>
			</Card.Root>
		</a>
	</div>

	<!-- Compute status -->
	<ServerInfoSection />

	<!-- Application Update -->
	<UpdateSection
		isRunning={updateRunning}
		isRestarting={updateRestarting}
		logs={updateLogs}
		exitCode={updateExitCode}
		onRun={runUpdate}
	/>
</div>
