<script lang="ts">
	import { Button, Card, Input, toast } from 'selva-shared';
	import { Circle, Server, Plus, Trash2, Star, ChevronDown, ChevronUp } from '@lucide/svelte';
	import type { ComputeServerConfig } from '@selva/platform/computeServer';
	import { useServerHealth } from '$lib/composables/useServerHealth.svelte';
	import { invalidateAll } from '$app/navigation';
	import { onMount } from 'svelte';

	const API_KEY_CLEAR = '__clear__';

	interface ServerEntry extends Omit<ComputeServerConfig, 'apiKey'> {
		apiKey: string;
		hasApiKey: boolean;
		storedKeyIndex: number;
	}

	interface PageData {
		servers: (Omit<ComputeServerConfig, 'apiKey'> & { hasApiKey: boolean })[];
		defaultServerId: string;
	}
	interface Props {
		data: PageData;
	}
	let { data }: Props = $props();

	$effect(() => {
		console.log('Loaded compute config:', data);
	});

	const statusConfig = {
		ok: { label: 'Online', color: 'text-green-600 dark:text-green-400' },
		warning: { label: 'Warning', color: 'text-yellow-600 dark:text-yellow-400' },
		error: { label: 'Offline', color: 'text-red-600 dark:text-red-400' },
		checking: { label: 'Checking\u2026', color: 'text-blue-600 dark:text-blue-400' }
	};

	let servers = $state<ServerEntry[]>([]);
	let defaultServerId = $state('');
	let saving = $state(false);
	let dirty = $state(false);
	let expandedPlugins = $state<Record<string, boolean>>({});

	// Per-server health — keyed by server id
	let healthMap = $state<Record<string, ReturnType<typeof useServerHealth>>>({});

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

	onMount(() => {
		for (const s of data.servers) {
			const id = s.id;
			const h = useServerHealth(() => id);
			healthMap[id] = h;
			h.start();
		}
		return () => {
			for (const h of Object.values(healthMap)) h.stop();
		};
	});

	function addServer() {
		const id = crypto.randomUUID();
		if (servers.length === 0) defaultServerId = id;
		servers = [
			...servers,
			{
				id,
				label: 'new-server',
				serverUrl: 'http://localhost:5000',
				apiKey: '',
				hasApiKey: false,
				storedKeyIndex: -1,
				timeoutMs: 30000,
				retryCount: 0
			}
		];
		dirty = true;
	}

	function removeServer(index: number) {
		const removed = servers[index];
		healthMap[removed.id]?.stop();
		const { [removed.id]: _, ...rest } = healthMap;
		healthMap = rest;
		servers = servers.filter((_, i) => i !== index);
		if (defaultServerId === removed.id && servers.length > 0) {
			defaultServerId = servers[0].id;
		}
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
						...(apiKey === API_KEY_CLEAR ? { apiKey: null } : apiKey ? { apiKey } : {}),
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
				// Re-check health for all servers after save
				for (const h of Object.values(healthMap)) h.stop();
				healthMap = {};
				for (const s of servers) {
					const id = s.id;
					const h = useServerHealth(() => id);
					healthMap[id] = h;
					h.start();
				}
			} else {
				const err = await res.json().catch(() => ({ error: 'Unknown error' }));
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

{#snippet serverCard(server: ServerEntry, i: number)}
	{@const health = healthMap[server.id]?.state}
	{@const sc = statusConfig[health?.state ?? 'checking']}
	{@const pluginEntries = Object.entries(health?.plugins ?? {})}
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
						dirty = true;
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
			<div class="flex items-center gap-3">
				<div class="flex items-center gap-1.5">
					<Circle class="h-2.5 w-2.5 shrink-0 fill-current {sc.color}" />
					<span class="text-xs font-medium {sc.color}">{sc.label}</span>
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
		</div>

		{#if health?.reachable}
			<div class="grid grid-cols-3 gap-2">
				<div class="bg-muted/40 rounded-md px-3 py-2">
					<p class="text-muted-foreground text-xs">Rhino</p>
					<p class="mt-0.5 text-xs font-medium">{health.rhinoVersion ?? '-'}</p>
				</div>
				<div class="bg-muted/40 rounded-md px-3 py-2">
					<p class="text-muted-foreground text-xs">Compute</p>
					<p class="mt-0.5 text-xs font-medium">{health.computeVersion ?? '-'}</p>
				</div>
				<div class="bg-muted/40 rounded-md px-3 py-2">
					<p class="text-muted-foreground text-xs">Selva Plugin</p>
					<p class="mt-0.5 text-xs font-medium">
						{#if health.selvaInstalled}
							{health.selvaVersion}
						{:else}
							<span class="text-red-600 dark:text-red-400">Not installed</span>
						{/if}
					</p>
				</div>
			</div>
		{/if}

		<div class="grid gap-2 sm:grid-cols-2">
			<div class="space-y-1">
				<p class="text-muted-foreground text-xs">Server URL</p>
				<Input
					placeholder="http://localhost:5000"
					bind:value={server.serverUrl}
					oninput={() => (dirty = true)}
					class="font-mono text-xs"
				/>
			</div>
			<div class="space-y-1">
				<p class="text-muted-foreground text-xs">API Key (optional)</p>
				<div class="flex gap-1.5">
					<Input
						type="password"
						placeholder={server.hasApiKey && server.apiKey !== API_KEY_CLEAR && !server.apiKey
							? 'Key set - enter new value to replace'
							: server.apiKey === API_KEY_CLEAR
								? 'Key will be cleared on save'
								: ''}
						value={server.apiKey === API_KEY_CLEAR ? '' : server.apiKey}
						disabled={server.apiKey === API_KEY_CLEAR}
						oninput={(e) => {
							server.apiKey = (e.target as HTMLInputElement).value;
							dirty = true;
						}}
						class="font-mono text-xs"
					/>
					{#if server.hasApiKey && server.apiKey !== API_KEY_CLEAR && !server.apiKey}
						<button
							class="text-muted-foreground hover:text-destructive shrink-0 text-xs underline-offset-2 hover:underline"
							onclick={() => {
								server.apiKey = API_KEY_CLEAR;
								dirty = true;
							}}
						>
							Clear
						</button>
					{:else if server.apiKey === API_KEY_CLEAR}
						<button
							class="text-muted-foreground hover:text-foreground shrink-0 text-xs underline-offset-2 hover:underline"
							onclick={() => (server.apiKey = '')}
						>
							Undo
						</button>
					{/if}
				</div>
			</div>
			<div class="space-y-1">
				<p class="text-muted-foreground text-xs">Timeout (ms)</p>
				<Input
					type="number"
					placeholder="30000"
					bind:value={server.timeoutMs}
					oninput={() => (dirty = true)}
					onblur={() => {
						server.timeoutMs = Math.min(300000, Math.max(1000, Number(server.timeoutMs) || 30000));
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
					oninput={() => (dirty = true)}
					onblur={() => {
						server.retryCount = Math.min(5, Math.max(0, Number(server.retryCount) || 0));
					}}
					class="text-xs"
				/>
			</div>
		</div>

		{#if health?.reachable && pluginEntries.length > 0}
			<div>
				<button
					class="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs"
					onclick={() => (expandedPlugins[server.id] = !expandedPlugins[server.id])}
				>
					{#if expandedPlugins[server.id]}
						<ChevronUp class="h-3 w-3" />
					{:else}
						<ChevronDown class="h-3 w-3" />
					{/if}
					{pluginEntries.length} Grasshopper plugin{pluginEntries.length === 1 ? '' : 's'}
				</button>
				{#if expandedPlugins[server.id]}
					<div class="mt-2 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
						{#each pluginEntries as [name, version] (name)}
							<div class="bg-muted/40 flex items-center justify-between rounded-md px-3 py-1.5">
								<span class="text-xs font-medium">{name}</span>
								<span class="text-muted-foreground text-xs">{version}</span>
							</div>
						{/each}
					</div>
				{/if}
			</div>
		{/if}
	</div>
{/snippet}

<div class="w-full space-y-6 px-6 py-6">
	<Card.Root>
		<Card.Header>
			<div class="flex items-center justify-between">
				<div>
					<Card.Title>Servers</Card.Title>
					<Card.Description>Changes take effect immediately - no restart required.</Card.Description
					>
				</div>
				<div class="flex gap-2">
					<Button variant="outline" size="sm" onclick={addServer}>
						<Plus class="mr-1.5 h-3.5 w-3.5" />
						Add Server
					</Button>
					<Button size="sm" onclick={save} disabled={saving || !dirty}>
						{saving ? 'Saving\u2026' : 'Save'}
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
				{#each servers as server, i (server.id)}
					{@render serverCard(server, i)}
				{/each}
			{/if}
		</Card.Content>
	</Card.Root>
</div>
