<script lang="ts" module>
	import { type VariantProps, tv } from 'tailwind-variants';

	export const tabsTriggerVariants = tv({
		base: "gap-1.5 text-sm font-medium [&_svg:not([class*='size-'])]:size-4 inline-flex items-center justify-center whitespace-nowrap focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-1 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
		variants: {
			variant: {
				default:
					'px-2 py-1 data-[state=active]:shadow-sm h-full flex-1 rounded-md border border-transparent text-foreground transition focus-visible:border-ring data-[state=active]:bg-background dark:text-muted-foreground dark:data-[state=active]:border-input dark:data-[state=active]:bg-input/30 dark:data-[state=active]:text-foreground',
				line: 'px-2.5 py-3 relative flex-none text-muted-foreground transition-colors after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full hover:text-foreground data-[state=active]:text-foreground data-[state=active]:after:bg-primary'
			}
		},
		defaultVariants: {
			variant: 'default'
		}
	});

	export type TabsTriggerVariant = VariantProps<typeof tabsTriggerVariants>['variant'];
</script>

<script lang="ts">
	import { Tabs as TabsPrimitive } from 'bits-ui';
	import { cn } from '$lib/utils.js';

	let {
		ref = $bindable(null),
		class: className,
		variant = 'default',
		...restProps
	}: TabsPrimitive.TriggerProps & { variant?: TabsTriggerVariant } = $props();
</script>

<TabsPrimitive.Trigger
	bind:ref
	data-slot="tabs-trigger"
	class={cn(tabsTriggerVariants({ variant }), className)}
	{...restProps}
/>
