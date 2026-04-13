<script lang="ts">
	import { Button, Input, Label, Alert } from 'selva-shared';
	import { AlertCircle } from '@lucide/svelte';

	interface ActionData {
		error?: string;
	}

	interface Props {
		form?: ActionData;
	}

	let { form }: Props = $props();
</script>

<svelte:head>
	<title>Admin Login - Selva Compute</title>
</svelte:head>

<div class="bg-background flex min-h-screen items-center justify-center px-4 py-12 sm:px-6 lg:px-8">
	<div class="w-full max-w-sm space-y-6">
		<div class="space-y-1 text-center">
			<h2 class="text-foreground text-2xl font-bold tracking-tight">Admin Login</h2>
			<p class="text-muted-foreground text-sm">Enter your admin password to continue</p>
		</div>

		<form method="POST" class="space-y-4">
			{#if form?.error}
				<Alert.Root variant="destructive">
					<AlertCircle />
					<Alert.Description>{form.error}</Alert.Description>
				</Alert.Root>
			{/if}

			<div class="space-y-2">
				<Label for="password">Password</Label>
				<Input
					id="password"
					name="password"
					type="password"
					required
					placeholder="Admin password"
				/>
			</div>

			<Button type="submit" class="w-full">Sign in</Button>
		</form>
	</div>
</div>
