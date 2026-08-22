<script lang="ts" module>
	import { type VariantProps, tv } from 'tailwind-variants';
	import { Info, TriangleAlert, CircleCheck, CircleX, Lightbulb } from '@lucide/svelte';
	import type { Component } from 'svelte';

	export const calloutVariants = tv({
		base: 'flex items-start gap-2.5 rounded-lg border px-3.5 py-3 text-sm',
		variants: {
			tone: {
				info: 'border-info/40 bg-info/10',
				tip: 'border-border bg-muted/40',
				success: 'border-success/40 bg-success/10',
				warning: 'border-warning/40 bg-warning/10',
				danger: 'border-destructive/40 bg-destructive/10'
			}
		},
		defaultVariants: { tone: 'info' }
	});

	export type CalloutTone = NonNullable<VariantProps<typeof calloutVariants>['tone']>;

	const TONE_ICON: Record<CalloutTone, Component> = {
		info: Info,
		tip: Lightbulb,
		success: CircleCheck,
		warning: TriangleAlert,
		danger: CircleX
	};

	const TONE_ACCENT: Record<CalloutTone, string> = {
		info: 'text-info',
		tip: 'text-muted-foreground',
		success: 'text-success',
		warning: 'text-warning',
		danger: 'text-destructive'
	};
</script>

<script lang="ts">
	import type { HTMLAttributes } from 'svelte/elements';
	import type { Snippet } from 'svelte';
	import { cn } from '$lib/utils.js';

	interface Props extends HTMLAttributes<HTMLDivElement> {
		tone?: CalloutTone;
		title?: string;
		/** Replaces the tone's default icon. `null` drops the icon entirely. */
		icon?: Component | null;
		children: Snippet;
	}

	let { tone = 'info', title, icon, class: className, children, ...restProps }: Props = $props();

	const Icon = $derived(icon === undefined ? TONE_ICON[tone] : icon);
</script>

<div
	class={cn(calloutVariants({ tone }), className)}
	role={tone === 'warning' || tone === 'danger' ? 'alert' : undefined}
	{...restProps}
>
	{#if Icon}
		<Icon class={cn('mt-0.5 h-4 w-4 shrink-0', TONE_ACCENT[tone])} />
	{/if}
	<div class="min-w-0 space-y-1">
		{#if title}
			<p class={cn('leading-tight font-medium', TONE_ACCENT[tone])}>{title}</p>
		{/if}
		<div class="leading-relaxed text-muted-foreground [&_a]:underline [&_strong]:text-foreground">
			{@render children()}
		</div>
	</div>
</div>
