<script lang="ts">
	import { enhance } from '$app/forms';

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

<div class="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-12 sm:px-6 lg:px-8">
	<div class="w-full max-w-md space-y-8">
		<div>
			<h2 class="mt-6 text-center text-3xl font-extrabold text-gray-900">Admin Login</h2>
			<p class="mt-2 text-center text-sm text-gray-600">Enter your admin password to continue</p>
		</div>
		<form method="POST" use:enhance class="mt-8 space-y-6">
			{#if form?.error}
				<div class="rounded-md bg-red-50 p-4">
					<p class="text-sm text-red-800">{form.error}</p>
				</div>
			{/if}

			<div class="-space-y-px rounded-md shadow-sm">
				<div>
					<label for="password" class="sr-only">Password</label>
					<input
						id="password"
						name="password"
						type="password"
						required
						class="relative block w-full appearance-none rounded-md border border-gray-300 px-3 py-2 text-gray-900 placeholder-gray-500 focus:z-10 focus:border-indigo-500 focus:ring-indigo-500 focus:outline-none sm:text-sm"
						placeholder="Admin password"
					/>
				</div>
			</div>

			<div>
				<button
					type="submit"
					class="group relative flex w-full justify-center rounded-md border border-transparent bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:outline-none"
				>
					Sign in
				</button>
			</div>
		</form>
	</div>
</div>
