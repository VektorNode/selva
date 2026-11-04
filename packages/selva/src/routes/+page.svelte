<script lang="ts">
	import { page } from '$app/state';
	import { Button } from '@selvajs/ui';
	import { ArrowRight } from '@lucide/svelte';
	import AppHeader from '#lib/components/AppHeader.svelte';

	const branding = $derived(page.data.branding);

	// Grasshopper-style graph on a 1400×700 canvas centred on the hero: input nodes wire into three
	// ports left of the logo, outputs fan out from mirrored ports on the right. Each port runs its own
	// cycle (in, then out on every wire it feeds), with periods that don't divide evenly so the
	// pattern drifts and ports overlap instead of firing in turn.
	// Ports hug the hero lockup so the wires visibly feed it instead of ending in empty space.
	const PORT_X = 580;
	const ports = [
		{ y: 320, dur: 11, delay: 2 },
		{ y: 350, dur: 13.5, delay: 4.5 },
		{ y: 380, dur: 9.5, delay: 6.5 }
	];

	type WireSpec = { x: number; y: number; port: number };

	const toWire = ({ x, y, port }: WireSpec, i: number) => ({
		x,
		y,
		port,
		// Slight jitter so parallel wires on one port don't move as a rigid block.
		jitter: (i % 3) * 0.12,
		d: `M-10,${y} H${x} C${x + 190},${y} ${PORT_X - 160},${ports[port].y} ${PORT_X},${ports[port].y}`
	});

	const inputs = [
		{ x: 200, y: 110, port: 0 },
		{ x: 110, y: 235, port: 0 },
		{ x: 250, y: 350, port: 1 },
		{ x: 130, y: 465, port: 2 },
		{ x: 210, y: 590, port: 2 }
	].map(toWire);

	// One column: with shared control-point x the curves keep their vertical order and never cross.
	const outputs = [
		{ y: 90, port: 0 },
		{ y: 185, port: 0 },
		{ y: 270, port: 1 },
		{ y: 350, port: 1 },
		{ y: 430, port: 1 },
		{ y: 515, port: 2 },
		{ y: 610, port: 2 }
	].map((o, i) => toWire({ x: 190, ...o }, i));

	const sides = [
		{ out: false, wires: inputs },
		{ out: true, wires: outputs }
	];
</script>

<svelte:head>
	<title>{branding.name}</title>
</svelte:head>

<AppHeader showSignIn={false}>
	<div
		class="relative isolate flex min-h-[80vh] w-full items-center justify-center overflow-hidden"
	>
		<svg
			aria-hidden="true"
			viewBox="0 0 1400 700"
			class="text-faint-foreground pointer-events-none absolute top-1/2 left-1/2 -z-10 hidden h-175 w-350 max-w-none -translate-x-1/2 -translate-y-1/2 mask-[linear-gradient(90deg,transparent,#000_14%,#000_86%,transparent)] md:block"
		>
			{#each sides as side (side.out)}
				<g transform={side.out ? 'translate(1400 0) scale(-1 1)' : undefined}>
					{#each side.wires as wire, i (wire.d)}
						<path
							d={wire.d}
							pathLength="1"
							fill="none"
							stroke="currentColor"
							stroke-width="1.25"
							class="wire"
							style="--d: {300 + i * 110}ms"
						/>
						<path
							d={wire.d}
							pathLength="1"
							fill="none"
							stroke-width="1.75"
							stroke-linecap="round"
							class="pulse"
							class:out={side.out}
							style="--dur: {ports[wire.port].dur}s; --d: {ports[wire.port].delay +
								(side.out ? wire.jitter : 0)}s"
						/>
						<rect
							x={wire.x - 16}
							y={wire.y - 8}
							width="32"
							height="16"
							rx="4"
							class="node fill-background stroke-current"
							style="--d: {200 + i * 110}ms"
						/>
					{/each}
					{#each ports as port (port.y)}
						<circle
							cx={PORT_X}
							cy={port.y}
							r="3.5"
							class="node fill-background stroke-current"
							style="--d: 1100ms"
						/>
					{/each}
				</g>
			{/each}
		</svg>

		<div class="flex w-full max-w-xl flex-col items-center px-4 text-center">
			<img
				src="/favicon/favicon.svg"
				alt=""
				class="rise size-20 drop-shadow-md dark:filter-[drop-shadow(0_0_0.5px_oklch(1_0_0/0.45))]"
				style="--d: 0ms"
			/>
			<h1 class="rise mt-6 text-5xl font-bold tracking-tighter sm:text-6xl" style="--d: 100ms">
				{branding.name}
			</h1>
			{#if branding.tagline}
				<p class="text-muted-foreground mt-3 text-base text-balance">{branding.tagline}</p>
			{/if}
			<Button href="/login" size="lg" class="rise group mt-8" style="--d: 200ms">
				Sign in
				<ArrowRight class="ml-1 h-4 w-4 transition-transform group-hover:translate-x-0.5" />
			</Button>
		</div>
	</div>
</AppHeader>

<style>
	@keyframes rise {
		from {
			opacity: 0;
			transform: translateY(12px);
		}
	}
	.rise {
		animation: rise 0.6s cubic-bezier(0.2, 0.7, 0.2, 1) var(--d, 0ms) backwards;
	}
	@keyframes draw {
		to {
			stroke-dashoffset: 0;
		}
	}
	.wire {
		stroke-dasharray: 1;
		stroke-dashoffset: 1;
		animation: draw 1.6s cubic-bezier(0.3, 0.6, 0.2, 1) var(--d, 0ms) forwards;
	}
	@keyframes fade-in {
		from {
			opacity: 0;
		}
	}
	.node {
		animation: fade-in 0.5s ease-out var(--d, 0ms) backwards;
	}
	/* A brand-green dash travels in along a left wire; as it reaches the port, its mirrored right
	   wire carries it back out. Both share one cycle so the hand-off stays in sync. */
	@keyframes flow-in {
		0% {
			stroke-dashoffset: 0.05;
		}
		45%,
		100% {
			stroke-dashoffset: -1;
		}
	}
	@keyframes flow-out {
		0%,
		45% {
			stroke-dashoffset: -1;
		}
		90%,
		100% {
			stroke-dashoffset: 0.05;
		}
	}
	.pulse {
		stroke: oklch(0.68 0.13 130);
		stroke-dasharray: 0.05 1;
		stroke-dashoffset: 0.05;
		animation: flow-in var(--dur, 11s) ease-in-out var(--d, 0ms) infinite backwards;
	}
	.pulse.out {
		animation-name: flow-out;
	}
	/* Dimmer wires and a brighter, softly lit pulse: on near-black the grey wires read as noise and
	   the light-mode green sinks into the background. */
	:global(.dark) .pulse {
		stroke: oklch(0.82 0.15 128);
		filter: drop-shadow(0 0 3px oklch(0.82 0.15 128 / 0.6));
	}
	@media (prefers-reduced-motion: reduce) {
		.rise,
		.node {
			animation: none;
		}
		.wire {
			animation: none;
			stroke-dashoffset: 0;
		}
		.pulse {
			display: none;
		}
	}
</style>
