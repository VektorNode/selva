<script lang="ts">
	import { Button, Textarea } from '@selvajs/ui';
	import { ListPlus } from '@lucide/svelte';
	import { MAX_CHANGE_NOTE_LENGTH } from '@selvajs/platform';
	import MarkdownNote from './MarkdownNote.svelte';

	interface Props {
		id: string;
		value: string;
		/** Markdown of the detected changes; offered as a one-click insert when set. */
		suggestion?: string | null;
		placeholder?: string;
	}

	let { id, value = $bindable(), suggestion = null, placeholder = '' }: Props = $props();

	let mode = $state<'write' | 'preview'>('write');
	const over = $derived(value.length > MAX_CHANGE_NOTE_LENGTH);

	function insertSuggestion() {
		if (!suggestion) return;
		value = value.trim() ? `${value.trimEnd()}\n\n${suggestion}` : suggestion;
		mode = 'write';
	}
</script>

<div class="space-y-1.5">
	<div class="flex items-center justify-between gap-2">
		<div class="bg-muted flex rounded-md p-0.5 text-xs" role="tablist">
			{#each ['write', 'preview'] as const as m (m)}
				<button
					type="button"
					role="tab"
					aria-selected={mode === m}
					class="rounded-inner px-2.5 py-1 capitalize {mode === m
						? 'bg-raised shadow-raised border'
						: 'text-muted-foreground hover:bg-hover'}"
					onclick={() => (mode = m)}
				>
					{m}
				</button>
			{/each}
		</div>
		{#if suggestion}
			<Button type="button" variant="ghost" size="sm" onclick={insertSuggestion}>
				<ListPlus class="mr-1.5 h-3.5 w-3.5" />
				Insert detected changes
			</Button>
		{/if}
	</div>

	{#if mode === 'write'}
		<Textarea {id} rows={7} {placeholder} bind:value />
	{:else}
		<div class="border-input bg-field min-h-42 rounded-md border px-3 py-2">
			{#if value.trim()}
				<MarkdownNote source={value} />
			{:else}
				<p class="text-faint-foreground text-sm">Nothing to preview yet.</p>
			{/if}
		</div>
	{/if}

	<p class="flex justify-between text-xs {over ? 'text-destructive' : 'text-muted-foreground'}">
		<span>Markdown: **bold**, - lists, ## headings, [links](https://…)</span>
		<span class="tabular-nums">
			{value.length.toLocaleString()} / {MAX_CHANGE_NOTE_LENGTH.toLocaleString()}
		</span>
	</p>
</div>
