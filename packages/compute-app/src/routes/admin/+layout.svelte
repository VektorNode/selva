<script lang="ts">
	import { page } from '$app/stores';
	import { enhance } from '$app/forms';
	import { Button, PageHeader } from 'selva-shared';

	interface LayoutProps {
		children?: import('svelte').Snippet;
	}

	let { children }: LayoutProps = $props();

	const navItems = [
		{ href: '/admin', label: 'Definitions' },
		{ href: '/admin/users', label: 'Users' },
		{ href: '/admin/compute', label: 'Compute' }
	];

	const isActive = (href: string) =>
		href === '/admin'
			? $page.url.pathname === '/admin'
			: $page.url.pathname.startsWith(href);
</script>

{#if $page.url.pathname.startsWith('/admin/login')}
	{@render children?.()}
{:else}
	<div class="bg-background min-h-screen">
		<PageHeader title="Selva Admin" showModeToggle={true}>
			{#snippet rightContent()}
				<form method="POST" action="/admin/logout" use:enhance>
					<Button type="submit" variant="destructive" size="sm">Logout</Button>
				</form>
			{/snippet}
		</PageHeader>

		<!-- Nav tabs -->
		<div class="border-b">
			<nav class="mx-auto flex max-w-7xl gap-1 px-6 sm:px-6 lg:px-8">
				{#each navItems as item (item.href)}
					<a
						href={item.href}
						class="border-b-2 px-3 py-3 text-sm font-medium transition-colors {isActive(item.href)
							? 'border-primary text-foreground'
							: 'border-transparent text-muted-foreground hover:text-foreground'}"
					>
						{item.label}
					</a>
				{/each}
			</nav>
		</div>

		<main class="mx-auto max-w-7xl py-6 sm:px-6 lg:px-8">
			{@render children?.()}
		</main>
	</div>
{/if}
