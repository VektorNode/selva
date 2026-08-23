<script lang="ts">
	import {
		Button,
		Card,
		EmptyState,
		Input,
		toast,
		SectionHeader,
		randomId,
		ConfirmDialog
	} from '@selvajs/ui';
	import {
		Circle,
		Server,
		Plus,
		Trash2,
		Star,
		ChevronDown,
		ChevronUp,
		RefreshCw,
		Eraser,
		Power
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

	interface CacheCounters {
		hits: number;
		misses: number;
		evictions: number;
		entries: number;
		bytes: number;
		budgetBytes: number;
	}

	interface PageData {
		servers: (Omit<PlatformComputeServer, 'apiKey'> & { hasApiKey: boolean })[];
		defaultServerId: string;
		orgs: OrgRow[];
		tenancy: TenancyMode;
		caches: {
			solve: CacheCounters & { warmClients: number; budgetTotalBytes: number };
			definition: CacheCounters;
		};
	}
	interface Props {
		data: PageData;
	}
	let { data }: Props = $props();

	function formatCacheBytes(bytes: number): string {
		if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
		if (bytes >= 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MB`;
		if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
		return `${bytes} B`;
	}

	/**
	 * Hit rate as a percentage, or null before any solve has consulted the cache.
	 * Reported as null rather than 0% because "no data yet" and "nothing is
	 * hitting" are different answers to the question an operator is asking.
	 */
	function hitRate(c: { hits: number; misses: number }): number | null {
		const total = c.hits + c.misses;
		return total === 0 ? null : Math.round((c.hits / total) * 100);
	}

	// Humanize an idle span (seconds since the last child request) into a compact
	// "just now / 5m / 1h 3m" label. null → '-' (unreachable or not reported).
	function formatIdle(seconds: number | null): string {
		if (seconds === null) return '-';
		if (seconds < 5) return 'just now';
		if (seconds < 60) return `${Math.round(seconds)}s`;
		const m = Math.floor(seconds / 60);
		if (m < 60) return `${m}m`;
		const h = Math.floor(m / 60);
		return `${h}h ${m % 60}m`;
	}

	const statusConfig = {
		idle: { label: 'Not checked', color: 'text-muted-foreground' },
		ok: { label: 'Online', color: 'text-green-600 dark:text-green-400' },
		warning: { label: 'Warning', color: 'text-yellow-600 dark:text-yellow-400' },
		error: { label: 'Offline', color: 'text-red-600 dark:text-red-400' },
		checking: { label: 'Checking…', color: 'text-blue-600 dark:text-blue-400' },
		// Reachable but plugins still loading — a booting server, not a fault.
		loading: { label: 'Loading plugins…', color: 'text-blue-600 dark:text-blue-400' }
	};

	let servers = $state<ServerEntry[]>([]);
	let defaultServerId = $state('');
	let saving = $state(false);
	const dirtyIds = new SvelteSet<string>();
	// Servers the operator deleted. They stay in `servers` (struck through, with
	// Undo) until a save flushes them, so deletion follows the same stage-then-save
	// model as every other edit on this page.
	const removedIds = new SvelteSet<string>();
	let expandedPlugins = $state<Record<string, boolean>>({});
	let expandedSharing = $state<Record<string, boolean>>({});

	function toEntry(s: PageData['servers'][number]): ServerEntry {
		return {
			id: s.id,
			label: s.label,
			serverUrl: s.serverUrl,
			sharedWith: s.sharedWith === 'all' ? 'all' : [...s.sharedWith],
			timeoutMs: s.timeoutMs ?? 30000,
			retryCount: s.retryCount ?? 0,
			apiKey: '',
			hasApiKey: s.hasApiKey
		};
	}

	function markDirty(id: string) {
		dirtyIds.add(id);
	}

	// The whole page is one unit of work: the API replaces the entire platform
	// server list in a single PUT, so a per-card save would flush every other
	// card's edits along with it.
	const pendingCount = $derived(dirtyIds.size + removedIds.size);
	const defaultChanged = $derived(
		defaultServerId !== data.defaultServerId && servers.some((s) => !removedIds.has(s.id))
	);
	const hasChanges = $derived(pendingCount > 0 || defaultChanged);

	function forgetHealth(id: string) {
		healthMap[id]?.stop();
		const { [id]: _, ...rest } = healthMap;
		healthMap = rest;
	}

	function discardChanges(id: string) {
		dirtyIds.delete(id);
		removedIds.delete(id);
		const original = data.servers.find((s) => s.id === id);
		if (!original) {
			// Newly-added server that was never saved — drop it.
			forgetHealth(id);
			servers = servers.filter((s) => s.id !== id);
			return;
		}
		const idx = servers.findIndex((s) => s.id === id);
		if (idx >= 0) servers[idx] = toEntry(original);
	}

	function discardAll() {
		for (const id of [...dirtyIds, ...removedIds]) {
			if (!data.servers.some((s) => s.id === id)) forgetHealth(id);
		}
		dirtyIds.clear();
		removedIds.clear();
		servers = data.servers.map(toEntry);
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
		if (dirtyIds.size === 0 && removedIds.size === 0) {
			servers = data.servers.map(toEntry);
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

	function removeServer(server: ServerEntry) {
		if (!data.servers.some((s) => s.id === server.id)) {
			// Never saved — nothing to stage, just drop it.
			dirtyIds.delete(server.id);
			forgetHealth(server.id);
			servers = servers.filter((s) => s.id !== server.id);
		} else {
			removedIds.add(server.id);
			dirtyIds.delete(server.id);
		}
		showRemoveConfirm = false;
	}

	function undoRemove(id: string) {
		removedIds.delete(id);
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
			const kept = servers.filter((s) => !removedIds.has(s.id));
			const payload = {
				defaultServerId: kept.some((s) => s.id === defaultServerId)
					? defaultServerId
					: (kept[0]?.id ?? ''),
				servers: kept.map(({ apiKey, hasApiKey: _, retryCount, timeoutMs, ...s }) => ({
					...s,
					timeoutMs: Math.min(300000, Math.max(1000, Number(timeoutMs) || 30000)),
					...(apiKey === API_KEY_CLEAR ? { apiKey: null } : apiKey ? { apiKey } : {}),
					...(Number(retryCount)
						? { retryCount: Math.min(5, Math.max(0, Number(retryCount))) }
						: {})
				}))
			};
			const res = await fetch('/api/admin/compute', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload)
			});
			if (res.ok) {
				toast.success(
					removedIds.size > 0
						? `Saved — ${removedIds.size} server${removedIds.size === 1 ? '' : 's'} removed`
						: 'Compute config saved'
				);
				for (const id of removedIds) forgetHealth(id);
				await invalidateAll();
				dirtyIds.clear();
				removedIds.clear();
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

	// Per-server in-flight action ('purge' | 'shutdown') so each card disables only
	// its own buttons while a fleet action runs.
	let busyAction = $state<Record<string, 'purge' | 'shutdown' | null>>({});
	let confirmingShutdown = $state<ServerEntry | null>(null);
	let confirmingPurge = $state<ServerEntry | null>(null);
	let showShutdownConfirm = $state(false);
	let showPurgeConfirm = $state(false);
	let confirmingRemove = $state<ServerEntry | null>(null);
	let showRemoveConfirm = $state(false);

	async function runAction(server: ServerEntry, action: 'purge' | 'shutdown') {
		busyAction[server.id] = action;
		try {
			const res = await fetch('/api/admin/compute/actions', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ serverId: server.id, action })
			});
			const data = await res.json().catch(() => ({}));
			if (!res.ok) {
				toast.error(data.message || data.error || `Action failed (${res.status})`);
				return;
			}
			if (action === 'purge') {
				// purgeAllChildren is best-effort across a round-robin pool — say so
				// honestly unless the server reported a single child (exact).
				const { totalPurged = 0, children = 0, confident } = data;
				toast.success(
					confident
						? `Purged ${totalPurged} cached solve${totalPurged === 1 ? '' : 's'}`
						: `Purged ~${totalPurged} across ${children} children (best-effort)`
				);
				showPurgeConfirm = false;
			} else {
				const { shutdown = 0, active = 0 } = data;
				toast.success(
					`Shut down ${shutdown} child${shutdown === 1 ? '' : 'ren'} (${active} still active)`
				);
				showShutdownConfirm = false;
				// The pool changed — re-probe so the card's status/version refresh.
				healthMap[server.id]?.check();
			}
		} catch {
			toast.error(`Failed to ${action} server`);
		} finally {
			busyAction[server.id] = null;
		}
	}
</script>

<svelte:head>
	<title>Admin · Compute</title>
</svelte:head>

{#snippet cachePanel(
	label: string,
	holds: string,
	envVar: string,
	c: CacheCounters,
	note: string | null
)}
	{@const rate = hitRate(c)}
	<div class="space-y-2 rounded-lg border p-4">
		<div class="flex items-baseline justify-between gap-3">
			<div>
				<p class="text-sm font-medium">{label}</p>
				<p class="text-muted-foreground text-xs">{holds}</p>
			</div>
			<div class="text-right">
				<p class="text-2xl font-semibold tabular-nums">
					{rate === null ? '—' : `${rate}%`}
				</p>
				<p class="text-muted-foreground text-xs">hit rate</p>
			</div>
		</div>

		<dl class="text-muted-foreground grid grid-cols-3 gap-2 text-xs">
			<div>
				<dt>Hits</dt>
				<dd class="text-foreground font-mono tabular-nums">{c.hits.toLocaleString()}</dd>
			</div>
			<div>
				<dt>Misses</dt>
				<dd class="text-foreground font-mono tabular-nums">{c.misses.toLocaleString()}</dd>
			</div>
			<div>
				<dt>Evictions</dt>
				<dd class="text-foreground font-mono tabular-nums">{c.evictions.toLocaleString()}</dd>
			</div>
		</dl>

		<div
			class="text-muted-foreground flex items-center justify-between gap-3 border-t pt-2 text-xs"
		>
			<span>
				{c.entries.toLocaleString()}
				{c.entries === 1 ? 'entry' : 'entries'} · {formatCacheBytes(c.bytes)} of {formatCacheBytes(
					c.budgetBytes
				)}
			</span>
			<code class="font-mono text-[10px]">{envVar}</code>
		</div>

		{#if note}
			<p class="text-muted-foreground text-xs">{note}</p>
		{/if}
	</div>
{/snippet}

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

{#snippet serverCard(server: ServerEntry)}
	{@const health = healthMap[server.id]?.state}
	{@const sc = statusConfig[health?.state ?? 'idle']}
	{@const isChecking = health?.state === 'checking' || health?.state === 'loading'}
	{@const pluginEntries = Object.entries(health?.plugins ?? {})}
	{@const isRemoved = removedIds.has(server.id)}
	{@const isDirty = dirtyIds.has(server.id) && !isRemoved}
	<div
		class="space-y-3 rounded-lg border p-4 transition-colors {isRemoved
			? 'border-destructive/40 bg-destructive/5'
			: isDirty
				? 'border-amber-400/60 bg-amber-50/30 dark:border-amber-500/40 dark:bg-amber-950/10'
				: 'bg-muted/30'}"
	>
		{#if isRemoved}
			<div class="flex items-center justify-between gap-3">
				<p class="text-destructive text-xs font-medium">
					<span class="line-through">{server.label}</span> will be removed when you save
				</p>
				<Button
					variant="ghost"
					size="sm"
					onclick={() => undoRemove(server.id)}
					disabled={saving}
					class="h-7"
				>
					Undo
				</Button>
			</div>
		{/if}
		<div
			class="flex items-center justify-between {isRemoved ? 'pointer-events-none opacity-50' : ''}"
		>
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
				{#if health?.reachable}
					{@const busy = busyAction[server.id]}
					<Button
						variant="outline"
						size="sm"
						onclick={() => {
							confirmingPurge = server;
							showPurgeConfirm = true;
						}}
						disabled={busy !== null && busy !== undefined}
						class="h-7"
						title="Clear cached solve results across this server's children (best-effort fleet-wide)"
					>
						<Eraser class="mr-1.5 h-3.5 w-3.5" />
						{busy === 'purge' ? 'Purging…' : 'Purge cache'}
					</Button>
					<Button
						variant="outline"
						size="sm"
						onclick={() => {
							confirmingShutdown = server;
							showShutdownConfirm = true;
						}}
						disabled={busy !== null && busy !== undefined}
						class="text-destructive hover:text-destructive h-7"
						title="Gracefully shut down all child processes (they auto-respawn on the next request)"
					>
						<Power class="mr-1.5 h-3.5 w-3.5" />
						{busy === 'shutdown' ? 'Shutting down…' : 'Shutdown children'}
					</Button>
				{/if}
				{#if isDirty}
					<Button
						variant="ghost"
						size="sm"
						onclick={() => discardChanges(server.id)}
						disabled={saving}
						class="text-muted-foreground hover:text-foreground h-7"
						title="Revert this server to its saved values"
					>
						Discard
					</Button>
				{/if}
				<Button
					variant="ghost"
					size="sm"
					onclick={() => {
						confirmingRemove = server;
						showRemoveConfirm = true;
					}}
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

		{#if health?.reachable && !isRemoved}
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
						{:else if !health.ready}
							<span class="text-muted-foreground">Loading…</span>
						{:else}
							<span class="text-red-600 dark:text-red-400">Not installed</span>
						{/if}
					</p>
				</div>
			</div>
			<div class="grid grid-cols-2 gap-2">
				<div class="bg-muted/40 rounded-md px-3 py-2">
					<p class="text-muted-foreground text-xs">Active children</p>
					<p class="mt-0.5 text-xs font-medium">{health.activeChildren ?? '-'}</p>
				</div>
				<div class="bg-muted/40 rounded-md px-3 py-2">
					<p class="text-muted-foreground text-xs">Idle for</p>
					<p class="mt-0.5 text-xs font-medium">{formatIdle(health.idleSpanSeconds)}</p>
				</div>
			</div>
		{/if}

		<div class="grid gap-2 sm:grid-cols-2 {isRemoved ? 'pointer-events-none opacity-50' : ''}">
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

		{#if data.tenancy !== 'single' && !isRemoved}
			{@render sharingControl(server)}
		{/if}

		{#if health?.reachable && pluginEntries.length > 0 && !isRemoved}
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
				{#each servers as server (server.id)}
					{@render serverCard(server)}
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

	{#if hasChanges}
		<div
			class="bg-background/95 sticky bottom-4 z-10 flex items-center justify-between gap-4 rounded-lg border border-amber-400/60 p-3 shadow-lg backdrop-blur dark:border-amber-500/40"
		>
			<p class="text-sm font-medium">
				{pendingCount === 0
					? 'Default server changed'
					: `${pendingCount} unsaved change${pendingCount === 1 ? '' : 's'}`}
				{#if removedIds.size > 0}
					<span class="text-muted-foreground font-normal">
						· {removedIds.size} pending removal
					</span>
				{/if}
			</p>
			<div class="flex items-center gap-2">
				<Button variant="ghost" size="sm" onclick={discardAll} disabled={saving}>Discard all</Button
				>
				<Button size="sm" onclick={save} disabled={saving}>
					{saving ? 'Saving…' : 'Save changes'}
				</Button>
			</div>
		</div>
	{/if}

	<SectionHeader
		title="Caching"
		description="Whether solves are actually being served from memory. Counters are for this Selva instance and reset when it restarts; behind a load balancer each instance keeps its own."
	/>

	<Card.Root>
		<Card.Content class="grid gap-3 pt-6 sm:grid-cols-2">
			{@render cachePanel(
				'Solve cache',
				'Results, so identical inputs skip Rhino entirely',
				'COMPUTE_SOLVE_CACHE_MB',
				data.caches.solve,
				`Budget is per compute server — ${data.caches.solve.warmClients} warm, so up to ${formatCacheBytes(data.caches.solve.budgetTotalBytes)} total right now.`
			)}
			{@render cachePanel(
				'Definition cache',
				'.gh bytes, so a solve skips the storage read',
				'COMPUTE_DEFINITION_CACHE_MB',
				data.caches.definition,
				null
			)}
		</Card.Content>
	</Card.Root>
</div>

<ConfirmDialog
	bind:open={showShutdownConfirm}
	title="Shutdown children?"
	description={confirmingShutdown
		? `Shut down ALL child processes on "${confirmingShutdown.label}"? In-flight solves on those children will be interrupted. The pool auto-respawns on the next request.`
		: undefined}
	confirmLabel="Shutdown"
	pendingLabel="Shutting down…"
	variant="destructive"
	onConfirm={async () => {
		if (confirmingShutdown) await runAction(confirmingShutdown, 'shutdown');
	}}
/>

<ConfirmDialog
	bind:open={showPurgeConfirm}
	title="Purge cache?"
	description={confirmingPurge
		? `Clear cached solve results across "${confirmingPurge.label}"'s children? This is best-effort across the pool.`
		: undefined}
	confirmLabel="Purge"
	pendingLabel="Purging…"
	onConfirm={async () => {
		if (confirmingPurge) await runAction(confirmingPurge, 'purge');
	}}
/>

<ConfirmDialog
	bind:open={showRemoveConfirm}
	title="Remove this server?"
	description={confirmingRemove
		? `Remove "${confirmingRemove.label}" from the compute config? It stays listed, struck through, until you save.`
		: undefined}
	confirmLabel="Remove"
	variant="destructive"
	onConfirm={() => {
		if (confirmingRemove) removeServer(confirmingRemove);
	}}
/>
