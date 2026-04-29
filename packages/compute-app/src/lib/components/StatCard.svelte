<script lang="ts">
	import { Card } from '@selvajs/ui';
	import { ArrowRight } from '@lucide/svelte';
	import type { ComponentType } from 'svelte';

	interface Props {
		href: string;
		icon: ComponentType;
		value: string | number;
		label: string;
	}

	let { href, icon: Icon, value, label }: Props = $props();
</script>

<a {href} class="block">
	<Card.Root class="hover:bg-accent/40 h-full transition-colors">
		<Card.Content class="flex items-center justify-between gap-4 py-6">
			<div class="flex items-center gap-4">
				<div class="bg-accent text-accent-foreground rounded-md p-2.5">
					<Icon class="h-4 w-4" />
				</div>
				<div>
					<p class="text-2xl leading-none font-medium">
						{value}
					</p>
					<p class="text-muted-foreground mt-1 text-xs">{label}</p>
				</div>
			</div>
			<ArrowRight class="text-muted-foreground h-4 w-4 shrink-0" />
		</Card.Content>
	</Card.Root>
</a>
