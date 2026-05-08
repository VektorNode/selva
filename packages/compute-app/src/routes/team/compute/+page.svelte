<script lang="ts">
	import { Button, Card, EmptyState, Input, toast, SectionHeader, Badge } from '@selvajs/ui';
	import { Server, Plus, Trash2, Star } from '@lucide/svelte';
	import { invalidateAll } from '$app/navigation';
	import type { CatalogEntry, OrgServerListing } from './+page.server';

	const API_KEY_CLEAR = '__clear__';

	interface ServerEntry {
		id: string;
		label: string;
		serverUrl: string;
		timeoutMs: number;
		retryCount: number;
		apiKey: string;
		hasApiKey: boolean;
	}

	interface PageData {
		ownServers: OrgServerListing[];
		catalog: CatalogEntry[];
		orgDefaultServerId: string | null;
		globalDefaultServerId: string | null;
		overrideEnabled: boolean;
	}

	let { data }: { data: PageData } = $props();

	let servers = $state<ServerEntry[]>([]);
	let orgDefaultServerId = $state<string>('');
	let saving = $state(false);
	let dirty = $state(false);

	$effect(() => {
		if (!dirty) {
			servers = data.ownServers.map((s) => ({
				id: s.id,
				label: s.label,
				serverUrl: s.serverUrl,
				timeoutMs: s.timeoutMs ?? 30000,
				retryCount: s.retryCount ?? 0,
				apiKey: '',
				hasApiKey: s.hasApiKey
			}));
			orgDefaultServerId = data.orgDefaultServerId ?? '';
		}
	});

	// What the dropdown shows when "Use global default" is selected.
	const globalDefaultLabel = $derived(
		data.catalog.find((c) => c.id === data.globalDefaultServerId)?.label ?? '(none configured)'
	);

	function addServer() {
		if (!data.overrideEnabled) return;
		servers = [
			...servers,
			{
				id: crypto.randomUUID(),
				label: 'org-server',
				serverUrl: 'http://localhost:5000',
				timeoutMs: 30000,
				retryCount: 0,
				apiKey: '',
				hasApiKey: false
			}
		];
		dirty = true;
	}

	function removeServer(index: number) {
		const removed = servers[index];
		servers = servers.filter((_, i) => i !== index);
		// If the removed server was the org default, fall back to the global.
		if (orgDefaultServerId === removed.id) orgDefaultServerId = '';
		dirty = true;
	}

	async function save() {
		saving = true;
		try {
			const payload = {
				defaultServerId: orgDefaultServerId === '' ? null : orgDefaultServerId,
				servers: servers.map(({ apiKey, hasApiKey: _, retryCount, timeoutMs, ...s }) => ({
					...s,
					timeoutMs: Math.min(300000, Math.max(1000, Number(timeoutMs) || 30000)),
					...(apiKey === API_KEY_CLEAR ? { apiKey: null } : apiKey ? { apiKey } : {}),
					...(Number(retryCount)
						? { retryCount: Math.min(5, Math.max(0, Number(retryCount))) }
						: {})
				}))
			};

			const res = await fetch('/api/org/compute', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload)
			});

			if (res.ok) {
				toast.success('Compute settings saved');
				await invalidateAll();
				dirty = false;
			} else {
				const err = await res.json().catch(() => ({ error: 'Unknown error' }));
				toast.error(err.message || err.error || `Failed to save (${res.status})`);
			}
		} catch {
			toast.error('Failed to save compute settings');
		} finally {
			saving = false;
		}
	}
</script>

<svelte:head>
	<title>Team · Compute</title>
</svelte:head>

