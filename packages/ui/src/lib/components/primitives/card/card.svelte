<script lang="ts" module>
	import { tv, type VariantProps } from 'tailwind-variants';

	export const cardVariants = tv({
		base: 'shadow-sm flex flex-col rounded-xl border bg-card text-card-foreground',
		variants: {
			variant: {
				default: 'gap-6 py-6',
				/** No padding or gap: for a card whose children draw their own edges, like a tab panel. */
				flush: 'gap-0 overflow-hidden'
			}
		},
		defaultVariants: { variant: 'default' }
	});

	export type CardVariant = VariantProps<typeof cardVariants>['variant'];
</script>

<script lang="ts">
	import type { HTMLAttributes } from 'svelte/elements';
	import { cn, type WithElementRef } from '#lib/utils.js';

	let {
		ref = $bindable(null),
		class: className,
		variant = 'default',
		children,
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLDivElement>> & { variant?: CardVariant } = $props();
</script>

<div
	bind:this={ref}
	data-slot="card"
	class={cn(cardVariants({ variant }), className)}
	{...restProps}
>
	{@render children?.()}
</div>
