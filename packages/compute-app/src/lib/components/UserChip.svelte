<script lang="ts">
	import { page } from '$app/state';
	import { enhance } from '$app/forms';

	import { LogIn, LogOut } from '@lucide/svelte';

	const user = $derived((page.data as { user?: { id: string; email?: string; displayName?: string } | null }).user ?? null);

	const label = $derived(
		user?.displayName ?? user?.email?.split('@')[0] ?? user?.id ?? ''
	);

	const initial = $derived(label[0]?.toUpperCase() ?? '');

	const loginHref = $derived(
		`/login?redirectTo=${encodeURIComponent(page.url.pathname + page.url.search)}`
	);
</script>

{#if user}
	<div class="flex items-center gap-2">
		<div class="bg-primary text-primary-foreground flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold">
			{initial}
		</div>
		<span class="text-muted-foreground hidden max-w-40 truncate text-sm sm:block">
			{label}
		</span>
		<form method="POST" action="/logout" use:enhance>
			<button
				type="submit"
				title="Log out"
				class="text-muted-foreground hover:text-foreground ml-1 transition-colors"
			>
				<LogOut class="h-4 w-4" />
			</button>
		</form>
	</div>
{:else}
	<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
	<a
		href={loginHref}
		class="text-muted-foreground hover:text-foreground flex items-center gap-1.5 text-sm transition-colors"
	>
		<LogIn class="h-4 w-4" />
		<span class="hidden sm:block">Log in</span>
	</a>
{/if}
