<script lang="ts">
	import { Button, Card, AlertDialog } from '@selvajs/ui';
	import {
		RefreshCw,
		CircleCheck,
		Info,
		TriangleAlert,
		CircleX,
		ArrowUpCircle
	} from '@lucide/svelte';
	import { deriveOutcome, type OutcomeSeverity } from '$lib/update-outcome';

	interface Props {
		currentVersion?: string;
		latestVersion?: string | null;
		updateAvailable?: boolean;
		channel?: 'stable' | 'beta';
		isRunning?: boolean;
		isRestarting?: boolean;
		logs?: string;
		exitCode?: number | null;
		onRun?: () => void;
	}

	let {
		currentVersion,
		latestVersion = null,
		updateAvailable = false,
		channel = 'stable',
		isRunning = false,
		isRestarting = false,
		logs = '',
		exitCode = null,
		onRun
	}: Props = $props();

	const channelLabel = $derived(channel === 'beta' ? 'beta' : 'stable');

	let logEl = $state<HTMLPreElement>();
	let showRunConfirm = $state(false);

	// Only classify once the run has finished (exitCode set). While running we
	// show live progress instead, so a transient mid-run log line can't be
	// misread as a final verdict.
	let outcome = $derived(exitCode === null ? null : deriveOutcome(exitCode, logs));

	const severityStyles: Record<
		OutcomeSeverity,
		{ text: string; border: string; bg: string; icon: typeof CircleCheck }
	> = {
		success: {
			text: 'text-success',
			border: 'border-success/40',
			bg: 'bg-success/10',
			icon: CircleCheck
		},
		info: {
			text: 'text-foreground',
			border: 'border-border',
			bg: 'bg-muted/50',
			icon: Info
		},
		warning: {
			text: 'text-warning',
			border: 'border-warning/40',
			bg: 'bg-warning/10',
			icon: TriangleAlert
		},
		critical: {
			text: 'text-destructive',
			border: 'border-destructive/40',
			bg: 'bg-destructive/10',
			icon: CircleX
		},
		pending: {
			text: 'text-muted-foreground',
			border: 'border-border',
			bg: 'bg-muted/50',
			icon: RefreshCw
		}
	};

	$effect(() => {
		// Auto-scroll to bottom whenever logs change
		if (logs && logEl) {
			logEl.scrollTop = logEl.scrollHeight;
		}
	});

	function buttonLabel() {
		if (isRestarting) return 'Restarting & verifying…';
		if (isRunning) return 'Running…';
		return 'Run Update';
	}

	function handleRunClick() {
		showRunConfirm = true;
	}

	function confirmRun() {
		showRunConfirm = false;
		onRun?.();
	}
</script>

<Card.Root>
	<Card.Header>
		<div class="flex items-start justify-between gap-3">
			<Card.Title>Application Update</Card.Title>
			{#if currentVersion}
				<span
					class="rounded-full border px-2 py-0.5 font-mono text-xs {updateAvailable
						? 'border-warning/40 bg-warning/10 text-warning'
						: 'border-border bg-muted text-muted-foreground'}"
					title="Currently installed @selvajs/selva version"
				>
					v{currentVersion}
				</span>
			{/if}
		</div>
		<Card.Description
			>Update @selvajs/* to the latest <span class="font-medium">{channelLabel}</span> release and restart</Card.Description
		>
	</Card.Header>
	<Card.Content class="space-y-4">
		{#if updateAvailable && latestVersion}
			<div
				class="border-warning/40 bg-warning/10 text-warning flex items-center gap-2 rounded-md border px-3 py-2 text-sm"
				role="status"
			>
				<ArrowUpCircle class="h-4 w-4 shrink-0" />
				<span>
					{channelLabel} release available — <span class="font-mono">v{currentVersion}</span> →
					<span class="font-mono">v{latestVersion}</span>
				</span>
			</div>
		{:else if currentVersion && latestVersion}
			<p class="text-muted-foreground text-sm">
				You're on the latest {channelLabel} release (<span class="font-mono">v{currentVersion}</span
				>).
			</p>
		{/if}
		<Button onclick={handleRunClick} disabled={isRunning} variant="destructive">
			{buttonLabel()}
		</Button>
		{#if isRestarting && exitCode === null}
			<div
				class="border-border bg-muted/50 text-muted-foreground flex items-center gap-2 rounded-md border px-3 py-2 text-sm"
			>
				<RefreshCw class="h-4 w-4 animate-spin" />
				<span>PM2 is restarting the app — waiting for the new process to come online…</span>
			</div>
		{/if}
		{#if outcome}
			{@const style = severityStyles[outcome.severity]}
			{@const Icon = style.icon}
			<div
				class="flex items-start gap-3 rounded-md border px-3 py-3 {style.border} {style.bg}"
				role={outcome.severity === 'critical' ? 'alert' : 'status'}
				aria-live={outcome.severity === 'critical' ? 'assertive' : 'polite'}
			>
				<Icon class="mt-0.5 h-5 w-5 shrink-0 {style.text}" />
				<div class="min-w-0 space-y-1">
					<p class="text-sm font-medium {style.text}">{outcome.title}</p>
					{#if outcome.from && outcome.to && outcome.from !== outcome.to}
						<p class="text-muted-foreground font-mono text-xs">
							{outcome.from} → {outcome.to}
						</p>
					{/if}
					{#if outcome.detail}
						<p class="text-muted-foreground text-xs whitespace-pre-line">{outcome.detail}</p>
					{/if}
				</div>
			</div>
		{/if}

		{#if logs}
			<div class="space-y-2">
				<h4 class="text-sm font-medium">Update Logs</h4>
				<pre
					bind:this={logEl}
					class="bg-muted text-foreground max-h-96 overflow-auto rounded-md p-4 font-mono text-xs">{logs}</pre>
			</div>
		{/if}
	</Card.Content>
</Card.Root>

<AlertDialog.Root open={showRunConfirm} onOpenChange={(o) => (showRunConfirm = o)}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Run Update?</AlertDialog.Title>
			<AlertDialog.Description>
				This will update @selvajs/* to the latest {channelLabel} release and restart the application.
				The service will be temporarily unavailable.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action onclick={confirmRun} disabled={isRunning}>Continue</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
