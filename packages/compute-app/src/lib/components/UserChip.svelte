<script lang="ts">
	import { page } from '$app/state';
	import { enhance } from '$app/forms';

	import { LogIn, LogOut } from '@lucide/svelte';

	const pageData = $derived(
		page.data as {
			user?: { id: string; email?: string } | null;
			profile?: { displayName?: string } | null;
		}
	);
	const user = $derived(pageData.user ?? null);
	const profile = $derived(pageData.profile ?? null);

	const label = $derived(profile?.displayName ?? user?.email?.split('@')[0] ?? user?.id ?? '');

	const initial = $derived(label[0]?.toUpperCase() ?? '');

	const loginHref = $derived(
		`/login?redirectTo=${encodeURIComponent(page.url.pathname + page.url.search)}`
	);
</script>

{#if user}
	<div class="border-border bg-card flex items-center gap-px rounded-full border shadow-sm">
		<div class="flex items-center gap-2 py-1 pr-3 pl-1">
			<div
				class="bg-primary text-primary-foreground flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold"
			>
				{initial}
			</div>
			<span class="text-foreground hidden max-w-32 truncate text-sm font-medium sm:block"
				>{label}</span
			>
		</div>
		<div class="bg-border w-px self-stretch"></div>
		<form method="POST" action="/logout" use:enhance>
			<button
				type="submit"
				title="Log out"
				class="text-muted-foreground hover:text-foreground hover:bg-muted rounded-full p-2 transition-colors"
			>
				<LogOut class="h-3.5 w-3.5" />
			</button>
		</form>
	</div>
{:else}
	<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
	<a
		href={loginHref}
		class="border-border bg-card text-muted-foreground hover:text-foreground flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium shadow-sm transition-colors"
	>
		<LogIn class="h-3.5 w-3.5" />
		<span class="hidden sm:block">Log in</span>
	</a>
{/if}
