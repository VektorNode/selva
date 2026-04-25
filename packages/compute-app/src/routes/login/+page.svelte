<script lang="ts">
	import { page } from '$app/state';
	import { Button, Input, Label, Alert } from 'selva-shared';
	import { CircleAlert } from '@lucide/svelte';

	interface ActionData {
		error?: string;
	}

	interface PageData {
		hasPasswordAuth: boolean;
		oauthProviders: string[];
	}

	interface Props {
		form?: ActionData;
		data: PageData;
	}

	let { form, data }: Props = $props();

	const redirectTo = $derived(page.url.searchParams.get('redirectTo') ?? '');

	function oauthHref(provider: string): string {
		// Plain string concatenation — `URLSearchParams` triggers a Svelte
		// reactivity lint warning, and we don't need reactivity for a static
		// link href.
		const qs = `provider=${encodeURIComponent(provider)}${
			redirectTo ? `&redirectTo=${encodeURIComponent(redirectTo)}` : ''
		}`;
		return `/auth/supabase/start?${qs}`;
	}

	function providerLabel(p: string): string {
		const labels: Record<string, string> = {
			google: 'Google',
			github: 'GitHub',
			azure: 'Microsoft',
			gitlab: 'GitLab'
		};
		return labels[p] ?? p;
	}
</script>

<svelte:head>
	<title>Login - Selva Compute</title>
</svelte:head>

<div class="bg-background flex min-h-screen items-center justify-center px-4 py-12 sm:px-6 lg:px-8">
	<div class="w-full max-w-sm space-y-6">
		<div class="space-y-1 text-center">
			<h2 class="text-foreground text-2xl font-bold tracking-tight">Sign in</h2>
			<p class="text-muted-foreground text-sm">Sign in to your account</p>
		</div>

		{#if form?.error}
			<Alert.Root variant="destructive">
				<CircleAlert />
				<Alert.Description>{form.error}</Alert.Description>
			</Alert.Root>
		{/if}

		{#if data.oauthProviders.length > 0}
			<div class="space-y-2">
				{#each data.oauthProviders as provider (provider)}
					<a href={oauthHref(provider)} class="block">
						<Button type="button" variant="outline" class="w-full">
							Continue with {providerLabel(provider)}
						</Button>
					</a>
				{/each}
			</div>
		{/if}

		{#if data.hasPasswordAuth && data.oauthProviders.length > 0}
			<div class="text-muted-foreground flex items-center gap-2 text-xs uppercase">
				<div class="bg-border h-px flex-1"></div>
				<span>or</span>
				<div class="bg-border h-px flex-1"></div>
			</div>
		{/if}

		{#if data.hasPasswordAuth}
			<form method="POST" class="space-y-4">
				{#if redirectTo}
					<input type="hidden" name="redirectTo" value={redirectTo} />
				{/if}

				<div class="space-y-2">
					<Label for="email">Email</Label>
					<Input id="email" name="email" type="email" required placeholder="admin@example.com" />
				</div>

				<div class="space-y-2">
					<Label for="password">Password</Label>
					<Input
						id="password"
						name="password"
						type="password"
						required
						placeholder="Password"
					/>
				</div>

				<Button type="submit" class="w-full">Sign in</Button>
			</form>
		{/if}

		{#if !data.hasPasswordAuth && data.oauthProviders.length === 0}
			<Alert.Root variant="destructive">
				<CircleAlert />
				<Alert.Description>
					No login methods are configured. Set up an auth provider before signing in.
				</Alert.Description>
			</Alert.Root>
		{/if}
	</div>
</div>
