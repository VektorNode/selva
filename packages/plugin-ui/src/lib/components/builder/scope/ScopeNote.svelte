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

<p class="text-muted-foreground flex items-center gap-1.5 pt-2 pb-1 text-xs">
	<mark.icon class="size-3.5 shrink-0 {mark.text}" aria-hidden="true" />
	<span>{@render children()}</span>
</p>
