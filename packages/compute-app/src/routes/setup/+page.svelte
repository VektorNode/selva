<script lang="ts">
	import { Button, Input, Label, Alert } from '@selvajs/shared';
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

	function oauthHref(provider: string): string {
		// First-OAuth-signin-becomes-admin: the callback grants instance_admin
		// when no admin exists yet. Plain string concat — Svelte's lint flags
		// a mutable URLSearchParams here.
		return `/auth/supabase/start?provider=${encodeURIComponent(provider)}&redirectTo=%2Fadmin`;
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
	<title>Setup - Selva Compute</title>
</svelte:head>

<div class="bg-background flex min-h-screen items-center justify-center px-4 py-12 sm:px-6 lg:px-8">
	<div class="w-full max-w-sm space-y-6">
		<div class="space-y-1 text-center">
			<h2 class="text-foreground text-2xl font-bold tracking-tight">Create Admin Account</h2>
			<p class="text-muted-foreground text-sm">
				No users found. Set up your platform admin account to get started.
			</p>
		</div>

		{#if form?.error}
			<Alert.Root variant="destructive">
				<CircleAlert />
				<Alert.Description>{form.error}</Alert.Description>
			</Alert.Root>
		{/if}

		{#if data.oauthProviders.length > 0}
			<div class="space-y-2">
				<p class="text-muted-foreground text-center text-xs">
					The first user to sign in becomes the platform admin.
				</p>
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
				<div class="space-y-2">
					<Label for="companyName">Company name</Label>
					<Input id="companyName" name="companyName" type="text" required placeholder="Acme Corp" />
				</div>

				<div class="space-y-2">
					<Label for="displayName">Display name</Label>
					<Input id="displayName" name="displayName" type="text" placeholder="Jane Smith" />
				</div>

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
						placeholder="Min. 8 characters"
					/>
				</div>

				<div class="space-y-2">
					<Label for="confirm">Confirm Password</Label>
					<Input
						id="confirm"
						name="confirm"
						type="password"
						required
						placeholder="Repeat password"
					/>
				</div>

				<Button type="submit" class="w-full">Create Account</Button>
			</form>
		{/if}

		{#if !data.hasPasswordAuth && data.oauthProviders.length === 0}
			<Alert.Root variant="destructive">
				<CircleAlert />
				<Alert.Description>
					No setup methods are configured. Configure password auth or OAuth providers before
					bootstrapping the first admin.
				</Alert.Description>
			</Alert.Root>
		{/if}
	</div>
</div>
