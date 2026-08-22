<script lang="ts">
	import { Button, Callout, Card } from '@selvajs/ui';
	import { CircleCheck, TriangleAlert, CircleX, Minus, Stethoscope } from '@lucide/svelte';

	type CheckStatus = 'ok' | 'degraded' | 'not_applicable' | 'error';

	interface HealthCheck {
		id: string;
		label: string;
		status: CheckStatus;
		summary: string;
		remediation?: string;
	}

	interface HealthReport {
		overall: CheckStatus;
		checkedAt: string;
		checks: HealthCheck[];
	}

	let running = $state(false);
	let report = $state<HealthReport | null>(null);
	let error = $state<string | null>(null);

	const statusStyle: Record<
		CheckStatus,
		{ text: string; icon: typeof CircleCheck; label: string }
	> = {
		ok: { text: 'text-success', icon: CircleCheck, label: 'OK' },
		degraded: { text: 'text-warning', icon: TriangleAlert, label: 'Degraded' },
		error: { text: 'text-destructive', icon: CircleX, label: 'Error' },
		not_applicable: { text: 'text-muted-foreground', icon: Minus, label: 'N/A' }
	};

	async function runCheck() {
		running = true;
		error = null;
		try {
			const res = await fetch('/api/admin/system/health', { cache: 'no-store' });
			if (!res.ok) {
				error = `Health check request failed (HTTP ${res.status}).`;
				report = null;
				return;
			}
			report = (await res.json()) as HealthReport;
		} catch (err) {
			error = err instanceof Error ? err.message : 'Health check request failed.';
			report = null;
		} finally {
			running = false;
		}
	}
</script>

<Card.Root>
	<Card.Header>
		<Card.Title class="text-sm font-medium">System health</Card.Title>
		<Card.Description>
			Tests the things that break solving: compute server keys, the database schema, whether the
			default compute server answers, whether the data folder is writable, and the reverse-proxy and
			upload-limit settings that fail silently at runtime. Runs the checks fresh each time — after
			fixing something, run it again to confirm. Config changes need a restart first.
		</Card.Description>
	</Card.Header>
	<Card.Content class="space-y-4">
		<Button onclick={runCheck} disabled={running} variant="outline">
			<Stethoscope class="mr-2 h-4 w-4 {running ? 'animate-pulse' : ''}" />
			{running ? 'Checking…' : 'Run health check'}
		</Button>

		{#if error}
			<Callout tone="danger">{error}</Callout>
		{/if}

		{#if report}
			{@const overall = statusStyle[report.overall]}
			{@const OverallIcon = overall.icon}
			<div class="space-y-3">
				<div class="flex items-center gap-2 text-sm font-medium {overall.text}">
					<OverallIcon class="h-5 w-5" />
					<span>
						{report.overall === 'ok'
							? 'All checks passed'
							: report.overall === 'degraded'
								? 'Attention needed'
								: report.overall === 'error'
									? 'Check failed to run'
									: 'No applicable checks'}
					</span>
					<span class="text-muted-foreground ml-auto text-xs font-normal">
						{new Date(report.checkedAt).toLocaleTimeString()}
					</span>
				</div>

				<div class="divide-y rounded-lg border">
					{#each report.checks as check (check.id)}
						{@const style = statusStyle[check.status]}
						{@const Icon = style.icon}
						<div class="flex items-start gap-3 px-4 py-3">
							<Icon class="mt-0.5 h-4 w-4 shrink-0 {style.text}" />
							<div class="min-w-0 flex-1 space-y-1">
								<div class="flex items-center justify-between gap-2">
									<span class="text-sm font-medium">{check.label}</span>
									<span
										class="rounded-full border px-2 py-0.5 font-mono text-[10px] tracking-wide uppercase {style.text}"
									>
										{style.label}
									</span>
								</div>
								<p class="text-muted-foreground text-xs">{check.summary}</p>
								{#if check.remediation}
									<p class="text-foreground text-xs">{check.remediation}</p>
								{/if}
							</div>
						</div>
					{/each}
				</div>

				<p class="text-muted-foreground text-xs">
					This covers what the running app can see. Checks that need the host filesystem — that
					<span class="font-mono">.env</span> and the pm2 boot unit are in place, that no migration
					was interrupted, that the signing keys are real keys and not the shipped placeholder —
					only run from a shell on the server:
					<span class="text-foreground font-mono">npx selva doctor</span>
				</p>
			</div>
		{/if}
	</Card.Content>
</Card.Root>
