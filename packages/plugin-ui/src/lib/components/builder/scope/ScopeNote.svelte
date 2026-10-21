<script lang="ts">
	import type { Snippet } from 'svelte';
	import { SCOPES, type Scope } from './scopes';

	interface Props {
		scope: Scope;
		/** Where the settings below take effect, in one sentence. */
		children: Snippet;
	}

	let { scope, children }: Props = $props();

	const mark = $derived(SCOPES[scope]);
</script>

<div class="mt-2 mb-1 flex items-start gap-2.5 rounded-lg border px-3 py-2.5 {mark.surface}">
	<mark.icon class="mt-0.5 size-4 shrink-0 {mark.text}" aria-hidden="true" />
	<div class="flex min-w-0 flex-col gap-0.5">
		<p class="text-sm font-medium {mark.text}">{mark.label}</p>
		<p class="text-muted-foreground text-xs">{@render children()}</p>
	</div>
</div>
