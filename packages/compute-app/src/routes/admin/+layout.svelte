<script lang="ts">
	import { page } from '$app/stores';
	import { enhance } from '$app/forms';

	interface LayoutProps {
		children?: import('svelte').Snippet;
	}

	let { children }: LayoutProps = $props();
</script>

{#if $page.url.pathname.startsWith('/admin/login')}
	{@render children?.()}
{:else}
	<div class="min-h-screen bg-gray-100">
		<nav class="bg-white shadow-sm">
			<div class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
				<div class="flex h-16 justify-between">
					<div class="flex items-center">
						<h1 class="text-xl font-bold text-gray-900">Selva Admin Dashboard</h1>
					</div>
					<div class="flex items-center">
						<form method="POST" action="/admin/logout" use:enhance>
							<button
								type="submit"
								class="inline-flex items-center rounded-md border border-transparent bg-red-600 px-3 py-2 text-sm leading-4 font-medium text-white hover:bg-red-700 focus:ring-2 focus:ring-red-500 focus:ring-offset-2 focus:outline-none"
							>
								Logout
							</button>
						</form>
					</div>
				</div>
			</div>
		</nav>

		<main class="mx-auto max-w-7xl py-6 sm:px-6 lg:px-8">
			{@render children?.()}
		</main>
	</div>
{/if}
