<script lang="ts">
	import { Button } from '@selvajs/ui';
	import { Search, X } from '@lucide/svelte';
	import type { ProjectRole } from '@selvajs/platform/projects';
	import type { UserListItem } from '../+page.server';
	import UserAvatar from '$lib/components/UserAvatar.svelte';

	interface Props {
		availableUsers: UserListItem[];
		adding: boolean;
		onAdd: (userId: string, role: ProjectRole) => Promise<void>;
		onCancel: () => void;
	}

	let { availableUsers, adding, onAdd, onCancel }: Props = $props();

	let query = $state('');
	let highlighted = $state(0);
	let selected = $state<UserListItem | null>(null);
	let role = $state<ProjectRole>('viewer');
	let listRef = $state<HTMLDivElement>();

	const matches = $derived.by(() => {
		const q = query.trim().toLowerCase();
		if (!q) return availableUsers.slice(0, 50);
		return availableUsers
			.filter((u) => {
				const name = (u.displayName ?? '').toLowerCase();
				const email = (u.email ?? '').toLowerCase();
				return name.includes(q) || email.includes(q);
			})
			.slice(0, 50);
	});

	$effect(() => {
		// Reset highlight when matches change
		void matches;
		highlighted = 0;
	});

	function userLabel(u: UserListItem) {
		return u.displayName ?? u.email ?? u.id.slice(0, 8);
	}

	function pick(user: UserListItem) {
		selected = user;
		query = '';
	}

	async function submit() {
		if (!selected) return;
		await onAdd(selected.id, role);
		selected = null;
		role = 'viewer';
	}

	function handleKey(e: KeyboardEvent) {
		if (selected) return;
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			highlighted = Math.min(highlighted + 1, matches.length - 1);
			scrollHighlightedIntoView();
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			highlighted = Math.max(highlighted - 1, 0);
			scrollHighlightedIntoView();
		} else if (e.key === 'Enter') {
			e.preventDefault();
			const u = matches[highlighted];
			if (u) pick(u);
		} else if (e.key === 'Escape') {
			e.preventDefault();
			onCancel();
		}
	}

	function scrollHighlightedIntoView() {
		const el = listRef?.querySelector<HTMLElement>(`[data-idx="${highlighted}"]`);
		el?.scrollIntoView({ block: 'nearest' });
	}
</script>

<div class="rounded-md border border-border bg-card">
	{#if !selected}
		<div class="relative border-b border-border">
			<Search
				class="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
			/>
			<!-- svelte-ignore a11y_autofocus -->
			<input
				bind:value={query}
				autofocus
				onkeydown={handleKey}
				placeholder="Search by name or email"
				class="h-9 w-full rounded-t-md bg-transparent pl-9 pr-9 text-sm outline-none placeholder:text-muted-foreground"
			/>
			<button
				type="button"
				onclick={onCancel}
				class="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
				aria-label="Cancel"
			>
				<X class="h-3.5 w-3.5" />
			</button>
		</div>

		<div bind:this={listRef} class="max-h-60 overflow-y-auto py-1">
			{#if matches.length === 0}
				<p class="px-3 py-6 text-center text-xs text-muted-foreground">
					{availableUsers.length === 0
						? 'Everyone in this org is already on the project.'
						: `No matches for "${query}"`}
				</p>
			{:else}
				{#each matches as user, i (user.id)}
					<button
						type="button"
						data-idx={i}
						onclick={() => pick(user)}
						onmouseenter={() => (highlighted = i)}
						class={`flex w-full items-center gap-3 px-3 py-2 text-left transition-colors ${
							highlighted === i ? 'bg-accent text-accent-foreground' : 'hover:bg-muted/60'
						}`}
					>
						<UserAvatar name={userLabel(user)} size="sm" />
						<div class="min-w-0 flex-1">
							<p class="truncate text-sm font-medium">{userLabel(user)}</p>
							{#if user.displayName && user.email}
								<p class="truncate font-mono text-xs text-muted-foreground">{user.email}</p>
							{/if}
						</div>
					</button>
				{/each}
			{/if}
		</div>
	{:else}
		<div class="flex items-center gap-3 p-2.5">
			<UserAvatar name={userLabel(selected)} size="sm" />
			<div class="min-w-0 flex-1">
				<p class="truncate text-sm font-medium">{userLabel(selected)}</p>
				{#if selected.email && selected.displayName}
					<p class="truncate font-mono text-xs text-muted-foreground">{selected.email}</p>
				{/if}
			</div>
			<select
				bind:value={role}
				class="h-8 rounded-md border border-input bg-background px-2 text-xs outline-none"
			>
				<option value="owner">Owner</option>
				<option value="editor">Editor</option>
				<option value="viewer">Viewer</option>
			</select>
			<Button onclick={submit} disabled={adding} size="sm">
				{adding ? 'Adding…' : 'Add'}
			</Button>
			<Button
				onclick={() => (selected = null)}
				variant="ghost"
				size="icon"
				class="h-8 w-8 text-muted-foreground"
				aria-label="Pick a different user"
			>
				<X class="h-3.5 w-3.5" />
			</Button>
		</div>
	{/if}
</div>
