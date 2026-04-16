<script lang="ts">
	import { Button, Card, Input, toast } from 'selva-shared';
	import { Circle, Server, Plus, Trash2, Star } from '@lucide/svelte';
	import type { ComputeServerConfig } from '@selva/platform/compute';
	import { useComputeHealth } from '$lib/composables/useComputeHealth.svelte';
	import { invalidateAll } from '$app/navigation';

	interface ServerEntry extends ComputeServerConfig {
		label: string;
	}

	interface PageData {
		servers: ServerEntry[];
		defaultServer: string;
	}
	interface Props {
		data: PageData;
	}
	let { data }: Props = $props();

	const computeHealth = useComputeHealth();

	const statusConfig = {
		ok: { label: 'Online', color: 'text-green-600 dark:text-green-400' },
		warning: { label: 'Warning', color: 'text-yellow-600 dark:text-yellow-400' },
		error: { label: 'Offline', color: 'text-red-600 dark:text-red-400' },
		checking: { label: 'Checking…', color: 'text-blue-600 dark:text-blue-400' },
		starting: { label: 'Starting', color: 'text-yellow-600 dark:text-yellow-400' }
	};

	const sc = $derived(statusConfig[computeHealth.health.state]);

	// Editable server list — synced from data on invalidateAll, but locally editable
	let servers = $state<ServerEntry[]>([]);
	let defaultServer = $state('');
	let saving = $state(false);
	let dirty = $state(false);

	$effect(() => {
		if (!dirty) {
			servers = data.servers.map((s) => ({
				...s,
				apiKey: s.apiKey ?? '',
				timeoutMs: s.timeoutMs ?? 30000,
				retryCount: s.retryCount ?? 0
			}));
			defaultServer = data.defaultServer;
		}
	});

	function addServer() {
		servers = [
			...servers,
			{
				label: 'new-server',
				serverUrl: 'http://localhost:5000',
				apiKey: '',
				timeoutMs: 30000,
				retryCount: 0
			}
		];
		dirty = true;
	}

	function removeServer(index: number) {
		const removed = servers[index];
		servers = servers.filter((_, i) => i !== index);
		if (defaultServer === removed.label && servers.length > 0) {
			defaultServer = servers[0].label;
		}
		dirty = true;
	}

	function markDirty() {
		dirty = true;
	}

	async function save() {
		saving = true;
		try {
			const payload = {
				defaultServer,
				servers: servers.map(({ apiKey, retryCount, timeoutMs, ...s }) => ({
					...s,
					timeoutMs: Number(timeoutMs) || 30000,
					...(apiKey ? { apiKey } : {}),
					...(Number(retryCount) ? { retryCount: Number(retryCount) } : {})
				}))
			};
			const res = await fetch('/admin/api/compute', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload)
			});
			if (res.ok) {
				toast.success('Compute config saved');
				await invalidateAll();
				dirty = false;
			} else {
				const err = await res.json().catch(() => ({ error: 'Unknown error' }));
				console.error('[Compute save] failed', res.status, err);
				toast.error(err.message || err.error || `Failed to save (${res.status})`);
			}
		} catch {
			toast.error('Failed to save compute config');
		} finally {
			saving = false;
		}
	}
</script>

<svelte:head>
	<title>Compute - Selva Admin</title>
</svelte:head>

