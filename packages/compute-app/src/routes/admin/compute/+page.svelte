<script lang="ts">
	import { Button, Card, Input, toast } from 'selva-shared';
	import { Circle, Server, Plus, Trash2, Star } from '@lucide/svelte';
	import type { ComputeServerConfig } from '@selva/platform/compute';
	import { useComputeHealth } from '$lib/composables/useComputeHealth.svelte';
	import { invalidateAll } from '$app/navigation';

	interface ServerEntry extends Omit<ComputeServerConfig, 'apiKey'> {
		apiKey: string; // empty = unchanged, non-empty = new value, '__clear__' = explicit clear
		hasApiKey: boolean; // true = a key is stored server-side (but we don't know its value)
		storedKeyIndex: number; // index in the original server list, for server-side key preservation
	}

	interface PageData {
		servers: (Omit<ComputeServerConfig, 'apiKey'> & { hasApiKey: boolean })[];
		defaultServerId: string;
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
	let defaultServerId = $state('');
	let saving = $state(false);
	let dirty = $state(false);

	$effect(() => {
		if (!dirty) {
			servers = data.servers.map((s, i) => ({
				id: s.id,
				label: s.label,
				serverUrl: s.serverUrl,
				timeoutMs: s.timeoutMs ?? 30000,
				retryCount: s.retryCount ?? 0,
				apiKey: '',
				hasApiKey: s.hasApiKey,
				storedKeyIndex: i
			}));
			defaultServerId = data.defaultServerId;
		}
	});

	function addServer() {
		const id = crypto.randomUUID();
		const entry = {
			id,
			label: 'new-server',
			serverUrl: 'http://localhost:5000',
			apiKey: '',
			hasApiKey: false,
			storedKeyIndex: -1,
			timeoutMs: 30000,
			retryCount: 0
		};
		if (servers.length === 0) defaultServerId = id;
		servers = [...servers, entry];
		dirty = true;
	}

	function removeServer(index: number) {
		const removed = servers[index];
		servers = servers.filter((_, i) => i !== index);
		if (defaultServerId === removed.id && servers.length > 0) {
			defaultServerId = servers[0].id;
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
				defaultServerId,
				servers: servers.map(
					({ apiKey, hasApiKey: _, retryCount, timeoutMs, storedKeyIndex, ...s }) => ({
						...s,
						storedKeyIndex,
						timeoutMs: Math.min(300000, Math.max(1000, Number(timeoutMs) || 30000)),
						// empty string = unchanged (omit); '__clear__' = null (explicit clear); value = new key
						...(apiKey === '__clear__' ? { apiKey: null } : apiKey ? { apiKey } : {}),
						...(Number(retryCount)
							? { retryCount: Math.min(5, Math.max(0, Number(retryCount))) }
							: {})
					})
				)
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
				{#each servers as server, i (i)}
					<div class="bg-muted/30 space-y-3 rounded-lg border p-4">
						<div class="flex items-center justify-between">
							<div class="flex items-center gap-2">
								<Input
									placeholder="label"
									value={server.label}
									oninput={(e) => {
										const input = e.target as HTMLInputElement;
										server.label = input.value.toLowerCase().replace(/[^a-z0-9_-]/g, '');
										input.value = server.label;
										markDirty();
									}}
									class="h-7 w-32 font-mono text-xs"
								/>
								{#if server.id === defaultServerId}
									<span
										class="flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800 dark:bg-green-900/30 dark:text-green-400"
									>
										<Star class="h-3 w-3" /> default
									</span>
								{:else}
									<button
										class="text-muted-foreground hover:text-foreground text-xs underline-offset-2 hover:underline"
										onclick={() => {
											defaultServerId = server.id;
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
								disabled={server.id === defaultServerId}
								title={server.id === defaultServerId
									? 'Set another server as default before deleting'
									: undefined}
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
								{#if server.hasApiKey && server.apiKey !== '__clear__' && !server.apiKey}
									<div class="flex gap-1.5">
										<Input
											type="password"
											placeholder="Key set — enter new value to replace"
											class="font-mono text-xs"
											oninput={(e) => {
												server.apiKey = (e.target as HTMLInputElement).value;
												markDirty();
											}}
										/>
										<button
											class="text-muted-foreground hover:text-destructive shrink-0 text-xs underline-offset-2 hover:underline"
											onclick={() => {
												server.apiKey = '__clear__';
												markDirty();
											}}
										>
											Clear
										</button>
									</div>
								{:else}
									<div class="flex gap-1.5">
										<Input
											type="password"
											placeholder={server.apiKey === '__clear__'
												? 'Key will be cleared on save'
												: ''}
											value={server.apiKey === '__clear__' ? '' : server.apiKey}
											disabled={server.apiKey === '__clear__'}
											oninput={(e) => {
												server.apiKey = (e.target as HTMLInputElement).value;
												markDirty();
											}}
											class="font-mono text-xs"
										/>
										{#if server.apiKey === '__clear__'}
											<button
												class="text-muted-foreground hover:text-foreground shrink-0 text-xs underline-offset-2 hover:underline"
												onclick={() => {
													server.apiKey = '';
												}}
											>
												Undo
											</button>
										{/if}
									</div>
								{/if}
							</div>
							<div class="space-y-1">
								<p class="text-muted-foreground text-xs">Timeout (ms)</p>
								<Input
									type="number"
									placeholder="30000"
									bind:value={server.timeoutMs}
									oninput={markDirty}
									onblur={() => {
										server.timeoutMs = Math.min(
											300000,
											Math.max(1000, Number(server.timeoutMs) || 30000)
										);
									}}
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
									onblur={() => {
										server.retryCount = Math.min(5, Math.max(0, Number(server.retryCount) || 0));
									}}
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
