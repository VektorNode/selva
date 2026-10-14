<script lang="ts" module>
	import { type VariantProps, tv } from 'tailwind-variants';
	import type { Component } from 'svelte';
	import { SEVERITY_ICON, SEVERITY_TEXT, type Severity } from './severity';

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

	const TONE_SEVERITY: Record<CalloutTone, Severity> = {
		info: 'info',
		tip: 'note',
		success: 'success',
		warning: 'warning',
		danger: 'error'
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

	const Icon = $derived(icon === undefined ? SEVERITY_ICON[TONE_SEVERITY[tone]] : icon);
	const accent = $derived(SEVERITY_TEXT[TONE_SEVERITY[tone]]);
</script>

<div
	class={cn(calloutVariants({ tone }), className)}
	role={tone === 'warning' || tone === 'danger' ? 'alert' : undefined}
	{...restProps}
>
	{#if Icon}
		<Icon class={cn('mt-0.5 h-4 w-4 shrink-0', accent)} />
	{/if}
	<div class="min-w-0 space-y-1">
		{#if title}
			<p class={cn('leading-tight font-medium', accent)}>{title}</p>
		{/if}
		<div class="leading-relaxed text-muted-foreground [&_a]:underline [&_strong]:text-foreground">
			{@render children()}
		</div>
	</div>
</div>