<div class="w-full space-y-6 p-6 lg:px-12 xl:px-16">
	<!-- Live status -->
	<Card.Root>
		<Card.Header>
			<div class="flex items-center justify-between">
				<div>
					<Card.Title>Compute Server Status</Card.Title>
					<Card.Description>Live connection status and version info</Card.Description>
				</div>
				<div class="flex items-center gap-1.5">
					<Circle class="h-2.5 w-2.5 shrink-0 fill-current {sc.color}" />
					<span class="text-xs font-medium {sc.color}">{sc.label}</span>
				</div>
			</div>
		</Card.Header>
		<Card.Content class="space-y-3">
			<p class="text-muted-foreground text-sm">{computeHealth.health.message}</p>
			<div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
				<div class="bg-muted/40 rounded-md p-3">
					<p class="text-muted-foreground text-xs">Rhino</p>
					<p class="mt-0.5 text-sm font-medium">{computeHealth.compute.rhinoVersion ?? '—'}</p>
				</div>
				<div class="bg-muted/40 rounded-md p-3">
					<p class="text-muted-foreground text-xs">Compute</p>
					<p class="mt-0.5 text-sm font-medium">{computeHealth.compute.computeVersion ?? '—'}</p>
				</div>
				<div class="bg-muted/40 rounded-md p-3">
					<p class="text-muted-foreground text-xs">Selva Plugin</p>
					<p class="mt-0.5 text-sm font-medium">
						{#if computeHealth.compute.selvaInstalled}
							{computeHealth.compute.selvaVersion}
						{:else}
							<span class="text-red-600 dark:text-red-400">Not installed</span>
						{/if}
					</p>
				</div>
			</div>
		</Card.Content>
	</Card.Root>

	<!-- Server config editor -->
	<Card.Root>
		<Card.Header>
			<div class="flex items-center justify-between">
				<div>
					<Card.Title>Servers</Card.Title>
					<Card.Description>
						Changes take effect immediately — no restart required.
					</Card.Description>
				</div>
				<div class="flex gap-2">
					<Button variant="outline" size="sm" onclick={addServer}>
						<Plus class="mr-1.5 h-3.5 w-3.5" />
						Add Server
					</Button>
					<Button size="sm" onclick={save} disabled={saving || !dirty}>
						{saving ? 'Saving…' : 'Save'}
					</Button>
				</div>
			</div>
		</Card.Header>
		<Card.Content class="space-y-3">
			{#if servers.length === 0}
				<div
					class="flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-12 text-center"
				>
					<Server class="text-muted-foreground mb-3 h-8 w-8" />
					<p class="text-sm font-medium">No servers configured</p>
					<Button variant="outline" size="sm" class="mt-3" onclick={addServer}>
						<Plus class="mr-1.5 h-3.5 w-3.5" />
						Add Server
					</Button>
				</div>
			{:else}
				{#each servers as server, i (server.label + i)}
					<div class="bg-muted/30 space-y-3 rounded-lg border p-4">
						<div class="flex items-center justify-between">
							<div class="flex items-center gap-2">
								<Input
									placeholder="label"
									value={server.label}
									oninput={(e) => {
										const newLabel = (e.target as HTMLInputElement).value;
										if (defaultServer === server.label) defaultServer = newLabel;
										server.label = newLabel;
										markDirty();
									}}
									class="h-7 w-32 font-mono text-xs"
								/>
								{#if server.label === defaultServer}
									<span
										class="flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800 dark:bg-green-900/30 dark:text-green-400"
									>
										<Star class="h-3 w-3" /> default
									</span>
								{:else}
									<button
										class="text-muted-foreground hover:text-foreground text-xs underline-offset-2 hover:underline"
										onclick={() => {
											defaultServer = server.label;
											dirty = true;
										}}
									>
										set as default
									</button>
								{/if}
							</div>
							<Button
								variant="ghost"
								size="sm"
								onclick={() => removeServer(i)}
								class="text-destructive hover:text-destructive h-7 w-7 p-0"
							>
								<Trash2 class="h-3.5 w-3.5" />
							</Button>
						</div>
						<div class="grid gap-2 sm:grid-cols-2">
							<div class="space-y-1">
								<p class="text-muted-foreground text-xs">Server URL</p>
								<Input
									placeholder="http://localhost:5000"
									bind:value={server.serverUrl}
									oninput={markDirty}
									class="font-mono text-xs"
								/>
							</div>
							<div class="space-y-1">
								<p class="text-muted-foreground text-xs">API Key (optional)</p>
								<Input
									type="password"
									placeholder="••••••••"
									bind:value={server.apiKey}
									oninput={markDirty}
									class="font-mono text-xs"
								/>
							</div>
							<div class="space-y-1">
								<p class="text-muted-foreground text-xs">Timeout (ms)</p>
								<Input
									type="number"
									placeholder="30000"
									bind:value={server.timeoutMs}
									oninput={markDirty}
									class="text-xs"
								/>
							</div>
							<div class="space-y-1">
								<p class="text-muted-foreground text-xs">Retries</p>
								<Input
									type="number"
									placeholder="0"
									bind:value={server.retryCount}
									oninput={markDirty}
									class="text-xs"
								/>
							</div>
						</div>
					</div>
				{/each}
			{/if}
		</Card.Content>
	</Card.Root>

	<!-- Installed plugins -->
	{#if computeHealth.health.reachable}
		<Card.Root>
			<Card.Header>
				<Card.Title>Installed Grasshopper Plugins</Card.Title>
				<Card.Description>Plugins available on the compute server</Card.Description>
			</Card.Header>
			<Card.Content>
				{@const pluginEntries = Object.entries(computeHealth.plugins)}
				{#if pluginEntries.length === 0}
					<p class="text-muted-foreground text-sm">No plugins found</p>
				{:else}
					<div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
						{#each pluginEntries as [name, version] (name)}
							<div class="bg-muted/40 flex items-center justify-between rounded-md px-3 py-2">
								<span class="text-sm font-medium">{name}</span>
								<span class="text-muted-foreground text-xs">{version}</span>
							</div>
						{/each}
					</div>
				{/if}
			</Card.Content>
		</Card.Root>
	{/if}
</div>
