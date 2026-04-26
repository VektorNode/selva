<script lang="ts">
	import { Search, ChevronDown, Check, FolderOpen } from '@lucide/svelte';

	interface Project {
		id: string;
		name: string;
	}

	interface Props {
		projects: Project[];
		value: string;
		onChange: (id: string) => void;
		id?: string;
		placeholder?: string;
	}

	let {
		projects,
		value,
		onChange,
		id = undefined,
		placeholder = 'Select a project'
	}: Props = $props();

	let open = $state(false);
	let query = $state('');
	let highlighted = $state(0);
	let inputRef = $state<HTMLInputElement>();
	let containerRef = $state<HTMLDivElement>();

	const selected = $derived(projects.find((p) => p.id === value) ?? null);

	const matches = $derived.by(() => {
		const q = query.trim().toLowerCase();
		if (!q) return projects;
		return projects.filter((p) => p.name.toLowerCase().includes(q));
	});

	$effect(() => {
		void matches;
		highlighted = 0;
	});

	$effect(() => {
		if (open) {
			// focus the search after the panel is in the DOM
			queueMicrotask(() => inputRef?.focus());
		} else {
			query = '';
		}
	});

	function pick(project: Project) {
		onChange(project.id);
		open = false;
	}

	function handleKey(e: KeyboardEvent) {
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			highlighted = Math.min(highlighted + 1, matches.length - 1);
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			highlighted = Math.max(highlighted - 1, 0);
		} else if (e.key === 'Enter') {
			e.preventDefault();
			const m = matches[highlighted];
			if (m) pick(m);
		} else if (e.key === 'Escape') {
			e.preventDefault();
			open = false;
		}
	}

	function handleDocClick(e: MouseEvent) {
		if (!open) return;
		if (containerRef && !containerRef.contains(e.target as Node)) open = false;
	}

	$effect(() => {
		if (!open) return;
		document.addEventListener('mousedown', handleDocClick);
		return () => document.removeEventListener('mousedown', handleDocClick);
	});
</script>

<div bind:this={containerRef} class="relative">
	<button
		type="button"
		{id}
		onclick={() => (open = !open)}
		class={`flex h-10 w-full items-center gap-2 rounded-md border bg-background px-3 text-left text-sm transition-colors ${
			open ? 'border-ring ring-2 ring-ring/30' : 'border-input hover:bg-muted/40'
		}`}
	>
		<FolderOpen class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
		<span class={`min-w-0 flex-1 truncate ${selected ? '' : 'text-muted-foreground'}`}>
			{selected ? selected.name : placeholder}
		</span>
		<ChevronDown
			class={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`}
		/>
	</button>

	{#if open}
		<div
			class="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-md border border-border bg-popover shadow-md"
		>
			{#if projects.length > 4}
				<div class="relative border-b border-border">
					<Search
						class="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
					/>
					<input
						bind:this={inputRef}
						bind:value={query}
						onkeydown={handleKey}
						placeholder="Filter projects"
						class="h-9 w-full bg-transparent pl-9 pr-3 text-sm outline-none placeholder:text-muted-foreground"
					/>
				</div>
			{/if}

			<div class="max-h-60 overflow-y-auto py-1">
				{#if matches.length === 0}
					<p class="px-3 py-3 text-center text-xs text-muted-foreground">
						No matches for "{query}"
					</p>
				{:else}
					{#each matches as project, i (project.id)}
						<button
							type="button"
							onclick={() => pick(project)}
							onmouseenter={() => (highlighted = i)}
							class={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors ${
								highlighted === i
									? 'bg-accent text-accent-foreground'
									: 'hover:bg-muted/60'
							}`}
						>
							<span class="flex-1 truncate">{project.name}</span>
							{#if project.id === value}
								<Check class="h-3.5 w-3.5 shrink-0 text-primary" />
							{/if}
						</button>
					{/each}
				{/if}
			</div>
		</div>
	{/if}
</div>
