<script lang="ts">
	import { MediaQuery } from 'svelte/reactivity';
	import {
		Camera,
		Grid3x3,
		Layers,
		LocateFixed,
		Maximize,
		Minimize,
		Moon,
		Ellipsis,
		Palette,
		Ruler,
		Settings2,
		Spline,
		Cuboid
	} from '@lucide/svelte';
	import type { CameraProjection, Look, ViewPreset } from '@selvajs/visualization/render';
	import * as DropdownMenu from '$lib/components/primitives/dropdown-menu/index.js';
	import type { ViewerMessages } from '$lib/i18n/messages';

	interface Props {
		t: ViewerMessages;
		/** Fades the dock out while a host drawer covers the viewer. */
		hidden?: boolean;
		showDisplay: boolean;
		showGrid: boolean;
		showSceneManager: boolean;
		showScreenshot: boolean;
		showFullscreen: boolean;
		styleOptions: { look: Look; label: string }[];
		viewPresets: { preset: ViewPreset; label: string }[];
		renderStyle: Look;
		nightOn: boolean;
		edgesVisible: boolean;
		measureActive: boolean;
		gridVisible: boolean;
		sceneManagerOpen: boolean;
		projection: CameraProjection;
		isFullscreen: boolean;
		onSetLook: (look: Look) => void;
		onToggleNight: () => void;
		onToggleEdges: () => void;
		onToggleMeasure: () => void;
		onToggleGrid: () => void;
		onToggleSceneManager: () => void;
		onToggleProjection: () => void;
		onSetView: (preset: ViewPreset) => void;
		onFit: () => void;
		onScreenshot: () => void;
		onToggleFullscreen: () => void;
	}

	let {
		t,
		hidden = false,
		showDisplay,
		showGrid,
		showSceneManager,
		showScreenshot,
		showFullscreen,
		styleOptions,
		viewPresets,
		renderStyle,
		nightOn,
		edgesVisible,
		measureActive,
		gridVisible,
		sceneManagerOpen,
		projection,
		isFullscreen,
		onSetLook,
		onToggleNight,
		onToggleEdges,
		onToggleMeasure,
		onToggleGrid,
		onToggleSceneManager,
		onToggleProjection,
		onSetView,
		onFit,
		onScreenshot,
		onToggleFullscreen
	}: Props = $props();

	// A hairline pill at the bottom edge is the iOS home indicator on a phone, and swiping it leaves
	// the app. Touch gets a visible round button instead.
	const touch = new MediaQuery('(pointer: coarse)');
	const reducedMotion = new MediaQuery('(prefers-reduced-motion: reduce)');

	const COLLAPSED = $derived(touch.current ? { w: 44, h: 44 } : { w: 56, h: 5 });
	const EXPANDED_H = $derived(touch.current ? 54 : 42);
	const PAD = 4;

	let dockEl: HTMLDivElement | undefined = $state();
	let rowWidth = $state(0);
	let engaged = $state(false);
	// Set by an outside press: the dock was dismissed, so it shrinks faster.
	let dismissed = $state(false);
	let menusOpen = $state(0);
	let focusWithin = $state(false);
	let idleTimer: ReturnType<typeof setTimeout> | undefined;

	const wantOpen = $derived(engaged || menusOpen > 0 || focusWithin);

	// Opening leads: the pill grows first and the buttons pop in behind it. Closing mirrors it: the
	// buttons fade first, then the pill shrinks. Without the delay on close the row is clipped mid-fade.
	const EASE = 'cubic-bezier(0.32, 0.72, 0, 1)';
	const containerStyle = $derived.by(() => {
		const bottom = touch.current ? 'max(1rem,env(safe-area-inset-bottom))' : '0.75rem';
		const geometry = wantOpen
			? `width:${rowWidth + PAD * 2 + 2}px;height:${EXPANDED_H}px;border-radius:12px;padding:${PAD}px`
			: `width:${COLLAPSED.w}px;height:${COLLAPSED.h}px;border-radius:${touch.current ? 22 : 99}px;padding:0px`;
		const size = `bottom:${bottom};${geometry}`;
		if (reducedMotion.current) return size;
		const ms = wantOpen ? 420 : dismissed ? 130 : 170;
		const delay = wantOpen || dismissed ? 0 : 20;
		const props = ['width', 'height', 'border-radius', 'padding'];
		return `${size};transition:${props.map((p) => `${p} ${ms}ms ${EASE} ${delay}ms`).join(',')},opacity 200ms ease`;
	});
	const itemStyle = (index: number) => {
		if (reducedMotion.current) return `opacity:${wantOpen ? 1 : 0}`;
		const delay = 110 + index * 35;
		return wantOpen
			? `opacity:1;transform:none;transition:opacity 240ms ease ${delay}ms,transform 420ms cubic-bezier(0.34,1.45,0.5,1) ${delay}ms`
			: 'opacity:0;transform:translateY(6px) scale(0.85);transition:opacity 100ms ease,transform 100ms ease';
	};
	// The touch button's settings glyph hands over to the row.
	const glyphStyle = $derived(
		`opacity:${touch.current && !wantOpen ? 1 : 0};${reducedMotion.current ? '' : `transition:opacity ${wantOpen ? 100 : 100}ms ease ${wantOpen || dismissed ? 0 : 60}ms`}`
	);

	function scheduleCollapse(delay = touch.current ? 3500 : 150) {
		clearTimeout(idleTimer);
		idleTimer = setTimeout(() => (engaged = false), delay);
	}

	function engage() {
		engaged = true;
		dismissed = false;
		clearTimeout(idleTimer);
	}

	function handlePointerMove(event: PointerEvent) {
		if (!dockEl || touch.current || event.pointerType === 'touch') return;
		// Orbiting or box-dragging with the button down should never pop the dock open.
		if (event.buttons) return;
		const host = dockEl.offsetParent;
		if (!host || !(event.target instanceof Node) || !host.contains(event.target)) {
			if (engaged) scheduleCollapse();
			return;
		}
		const r = dockEl.getBoundingClientRect();
		const near =
			event.clientY > r.top - 36 && Math.abs(event.clientX - (r.left + r.width / 2)) < 110;
		if (near) engage();
		else if (engaged) scheduleCollapse();
	}

	function handleWindowPointerDown(event: PointerEvent) {
		if (!engaged || !dockEl || !(event.target instanceof Node)) return;
		if (!dockEl.contains(event.target)) {
			clearTimeout(idleTimer);
			dismissed = true;
			engaged = false;
		}
	}

	function openFromCollapsed() {
		if (wantOpen) return;
		engage();
		if (touch.current) scheduleCollapse();
	}

	// Any use of the open dock on touch pushes the idle collapse back.
	function keepAlive() {
		if (touch.current && engaged) scheduleCollapse();
	}

	function trackMenu(open: boolean) {
		menusOpen += open ? 1 : -1;
		if (!open && !touch.current) scheduleCollapse(250);
	}

	// Buttons in the row, in order, so the stagger index stays right when some are hidden.
	const buttons = $derived(
		[
			showDisplay && 'look',
			showSceneManager && 'scene',
			'measure',
			'fit',
			showFullscreen && 'full',
			'more'
		].filter(Boolean) as string[]
	);
	const idx = (id: string) => buttons.indexOf(id);

	const BTN =
		'relative grid size-8.5 shrink-0 place-items-center rounded-lg text-muted-foreground outline-none transition-colors hover:bg-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring aria-pressed:text-foreground data-[state=open]:bg-selected data-[state=open]:text-foreground pointer-coarse:size-11';
	const DOT =
		'aria-pressed:after:absolute aria-pressed:after:bottom-0.5 aria-pressed:after:size-1 aria-pressed:after:rounded-full aria-pressed:after:bg-primary';
