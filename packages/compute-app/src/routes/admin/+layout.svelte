<script lang="ts">
	import { page } from '$app/stores';
	import { enhance } from '$app/forms';
	import { Button, PageHeader } from 'selva-shared';

	interface LayoutProps {
		children?: import('svelte').Snippet;
	}

	let { children }: LayoutProps = $props();
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

		<main class="mx-auto max-w-7xl py-6 sm:px-6 lg:px-8">
			{@render children?.()}
		</main>
	</div>
{/if}
