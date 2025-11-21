<script lang="ts">
	import { fade, slide } from 'svelte/transition';
	import { quintOut } from 'svelte/easing';
	import Button from './Ui/Button.svelte';

	type Props = {
		errorMessage: string | null;
		warnings: string[];
		computeErrors: string[];
		showMessages: boolean;
		onShowMessagesToggle: (show: boolean) => void;
		onDismissMessage: (type: 'error' | 'warning' | 'computeError', index?: number) => void;
		onClearAllMessages: () => void;
	};

	let {
		errorMessage,
		warnings,
		computeErrors,
		showMessages,
		onShowMessagesToggle,
		onDismissMessage,
		onClearAllMessages
	}: Props = $props();

	const hasMessages = $derived(errorMessage || warnings.length > 0 || computeErrors.length > 0);
	const totalMessages = $derived((errorMessage ? 1 : 0) + warnings.length + computeErrors.length);
</script>

<!-- Messages Overlay -->
{#if showMessages && hasMessages}
	<div
		class="absolute right-4 top-4 z-50 w-96 max-w-[calc(100vw-2rem)]"
		transition:fade={{ duration: 200, easing: quintOut }}
	>
		<div class="space-y-3">
			<!-- Header with Toggle -->
			<div
				class="flex items-center justify-between rounded-lg border border-gray-200 bg-white/95 px-4 py-2 shadow-lg backdrop-blur-sm"
			>
				<div class="flex items-center gap-2">
					<div class="flex h-6 w-6 items-center justify-center rounded-full bg-red-100">
						<svg class="h-3 w-3 text-red-600" fill="currentColor" viewBox="0 0 20 20">
							<path
								fill-rule="evenodd"
								d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
								clip-rule="evenodd"
							/>
						</svg>
					</div>
					<span class="text-sm font-medium text-gray-700">
						{totalMessages}
						{totalMessages === 1 ? 'Message' : 'Messages'}
					</span>
				</div>
				<div class="flex items-center gap-2">
					<Button onclick={onClearAllMessages}>Clear All</Button>
					<Button onclick={() => onShowMessagesToggle(false)}>
						<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M19 9l-7 7-7-7"
							/>
						</svg>
					</Button>
				</div>
			</div>

			<!-- Messages Container -->
			<div
				class="scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-transparent max-h-96 space-y-2 overflow-y-auto"
			>
				<!-- Network/API Errors -->
				{#if errorMessage}
					<div
						class="group rounded-lg border border-red-200 bg-red-50/80 p-4 shadow-sm backdrop-blur-sm transition-all hover:shadow-md"
						transition:slide={{ duration: 300, easing: quintOut }}
					>
						<div class="flex items-start gap-3">
							<div class="mt-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-red-100">
								<svg class="h-3 w-3 text-red-600" fill="currentColor" viewBox="0 0 20 20">
									<path
										fill-rule="evenodd"
										d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
										clip-rule="evenodd"
									/>
								</svg>
							</div>
							<div class="min-w-0 flex-1">
								<div class="flex items-center gap-2">
									<h3 class="text-sm font-semibold text-red-800">Network Error</h3>
									<span
										class="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700"
									>
										Critical
									</span>
								</div>
								<p class="wrap-break-word mt-1 text-sm text-red-700">{errorMessage}</p>
							</div>
							<Button onclick={() => onDismissMessage('error')}>
								<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M6 18L18 6M6 6l12 12"
									/>
								</svg>
							</Button>
						</div>
					</div>
				{/if}

				<!-- Compute Errors -->
				{#each computeErrors as error, index}
					<div
						class="group rounded-lg border border-red-200 bg-red-50/80 p-4 shadow-sm backdrop-blur-sm transition-all hover:shadow-md"
						transition:slide={{ duration: 300, easing: quintOut }}
					>
						<div class="flex items-start gap-3">
							<div class="mt-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-red-100">
								<svg class="h-3 w-3 text-red-600" fill="currentColor" viewBox="0 0 20 20">
									<path
										fill-rule="evenodd"
										d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
										clip-rule="evenodd"
									/>
								</svg>
							</div>
							<div class="min-w-0 flex-1">
								<div class="flex items-center gap-2">
									<h3 class="text-sm font-semibold text-red-800">Compute Error</h3>
									<span
										class="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700"
									>
										#{index + 1}
									</span>
								</div>
								<p class="wrap-break-word mt-1 text-sm text-red-700">{error}</p>
							</div>
							<Button onclick={() => onDismissMessage('computeError', index)}>
								<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M6 18L18 6M6 6l12 12"
									/>
								</svg>
							</Button>
						</div>
					</div>
				{/each}

				<!-- Warnings -->
				{#each warnings as warning, index}
					<div
						class="group rounded-lg border border-amber-200 bg-amber-50/80 p-4 shadow-sm backdrop-blur-sm transition-all hover:shadow-md"
						transition:slide={{ duration: 300, easing: quintOut }}
					>
						<div class="flex items-start gap-3">
							<div
								class="mt-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-amber-100"
							>
								<svg class="h-3 w-3 text-amber-600" fill="currentColor" viewBox="0 0 20 20">
									<path
										fill-rule="evenodd"
										d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
										clip-rule="evenodd"
									/>
								</svg>
							</div>
							<div class="min-w-0 flex-1">
								<div class="flex items-center gap-2">
									<h3 class="text-sm font-semibold text-amber-800">Warning</h3>
									<span
										class="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700"
									>
										#{index + 1}
									</span>
								</div>
								<p class="wrap-break-word mt-1 text-sm text-amber-700">{warning}</p>
							</div>
							<Button onclick={() => onDismissMessage('warning', index)}>
								<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M6 18L18 6M6 6l12 12"
									/>
								</svg>
							</Button>
						</div>
					</div>
				{/each}
			</div>
		</div>
	</div>
{/if}

<!-- Minimized Messages Indicator -->
{#if !showMessages && hasMessages}
	<div class="absolute right-4 top-4 z-50" transition:fade={{ duration: 500, easing: quintOut }}>
		<Button onclick={() => onShowMessagesToggle(true)}>
			<svg
				class="h-5 w-5 group-hover:animate-pulse"
				fill="none"
				stroke="currentColor"
				viewBox="0 0 24 24"
			>
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					stroke-width="2"
					d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z"
				/>
			</svg>
			<span
				class="absolute -right-2 -top-2 flex h-6 w-6 animate-bounce items-center justify-center rounded-full bg-white text-xs font-bold text-red-600 shadow-md"
			>
				{totalMessages}
			</span>
			<!-- Ripple effect with custom slow ping -->
			<!-- <span class="slow-ping absolute inset-0 z-0 rounded-full bg-red-400 opacity-75"></span> -->
		</Button>
	</div>
{/if}

<style>
	.scrollbar-thin {
		scrollbar-width: thin;
	}

	.scrollbar-thumb-gray-300::-webkit-scrollbar-thumb {
		background-color: rgb(209 213 219);
		border-radius: 9999px;
	}

	.scrollbar-track-transparent::-webkit-scrollbar-track {
		background-color: transparent;
	}

	.scrollbar-thin::-webkit-scrollbar {
		width: 6px;
	}
</style>
