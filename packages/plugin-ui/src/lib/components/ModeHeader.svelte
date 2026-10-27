<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Button, DropdownMenu, ModeToggle } from '@selvajs/ui';
	import { Ellipsis, FolderOpen, Play, SquarePen, Wrench, X } from '@lucide/svelte';
	import { rhinoShellProps } from '#lib/utils/rhino-host.svelte.js';
	import { isRhinoPanel } from '#lib/utils/session.js';
	import { RHINO_OPEN_DEFINITION_URL } from '#lib/app.config.js';

	interface Props {
		homeUrl: string;
		current: 'builder' | 'preview';
		/** A player session opened the definition from the Selva panel: no builder to switch to. */
		player?: boolean;
		/** Goes to the other mode. */
		onSwitch: () => void;
		/** Player only: closes the definition, and the panel goes back to its launcher. */
		onClose?: () => void;
		/** Player only: shows Grasshopper's editor; the page reloads as an author. */
		onEdit?: () => void;
		/** The schema's name; null while it loads. */
		title: string | null;
		/** The canvas's params differ from the schema's. A player can't sync, so it never sees this. */
		syncNeeded?: boolean;
		onSync?: () => void;
		actions?: Snippet;
	}

	let {
		homeUrl,
		current,
		player = false,
		onSwitch,
		onClose,
		onEdit,
		title,
		syncNeeded = false,
		onSync,
		actions
	}: Props = $props();

	const MODES = [
		{ id: 'builder', label: 'Schema Builder', icon: Wrench },
		{ id: 'preview', label: 'Interactive Preview', icon: Play }
	] as const;

	const showModeToggle = rhinoShellProps().showModeToggle !== false;
	// The Open dialog is Rhino's own, reached through the host's selva-panel:// links.
	const canOpenAnother = isRhinoPanel();
</script>

<!-- Builder and preview share this header so the mode switch sits in the same place on both:
     everything that varies (the name, the page's actions) comes after it. The modes are icons
     only; each label stays as the tooltip and accessible name. -->
<div class="flex w-full min-w-0 items-center gap-2 sm:gap-3">
	<a href={homeUrl} class="flex shrink-0 items-center gap-2" aria-label="Selva">
		<img src="/favicon/favicon.svg" alt="" aria-hidden="true" class="h-5 w-5" />
		<span class="text-sm font-semibold tracking-tight max-md:hidden">Selva</span>
	</a>

	{#if !player}
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
	{/if}

	<span class="text-muted-foreground min-w-0 truncate text-sm font-medium">{title ?? ''}</span>

	<div class="ml-auto flex shrink-0 items-center gap-2">
		{#if syncNeeded && !player}
			<Button
				variant="default"
				size="sm"
				onclick={() => onSync?.()}
				class="animate-pulse bg-amber-500 hover:bg-amber-600"
				title="Sync Parameters"
			>
				⚡ <span class="max-md:sr-only">Sync Parameters</span>
			</Button>
		{/if}
		{@render actions?.()}
		{#if player}
			<DropdownMenu.Root>
				<DropdownMenu.Trigger>
					{#snippet child({ props })}
						<Button
							{...props}
							variant="outline"
							size="icon-sm"
							aria-label="Definition"
							title="Definition"
						>
							<Ellipsis />
						</Button>
					{/snippet}
				</DropdownMenu.Trigger>
				<DropdownMenu.Content align="end" class="w-56">
					{#if canOpenAnother}
						<DropdownMenu.Item onSelect={() => window.location.assign(RHINO_OPEN_DEFINITION_URL)}>
							<FolderOpen />Open another…
						</DropdownMenu.Item>
					{/if}
					<DropdownMenu.Item onSelect={() => onEdit?.()}>
						<SquarePen />Edit in Grasshopper
					</DropdownMenu.Item>
					<DropdownMenu.Separator />
					<DropdownMenu.Item onSelect={() => onClose?.()}>
						<X />Close
					</DropdownMenu.Item>
				</DropdownMenu.Content>
			</DropdownMenu.Root>
		{/if}
		{#if showModeToggle}
			<ModeToggle />
		{/if}
	</div>
</div>
