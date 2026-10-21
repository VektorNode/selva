<script lang="ts">
	import type { Snippet } from 'svelte';
	import { SCOPES, type Scope } from './scopes';

	interface Props {
		scope: Exclude<Scope, 'shared'>;
		children: Snippet;
	}

	let { scope, children }: Props = $props();

	const mark = $derived(SCOPES[scope]);
</script>

<section
	aria-label={mark.label}
	class="flex flex-col gap-2 rounded-md border px-2 py-2 text-[11px] {mark.surface}"
>
	<div class="flex items-center gap-1 font-semibold {mark.text}">
		<mark.icon size={12} strokeWidth={2.5} aria-hidden="true" />
		{mark.label}
	</div>
	{@render children()}
</section>
