<script lang="ts">
	import { page } from '$app/state';
	import { Button, Input, Label, Alert } from 'selva-shared';
	import { CircleAlert } from '@lucide/svelte';

	interface ActionData {
		error?: string;
	}

	interface Props {
		form?: ActionData;
	}

	let { form }: Props = $props();

	const redirectTo = $derived(page.url.searchParams.get('redirectTo') ?? '');
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

		<form method="POST" class="space-y-4">
			{#if redirectTo}
				<input type="hidden" name="redirectTo" value={redirectTo} />
			{/if}
			{#if form?.error}
				<Alert.Root variant="destructive">
					<CircleAlert />
					<Alert.Description>{form.error}</Alert.Description>
				</Alert.Root>
			{/if}

			<div class="space-y-2">
				<Label for="email">Email</Label>
				<Input id="email" name="email" type="email" required placeholder="admin@example.com" />
			</div>

			<div class="space-y-2">
				<Label for="password">Password</Label>
				<Input id="password" name="password" type="password" required placeholder="Password" />
			</div>

			<Button type="submit" class="w-full">Sign in</Button>
		</form>
	</div>
</div>
