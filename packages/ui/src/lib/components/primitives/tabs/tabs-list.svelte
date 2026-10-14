<script lang="ts" module>
	import { type VariantProps, tv } from 'tailwind-variants';

	export const tabsListVariants = tv({
		base: 'inline-flex items-center text-muted-foreground',
		variants: {
			variant: {
				default: 'h-9 w-fit justify-center rounded-lg bg-muted p-0.75',
				line: 'gap-1 px-2 w-full justify-start'
			}
		},
		defaultVariants: {
			variant: 'default'
		}
	});

	export type TabsListVariant = VariantProps<typeof tabsListVariants>['variant'];
</script>

<script lang="ts">
	import { Tabs as TabsPrimitive } from 'bits-ui';
	import { cn } from '$lib/utils.js';

	let {
		ref = $bindable(null),
		class: className,
		variant = 'default',
		...restProps
	}: TabsPrimitive.ListProps & { variant?: TabsListVariant } = $props();
</script>

<TabsPrimitive.List
	bind:ref
	data-slot="tabs-list"
	data-variant={variant}
	class={cn(tabsListVariants({ variant }), className)}
	{...restProps}
/>