</script>

<!-- eslint-disable shadcn/no-inline-styles -- the pill animates between measured pixel sizes and staggered per-item delays; no class can express those -->

<svelte:window onpointermove={handlePointerMove} onpointerdown={handleWindowPointerDown} />

<!-- Resting state is a pill; it grows into the row. Only the container is clickable while collapsed. -->
<div
	bind:this={dockEl}
	role="toolbar"
	aria-label={t.toolsMenu}
	tabindex="-1"
	class="backdrop-blur-md absolute left-1/2 z-50 -translate-x-1/2 overflow-hidden transition-colors {hidden
		? 'pointer-events-none opacity-0'
		: ''} {wantOpen
		? 'shadow-md border border-border bg-background/60'
		: touch.current
			? 'shadow-lg cursor-pointer border border-border bg-background/90'
			: nightOn
				? 'bg-white/35 hover:bg-white/70 cursor-pointer'
				: 'cursor-pointer bg-muted hover:bg-hover'}"
	style={containerStyle}
	onclick={openFromCollapsed}
	onkeydown={(e) => (e.key === 'Escape' ? (engaged = false) : undefined)}
	onfocusin={() => (focusWithin = true)}
	onfocusout={(e) => {
		if (!dockEl?.contains(e.relatedTarget as Node | null)) focusWithin = false;
	}}
	onpointerdown={keepAlive}
