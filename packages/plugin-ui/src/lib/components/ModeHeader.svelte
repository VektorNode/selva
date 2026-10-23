<script lang="ts">
	import type { Snippet } from 'svelte';
	import { ModeToggle } from '@selvajs/ui';
	import { Play, Wrench } from '@lucide/svelte';
	import { rhinoShellProps } from '$lib/utils/rhino-host.svelte';

	interface Props {
		homeUrl: string;
		current: 'builder' | 'preview';
		/** Goes to the other mode. */
		onSwitch: () => void;
		/** The schema's name; null while it loads. */
		title: string | null;
		actions?: Snippet;
	}

	let { homeUrl, current, onSwitch, title, actions }: Props = $props();

	const MODES = [
		{ id: 'builder', label: 'Schema Builder', icon: Wrench },
		{ id: 'preview', label: 'Interactive Preview', icon: Play }
	] as const;

	const showModeToggle = rhinoShellProps().showModeToggle !== false;
</script>

<!-- Builder and preview share this header so the mode switch sits in the same place on both:
     everything that varies (the name, the page's actions) comes after it. The modes are icons
     only; each label stays as the tooltip and accessible name. -->
<div class="flex w-full min-w-0 items-center gap-2 sm:gap-3">
	<a href={homeUrl} class="flex shrink-0 items-center gap-2" aria-label="Selva">
		<img src="/favicon/favicon.svg" alt="" aria-hidden="true" class="h-5 w-5" />
		<span class="text-sm font-semibold tracking-tight max-md:hidden">Selva</span>
	</a>

	<div class="bg-border h-5 w-px shrink-0" aria-hidden="true"></div>

	<!-- Styled like the Tabs list, and as tall as the header's small buttons. -->
	<nav class="bg-muted flex h-8 shrink-0 items-center gap-0.5 rounded-lg p-0.5">
		{#each MODES as mode (mode.id)}
			{@const active = mode.id === current}
			<button
				type="button"
				class="focus-visible:ring-ring flex h-7 w-8 items-center justify-center rounded-md border transition-colors focus-visible:ring-3 focus-visible:outline-none [&_svg]:size-4 {active
					? 'bg-background text-foreground dark:border-input dark:bg-input/30 shadow-sm'
					: 'text-muted-foreground hover:text-foreground border-transparent'}"
				title={mode.label}
				aria-current={active ? 'page' : undefined}
				onclick={() => {
					if (!active) onSwitch();
				}}
			>
				<mode.icon />
				<span class="sr-only">{mode.label}</span>
			</button>
		{/each}
	</nav>

	<span class="text-muted-foreground min-w-0 truncate text-sm font-medium">{title ?? ''}</span>

	<div class="ml-auto flex shrink-0 items-center gap-2">
		{@render actions?.()}
		{#if showModeToggle}
			<ModeToggle />
		{/if}
	</div>
</div>
