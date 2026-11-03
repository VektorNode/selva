<script lang="ts">
	import { page } from '$app/state';
	import type { DocSidebarGroup } from '$lib/docs';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';

	let { groups }: { groups: DocSidebarGroup[] } = $props();
</script>

<nav aria-label="Docs" class="space-y-6">
	{#each groups as section (section.title)}
		<details open class="group">
			<summary
				class="text-foreground flex cursor-pointer list-none items-center justify-between text-sm font-medium [&::-webkit-details-marker]:hidden"
			>
				{section.title}
				<ChevronDown
					class="text-muted-foreground size-3.5 opacity-0 transition group-not-open:-rotate-90 group-not-open:opacity-100 group-hover:opacity-100"
				/>
			</summary>
			<ul class="border-border mt-2 border-l">
				{#each section.links as link (link.href)}
					{@const active = page.url.pathname === link.href}
					<li>
						<a
							href={link.href}
							aria-current={active ? 'page' : undefined}
							class="-ml-px block border-l py-1 pl-3 text-sm transition {active
								? 'border-primary text-foreground font-medium'
								: 'text-muted-foreground hover:text-foreground hover:border-input border-transparent'}"
						>
							{link.label}
						</a>
					</li>
				{/each}
			</ul>
		</details>
	{/each}
</nav>
