<script lang="ts">
	import { MAX_TAGS } from '@selvajs/schemas';
	import { Badge, Input } from '@selvajs/ui';
	import { X } from '@lucide/svelte';
	import { addTags } from '$lib/features/builder';

	interface Props {
		/** Id of the text field, for a label's `for`. */
		id: string;
		tags: string[];
		onChange: (tags: string[]) => void;
	}

	let { id, tags, onChange }: Props = $props();

	function commitEntry(input: HTMLInputElement) {
		if (!input.value.trim()) return;
		onChange(addTags(tags, input.value));
		input.value = '';
	}
</script>

{#if tags.length > 0}
	<ul class="flex flex-wrap gap-1.5" aria-label="Tags">
		{#each tags as tag (tag)}
			<li>
				<Badge variant="outline" class="gap-1">
					{tag}
					<button
						type="button"
						aria-label="Remove tag {tag}"
						class="inline-flex items-center justify-center transition-opacity hover:opacity-70"
						onclick={() => onChange(tags.filter((t) => t !== tag))}
					>
						<X class="size-3" />
					</button>
				</Badge>
			</li>
		{/each}
	</ul>
{/if}
<Input
	{id}
	placeholder={tags.length >= MAX_TAGS ? 'Tag limit reached' : 'Add a tag'}
	disabled={tags.length >= MAX_TAGS}
	onkeydown={(e) => {
		if (e.key !== 'Enter') return;
		e.preventDefault();
		commitEntry(e.currentTarget);
	}}
	onblur={(e) => commitEntry(e.currentTarget)}
/>