{#snippet serverCard(server: ServerEntry, i: number)}
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
				{#if server.id === orgDefaultServerId}
					<span
						class="flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800 dark:bg-green-900/30 dark:text-green-400"
					>
						<Star class="h-3 w-3" /> org default
					</span>
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

		{#if server.id !== orgDefaultServerId}
			<button
				type="button"
				class="text-muted-foreground hover:text-foreground text-xs underline-offset-2 hover:underline"
				onclick={() => {
					orgDefaultServerId = server.id;
					dirty = true;
				}}
			>
				Make org default
			</button>
		{/if}
	</div>
{/snippet}

<div class="space-y-6">
	<SectionHeader
		eyebrow="Team"
		title="Compute"
		description="Compute servers available to this organization. Platform servers are managed by Selva staff and shown read-only; you can add your own org-private servers and pick which server is your org's default."
	>
		{#snippet actions()}
			{#if data.overrideEnabled}
				<Button variant="outline" size="sm" onclick={addServer}>
					<Plus class="mr-1.5 h-3.5 w-3.5" />
					Add server
				</Button>
			{/if}
			<Button size="sm" onclick={save} disabled={saving || !dirty}>
				{saving ? 'Saving…' : 'Save'}
			</Button>
		{/snippet}
	</SectionHeader>

	<!-- Default selector -->
	<Card.Root>
		<Card.Header>
			<Card.Title class="text-sm font-medium">Org default</Card.Title>
			<Card.Description>
				The server new definitions in this org use unless they're pinned to a specific one. Picks
				from any server visible to your org. Leave on "Use global default" to inherit Selva's
				platform-wide pick.
			</Card.Description>
		</Card.Header>
		<Card.Content class="space-y-2">
			<select
				value={orgDefaultServerId}
				onchange={(e) => {
					orgDefaultServerId = (e.currentTarget as HTMLSelectElement).value;
					dirty = true;
				}}
				class="border-input bg-background h-10 w-full max-w-md rounded-md border px-3 text-sm"
			>
				<option value="">Use global default — {globalDefaultLabel}</option>
				{#each data.catalog as entry (entry.id)}
					<option value={entry.id}>
						{entry.label}
						{entry.source === 'org' ? '(your org)' : entry.isGlobalDefault ? '(global default)' : '(platform)'}
					</option>
				{/each}
			</select>
			{#if orgDefaultServerId === '' && data.globalDefaultServerId === null}
				<p class="text-warning text-xs">
					No global default is configured. Solves will fail until either a global default is set or
					you pick an org default.
				</p>
			{/if}
		</Card.Content>
	</Card.Root>

	<!-- Visible catalog (read-only) -->
	<Card.Root>
		<Card.Header>
			<Card.Title class="text-sm font-medium">Available servers</Card.Title>
			<Card.Description>
				Every server visible to this organization. Platform rows are managed by Selva staff.
			</Card.Description>
		</Card.Header>
		<Card.Content>
			{#if data.catalog.length === 0}
				<EmptyState
					size="sm"
					icon={Server}
					title="No servers visible"
					description="No platform server is shared with this org and no global default is configured. Ask a Selva admin to share a server or set a global default."
				/>
			{:else}
				<ul class="divide-border divide-y rounded-md border">
					{#each data.catalog as entry (entry.id)}
						<li class="flex items-center gap-3 px-3 py-2 text-sm">
							<Server class="text-muted-foreground h-3.5 w-3.5 shrink-0" />
							<span class="font-medium">{entry.label}</span>
							<code class="text-muted-foreground truncate font-mono text-xs">
								{entry.serverUrl}
							</code>
							<div class="ml-auto flex items-center gap-1.5">
								{#if entry.source === 'org'}
									<Badge variant="outline" class="text-[10px]">your org</Badge>
								{:else}
									<Badge variant="outline" class="text-[10px]">platform</Badge>
								{/if}
								{#if entry.isGlobalDefault}
									<Badge variant="outline" class="text-[10px]">global default</Badge>
								{/if}
								{#if entry.id === data.orgDefaultServerId}
									<Badge variant="outline" class="text-[10px]">org default</Badge>
								{/if}
							</div>
						</li>
					{/each}
				</ul>
			{/if}
		</Card.Content>
	</Card.Root>

	<!-- Org-private servers (editable) -->
	<Card.Root>
		<Card.Header>
			<Card.Title class="text-sm font-medium">Your org's servers</Card.Title>
			<Card.Description>
				{#if data.overrideEnabled}
					Compute servers managed by your org. Visible only to members of this organization.
				{:else}
					Org-private servers are disabled on this Selva instance. Ask the platform admin to flip
					<code class="text-xs">ALLOW_ORG_COMPUTE_OVERRIDE</code> if you need to bring your own
					compute.
				{/if}
			</Card.Description>
		</Card.Header>
		<Card.Content class="space-y-3">
			{#if !data.overrideEnabled && servers.length === 0}
				<EmptyState
					size="sm"
					icon={Server}
					title="Org-private servers disabled"
					description="This Selva instance does not allow per-org compute servers."
				/>
			{:else if servers.length === 0}
				<EmptyState size="sm" icon={Server} title="No org-private servers yet">
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
			{/if}
		</Card.Content>
	</Card.Root>
</div>