>
	{#if touch.current}
		<span
			class="inset-0 pointer-events-none absolute grid place-items-center text-foreground"
			style={glyphStyle}
			aria-hidden="true"
		>
			<Settings2 class="size-5" />
		</span>
	{/if}

	<div
		bind:offsetWidth={rowWidth}
		class="gap-0.5 mx-auto flex w-max items-center"
		inert={!wantOpen}
	>
		{#if showDisplay}
			<div style={itemStyle(idx('look'))}>
				<DropdownMenu.Root onOpenChange={trackMenu}>
					<DropdownMenu.Trigger>
						{#snippet child({ props })}
							<button {...props} class={BTN} title={t.display} aria-label={t.display}>
								<Palette class="size-4.5" />
							</button>
						{/snippet}
					</DropdownMenu.Trigger>
					<DropdownMenu.Content
						side="top"
						align="center"
						sideOffset={12}
						variant="glass"
						class="min-w-52 z-10001 w-auto whitespace-nowrap"
					>
						<DropdownMenu.RadioGroup
							value={renderStyle}
							onValueChange={(look) => onSetLook(look as Look)}
						>
							{#each styleOptions as { look, label } (look)}
								<DropdownMenu.RadioItem value={look} closeOnSelect={false}>
									{label}
								</DropdownMenu.RadioItem>
							{/each}
						</DropdownMenu.RadioGroup>
						<DropdownMenu.Separator />
						<DropdownMenu.CheckboxItem
							switch
							checked={edgesVisible}
							onCheckedChange={onToggleEdges}
						>
							<Spline />
							{t.edges}
							<DropdownMenu.Shortcut class="pointer-coarse:hidden">E</DropdownMenu.Shortcut>
						</DropdownMenu.CheckboxItem>
					</DropdownMenu.Content>
				</DropdownMenu.Root>
			</div>
		{/if}

		{#if showSceneManager}
			<div style={itemStyle(idx('scene'))}>
				<button
					class="{BTN} {DOT}"
					title="{t.sceneManager} (S)"
					aria-label={t.sceneManager}
					aria-pressed={sceneManagerOpen}
					onclick={onToggleSceneManager}
				>
					<Layers class="size-4.5" />
				</button>
			</div>
		{/if}

		<div style={itemStyle(idx('measure'))}>
			<button
				class="{BTN} {DOT}"
				title="{t.measure} (M)"
				aria-label={t.measure}
				aria-pressed={measureActive}
				onclick={onToggleMeasure}
			>
				<Ruler class="size-4.5" />
			</button>
		</div>

		<div style={itemStyle(idx('fit'))}>
			<button class={BTN} title="{t.fitToView} (F)" aria-label="{t.fitToView} (F)" onclick={onFit}>
				<LocateFixed class="size-4.5" />
			</button>
		</div>

		{#if showFullscreen}
			<div style={itemStyle(idx('full'))}>
				<button
					class={BTN}
					title={isFullscreen ? t.exitFullscreen : t.fullscreen}
					aria-label={isFullscreen ? t.exitFullscreen : t.fullscreen}
					onclick={onToggleFullscreen}
				>
					{#if isFullscreen}<Minimize class="size-4.5" />{:else}<Maximize class="size-4.5" />{/if}
				</button>
			</div>
		{/if}

		<div style={itemStyle(idx('more'))}>
			<DropdownMenu.Root onOpenChange={trackMenu}>
				<DropdownMenu.Trigger>
					{#snippet child({ props })}
						<button {...props} class={BTN} title={t.toolsMenu} aria-label={t.toolsMenu}>
							<Ellipsis class="size-4.5" />
						</button>
					{/snippet}
				</DropdownMenu.Trigger>
				<DropdownMenu.Content
					side="top"
					align="end"
					sideOffset={12}
					variant="glass"
					class="min-w-60 z-10001 w-auto whitespace-nowrap"
				>
					<DropdownMenu.Label>{t.views}</DropdownMenu.Label>
					<div class="gap-1 px-1 pb-1 grid grid-cols-4">
						{#each viewPresets as { preset, label } (preset)}
							<DropdownMenu.Item
								closeOnSelect={false}
								onSelect={() => onSetView(preset)}
								variant="chip"
							>
								{label}
							</DropdownMenu.Item>
						{/each}
					</div>

					<DropdownMenu.Separator />

					<DropdownMenu.CheckboxItem
						switch
						checked={projection === 'orthographic'}
						onCheckedChange={onToggleProjection}
					>
						<Cuboid />
						{t.switchToOrthographic}
						<DropdownMenu.Shortcut class="pointer-coarse:hidden">O</DropdownMenu.Shortcut>
					</DropdownMenu.CheckboxItem>

					{#if showGrid}
						<DropdownMenu.CheckboxItem switch checked={gridVisible} onCheckedChange={onToggleGrid}>
							<Grid3x3 />
							{t.grid}
							<DropdownMenu.Shortcut class="pointer-coarse:hidden">G</DropdownMenu.Shortcut>
						</DropdownMenu.CheckboxItem>
					{/if}

					{#if showDisplay}
						<DropdownMenu.CheckboxItem switch checked={nightOn} onCheckedChange={onToggleNight}>
							<Moon />
							{t.nightMode}
							<DropdownMenu.Shortcut class="pointer-coarse:hidden">N</DropdownMenu.Shortcut>
						</DropdownMenu.CheckboxItem>
					{/if}

					{#if showScreenshot}
						<DropdownMenu.Separator />
					{/if}

					{#if showScreenshot}
						<DropdownMenu.Item onSelect={onScreenshot}>
							<Camera />
							{t.screenshot}
						</DropdownMenu.Item>
					{/if}
				</DropdownMenu.Content>
			</DropdownMenu.Root>
		</div>
	</div>
</div>
