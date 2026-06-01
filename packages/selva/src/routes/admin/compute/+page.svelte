<script lang="ts">
	import { Button, Card, EmptyState, Input, toast, SectionHeader, randomId } from '@selvajs/ui';
	import {
		Circle,
		Server,
		Plus,
		Trash2,
		Star,
		ChevronDown,
		ChevronUp,
		RefreshCw
	} from '@lucide/svelte';
	import type { PlatformComputeServer } from '@selvajs/platform/computeServer';
	import type { TenancyMode } from '@selvajs/platform';
	import { useServerHealth } from '$lib/composables/useServerHealth.svelte';
	import { invalidateAll } from '$app/navigation';
	import { SvelteSet } from 'svelte/reactivity';
	import { untrack, onDestroy } from 'svelte';

	const API_KEY_CLEAR = '__clear__';

	interface ServerEntry extends Omit<PlatformComputeServer, 'apiKey' | 'scope'> {
		apiKey: string;
		hasApiKey: boolean;
	}

	interface OrgRow {
		id: string;
		name: string;
		slug: string;
	}

	interface PageData {
		servers: (Omit<PlatformComputeServer, 'apiKey'> & { hasApiKey: boolean })[];
		defaultServerId: string;
		orgs: OrgRow[];
		tenancy: TenancyMode;
	}
	interface Props {
		data: PageData;
	}
	let { data }: Props = $props();

	const statusConfig = {
		idle: { label: 'Not checked', color: 'text-muted-foreground' },
		ok: { label: 'Online', color: 'text-green-600 dark:text-green-400' },
		warning: { label: 'Warning', color: 'text-yellow-600 dark:text-yellow-400' },
		error: { label: 'Offline', color: 'text-red-600 dark:text-red-400' },
		checking: { label: 'Checking…', color: 'text-blue-600 dark:text-blue-400' }
	};

	let servers = $state<ServerEntry[]>([]);
	let defaultServerId = $state('');
	let saving = $state(false);
	const dirtyIds = new SvelteSet<string>();
	let expandedPlugins = $state<Record<string, boolean>>({});
	let expandedSharing = $state<Record<string, boolean>>({});

	function markDirty(id: string) {
		dirtyIds.add(id);
	}

	function discardChanges(id: string) {
		dirtyIds.delete(id);
		// $effect resyncs only when dirtyIds is fully empty, so manually reset this server.
		const original = data.servers.find((s) => s.id === id);
		const idx = servers.findIndex((s) => s.id === id);
		if (idx < 0) return;
		if (!original) {
			// Newly-added server that was never saved — drop it.
			healthMap[id]?.stop();
			const { [id]: _, ...rest } = healthMap;
			healthMap = rest;
			servers = servers.filter((s) => s.id !== id);
			return;
		}
		servers[idx] = {
			id: original.id,
			label: original.label,
			serverUrl: original.serverUrl,
			sharedWith: original.sharedWith === 'all' ? 'all' : [...original.sharedWith],
			timeoutMs: original.timeoutMs ?? 30000,
			retryCount: original.retryCount ?? 0,
			apiKey: '',
			hasApiKey: original.hasApiKey
		};
		defaultServerId = data.defaultServerId;
	}

	// Per-server health — keyed by server id. Entries are created lazily and never
	// probe on their own; a server is only contacted when the operator clicks Check.
	let healthMap = $state<Record<string, ReturnType<typeof useServerHealth>>>({});

	function ensureHealth(id: string) {
		if (!healthMap[id]) {
			healthMap[id] = useServerHealth(() => id);
		}
		return healthMap[id];
	}

	$effect(() => {
		if (dirtyIds.size === 0) {
			servers = data.servers.map((s) => ({
				id: s.id,
				label: s.label,
				serverUrl: s.serverUrl,
				sharedWith: s.sharedWith === 'all' ? 'all' : [...s.sharedWith],
				timeoutMs: s.timeoutMs ?? 30000,
				retryCount: s.retryCount ?? 0,
				apiKey: '',
				hasApiKey: s.hasApiKey
			}));
			defaultServerId = data.defaultServerId;
		}
	});

	$effect(() => {
		// Pre-create an (idle) health entry per known server so each card has a
		// Check button to drive. No probe runs here — servers stay untouched until
		// the operator explicitly checks them. `ensureHealth` writes healthMap, so
		// it must be untracked — otherwise this effect re-runs and (via its old
		// cleanup) tore down the entries it just made, leaving Check a no-op.
		const ids = data.servers.map((s) => s.id);
		untrack(() => {
			for (const id of ids) ensureHealth(id);
		});
	});

	// Teardown only on real unmount — never coupled to data/healthMap changes.
	onDestroy(() => {
		for (const h of Object.values(healthMap)) h.stop();
	});

	function addServer() {
		const id = randomId();
		if (servers.length === 0) defaultServerId = id;
		servers = [
			...servers,
			{
				id,
				label: 'new-server',
				serverUrl: 'http://localhost:5000',
				sharedWith: 'all',
				apiKey: '',
				hasApiKey: false,
				timeoutMs: 30000,
				retryCount: 0
			}
		];
		ensureHealth(id);
		markDirty(id);
	}

	function removeServer(index: number) {
		const removed = servers[index];
		healthMap[removed.id]?.stop();
		const { [removed.id]: _, ...rest } = healthMap;
		healthMap = rest;
		servers = servers.filter((_, i) => i !== index);
		// Mark all remaining servers dirty so any visible Save button can flush the removal.
		if (defaultServerId === removed.id && servers[0]) {
			defaultServerId = servers[0].id;
		}
		for (const s of servers) markDirty(s.id);
	}

	function setSharedWithAll(server: ServerEntry, all: boolean) {
		server.sharedWith = all ? 'all' : [];
		markDirty(server.id);
	}

	function toggleOrg(server: ServerEntry, orgId: string) {
		if (server.sharedWith === 'all') return; // ignored when in 'all' mode
		server.sharedWith = server.sharedWith.includes(orgId)
			? server.sharedWith.filter((id) => id !== orgId)
			: [...server.sharedWith, orgId];
		markDirty(server.id);
	}

	async function save() {
		saving = true;
		try {
			const payload = {
				defaultServerId,
				servers: servers.map(({ apiKey, hasApiKey: _, retryCount, timeoutMs, ...s }) => ({
					...s,
					timeoutMs: Math.min(300000, Math.max(1000, Number(timeoutMs) || 30000)),
					...(apiKey === API_KEY_CLEAR ? { apiKey: null } : apiKey ? { apiKey } : {}),
					...(Number(retryCount)
						? { retryCount: Math.min(5, Math.max(0, Number(retryCount))) }
						: {})
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
				dirtyIds.clear();
				// Reset health to idle after save (URL/key may have changed) without
				// probing — the operator re-checks manually to avoid waking servers.
				for (const h of Object.values(healthMap)) h.stop();
				healthMap = {};
				for (const s of servers) ensureHealth(s.id);
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
	<title>Admin · Compute</title>
</svelte:head>

{#snippet sharingControl(server: ServerEntry)}
	{@const isAll = server.sharedWith === 'all'}
	{@const orgIds = isAll ? new Set<string>() : new Set(server.sharedWith)}
	{@const isDefault = server.id === defaultServerId}
	<div class="space-y-2">
		<div class="flex items-center gap-3">
			<p class="text-muted-foreground text-xs">Available to</p>
			<div class="bg-muted inline-flex rounded-md p-0.5">
				<button
					class="rounded px-2 py-0.5 text-xs {isAll
						? 'bg-background shadow-sm'
						: 'text-muted-foreground hover:text-foreground'}"
					onclick={() => setSharedWithAll(server, true)}
				>
					All orgs
				</button>
				<button
					class="rounded px-2 py-0.5 text-xs {!isAll
						? 'bg-background shadow-sm'
						: 'text-muted-foreground hover:text-foreground'}"
					onclick={() => setSharedWithAll(server, false)}
				>
					Specific orgs
				</button>
			</div>
			{#if !isAll && data.orgs.length > 0}
				<button
					class="text-muted-foreground hover:text-foreground ml-auto flex items-center gap-1 text-xs"
					onclick={() => (expandedSharing[server.id] = !expandedSharing[server.id])}
				>
					{orgIds.size}/{data.orgs.length} selected
					{#if expandedSharing[server.id]}
						<ChevronUp class="h-3 w-3" />
					{:else}
						<ChevronDown class="h-3 w-3" />
					{/if}
				</button>
			{/if}
		</div>
		{#if !isAll && expandedSharing[server.id]}
			{#if data.orgs.length === 0}
				<p class="text-muted-foreground text-xs">No organizations exist yet.</p>
			{:else}
				<div class="grid gap-1 sm:grid-cols-2">
					{#each data.orgs as org (org.id)}
						<label class="hover:bg-muted/40 flex items-center gap-2 rounded px-2 py-1 text-xs">
							<input
								type="checkbox"
								checked={orgIds.has(org.id)}
								onchange={() => toggleOrg(server, org.id)}
								class="h-3.5 w-3.5"
							/>
							<span class="truncate">{org.name}</span>
							<span class="text-muted-foreground ml-auto font-mono text-[10px]">{org.slug}</span>
						</label>
					{/each}
				</div>
			{/if}
		{/if}
		{#if !isAll && isDefault}
			<p class="text-muted-foreground text-xs">
				This server is the global default — it stays visible to every org regardless of the
				allowlist.
			</p>
		{:else if !isAll && orgIds.size === 0}
			<p class="text-muted-foreground text-xs">
				No orgs selected — this server is dormant (admin-only).
			</p>
		{/if}
	</div>
{/snippet}

{#snippet serverCard(server: ServerEntry, i: number)}
	{@const health = healthMap[server.id]?.state}
	{@const sc = statusConfig[health?.state ?? 'idle']}
	{@const isChecking = health?.state === 'checking'}
	{@const pluginEntries = Object.entries(health?.plugins ?? {})}
	{@const isDirty = dirtyIds.has(server.id)}
	<div
		class="space-y-3 rounded-lg border p-4 transition-colors {isDirty
			? 'border-amber-400/60 bg-amber-50/30 dark:border-amber-500/40 dark:bg-amber-950/10'
			: 'bg-muted/30'}"
	>
		<div class="flex items-center justify-between">
			<div class="flex items-center gap-2">
				<Input
					placeholder="label"
					value={server.label}
					oninput={(e) => {
						const input = e.target as HTMLInputElement;
						server.label = input.value.toLowerCase().replace(/[^a-z0-9_-]/g, '');
						input.value = server.label;
						markDirty(server.id);
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
							markDirty(server.id);
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
					variant="outline"
					size="sm"
					onclick={() => healthMap[server.id]?.check()}
					disabled={isChecking}
					class="h-7"
					title="Probe this server's availability (retries for up to 1 min)"
				>
					<RefreshCw class="mr-1.5 h-3.5 w-3.5 {isChecking ? 'animate-spin' : ''}" />
					{isChecking ? 'Checking…' : 'Check'}
				</Button>
				{#if isDirty}
					<Button
						variant="ghost"
						size="sm"
						onclick={() => discardChanges(server.id)}
						disabled={saving}
						class="text-muted-foreground hover:text-foreground h-7"
					>
						Discard
					</Button>
					<Button size="sm" onclick={save} disabled={saving} class="h-7">
						{saving ? 'Saving…' : 'Save changes'}
					</Button>
				{/if}
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
					oninput={() => markDirty(server.id)}
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
							markDirty(server.id);
						}}
						class="font-mono text-xs"
					/>
					{#if server.hasApiKey && server.apiKey !== API_KEY_CLEAR && !server.apiKey}
						<button
							class="text-muted-foreground hover:text-destructive shrink-0 text-xs underline-offset-2 hover:underline"
							onclick={() => {
								server.apiKey = API_KEY_CLEAR;
								markDirty(server.id);
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
					oninput={() => markDirty(server.id)}
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
					oninput={() => markDirty(server.id)}
					onblur={() => {
						server.retryCount = Math.min(5, Math.max(0, Number(server.retryCount) || 0));
					}}
					class="text-xs"
				/>
			</div>
		</div>

		{#if data.tenancy !== 'single'}
			{@render sharingControl(server)}
		{/if}

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

<div class="space-y-6">
	<SectionHeader
		eyebrow="Admin"
		title="Compute"
		description="Manage compute servers. Share servers with specific orgs to expose them in pickers. When ALLOW_ORG_COMPUTE_OVERRIDE is on, org owners can configure their own servers."
	/>

	<Card.Root>
		<Card.Content class="space-y-3 pt-6">
			{#if servers.length === 0}
				<EmptyState icon={Server} title="No servers configured">
					{#snippet actions()}
						<Button variant="outline" size="sm" onclick={addServer}>
							<Plus class="mr-1.5 h-3.5 w-3.5" />
							Add server
						</Button>
					{/snippet}
				</EmptyState>
			{:else}
				{#each servers as server, i (server.id)}
					{@render serverCard(server, i)}
				{/each}
				<button
					type="button"
					onclick={addServer}
					class="border-muted-foreground/30 text-muted-foreground hover:border-foreground/50 hover:text-foreground hover:bg-muted/30 flex w-full items-center justify-center gap-2 rounded-lg border border-dashed py-4 text-sm font-medium transition-colors"
				>
					<Plus class="h-4 w-4" />
					Add another server
				</button>
			{/if}
		</Card.Content>
	</Card.Root>
</div>
