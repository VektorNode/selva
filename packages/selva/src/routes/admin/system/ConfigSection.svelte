<script lang="ts">
	import { Callout, Search, Switch } from '@selvajs/ui';
	import { Check, ChevronRight, Copy } from '@lucide/svelte';
	import type {
		ConfigChange,
		ConfigReport,
		KeyRotation,
		ReportRow
	} from '@selvajs/platform/config';
	import type { ConfigCheck } from '$lib/server/config/checks';

	let {
		report,
		changes,
		rotation,
		proxied,
		checks
	}: {
		report: ConfigReport;
		changes: ConfigChange[];
		rotation: KeyRotation[];
		proxied: boolean;
		checks: ConfigCheck[];
	} = $props();

	const problems = $derived(checks.filter((c) => c.level !== 'info'));
	const notes = $derived(checks.filter((c) => c.level === 'info'));
	const flagged = $derived(new Set(problems.flatMap((c) => c.keys)));

	const rotating = $derived(
		new Set(rotation.filter((r) => r.state !== 'none').map((r) => `${r.key}_PREVIOUS`))
	);
	const PROXY_KEYS = ['ADDRESS_HEADER', 'XFF_DEPTH'];

	// Each group answers one question an admin has. A row a group doesn't show (an idle rotation
	// slot, proxy headers without a proxy) still appears under "All settings".
	const groups = $derived.by(() => {
		const byKey = new Map(report.rows.map((r) => [r.key, r]));
		const pick = (keys: string[]) => keys.flatMap((k) => byKey.get(k) ?? []);
		return [
			{
				title: 'Reaching your server',
				rows: pick([
					'ORIGIN',
					'HOST',
					'BODY_SIZE_LIMIT',
					...PROXY_KEYS.filter((k) => proxied || (byKey.get(k)?.source ?? 'unset') !== 'unset')
				])
			},
			{
				title: 'Where data lives',
				rows: pick([
					'SELVA_DATA_PROVIDER',
					'SELVA_STORAGE_PROVIDER',
					'DATA_PATH',
					'SUPABASE_URL',
					'SELVA_TENANCY'
				])
			},
			{
				title: 'Sign-in',
				rows: pick([
					'SELVA_AUTH_PROVIDER',
					'SIGN_IN_MAX_AGE_DAYS',
					'BOOTSTRAP_INSTANCE_ADMIN_EMAIL'
				])
			},
			{
				title: 'Security keys',
				rows: pick(
					[
						'SELVA_HMAC_KEY',
						'SELVA_HMAC_KEY_PREVIOUS',
						'SELVA_AT_REST_KEY',
						'SELVA_AT_REST_KEY_PREVIOUS'
					].filter((k) => !k.endsWith('_PREVIOUS') || rotating.has(k))
				)
			}
		].filter((g) => g.rows.length > 0);
	});

	let showUntouched = $state(false);
	let allOpen = $state(false);
	const isConfigured = (r: ReportRow) =>
		!!r.problem || (r.source !== 'unset' && r.source !== 'default');
	const untouchedCount = $derived(report.rows.filter((r) => !isConfigured(r)).length);
	const allRows = $derived(showUntouched ? report.rows : report.rows.filter(isConfigured));

	let query = $state('');
	const matches = $derived.by(() => {
		const q = query.trim().toLowerCase();
		if (!q) return [];
		return report.rows.filter((r) =>
			[r.key, r.label ?? '', r.description, r.display].some((s) => s.toLowerCase().includes(q))
		);
	});

	// ==========================================================================
	// Values as meaning
	// ==========================================================================

	type Shown = {
		text: string;
		tone: 'value' | 'muted' | 'ok' | 'bad';
		mono: boolean;
		title?: string;
	};

	function shown(r: ReportRow): Shown {
		if (r.source === 'unset') {
			return r.required
				? { text: 'Missing', tone: 'bad', mono: false }
				: { text: 'Not set', tone: 'muted', mono: false };
		}
		if (r.display === 'set' || r.display.startsWith('sha256:')) {
			// A fingerprint tells two servers' keys apart; it isn't something to read.
			return {
				text: 'Set',
				tone: 'ok',
				mono: false,
				title: r.display === 'set' ? undefined : r.display
			};
		}
		if (r.type === 'bool') {
			const on = ['true', '1', 'yes', 'on'].includes(r.display.toLowerCase());
			return { text: on ? 'On' : 'Off', tone: on ? 'ok' : 'muted', mono: false };
		}
		if (r.type === 'list' && r.display === '') return { text: 'None', tone: 'muted', mono: false };
		if (r.type === 'int') {
			const n = Number(r.display);
			if (n === 0 && r.zero) return { text: r.zero, tone: 'muted', mono: false };
			if (Number.isFinite(n) && r.unit)
				return { text: withUnit(n, r.unit), tone: 'value', mono: false, title: r.display };
		}
		return { text: r.display || '—', tone: 'value', mono: true, title: r.display };
	}

	function withUnit(n: number, unit: NonNullable<ReportRow['unit']>): string {
		if (unit === 'days') return `${n} ${n === 1 ? 'day' : 'days'}`;
		if (unit === 'mb') return n >= 1024 ? `${+(n / 1024).toFixed(1)} GB` : `${n} MB`;
		if (unit === 'bytes') {
			if (n >= 1024 ** 3) return `${+(n / 1024 ** 3).toFixed(1)} GB`;
			if (n >= 1024 ** 2) return `${+(n / 1024 ** 2).toFixed(1)} MB`;
			return n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`;
		}
		if (n >= 3_600_000) return `${+(n / 3_600_000).toFixed(1)} h`;
		if (n >= 60_000) return `${+(n / 60_000).toFixed(1)} min`;
		if (n >= 1000) return `${+(n / 1000).toFixed(1)} s`;
		return `${n} ms`;
	}

	function sourceLabel(r: ReportRow): string {
		if (r.source === 'default') return 'default';
		if (r.source === 'alias') return `from ${r.alias}`;
		return 'set in .env';
	}

	const TONE: Record<Shown['tone'], string> = {
		value: 'bg-muted text-foreground',
		muted: 'text-muted-foreground',
		ok: 'text-success',
		bad: 'bg-destructive/10 text-destructive'
	};

	const ROTATE: Record<string, { name: string; arg: string; breaks: string }> = {
		SELVA_HMAC_KEY: {
			name: 'signing key',
			arg: 'hmac',
			breaks: 'Sessions, links and tokens signed with the old key keep working for 30 days.'
		},
		SELVA_AT_REST_KEY: {
			name: 'encryption key',
			arg: 'at-rest',
			breaks: 'Stored compute API keys are re-encrypted with the new key when the app restarts.'
		}
	};

	let copied = $state<string | null>(null);
	async function copy(text: string) {
		await navigator.clipboard.writeText(text);
		copied = text;
		setTimeout(() => {
			if (copied === text) copied = null;
		}, 1500);
	}
</script>

{#snippet commands(lines: string[])}
	<div class="bg-muted mt-2 flex items-start gap-2 rounded-md px-3 py-2">
		<pre
			class="text-foreground min-w-0 flex-1 overflow-x-auto font-mono text-xs leading-relaxed">{lines.join(
				'\n'
			)}</pre>
		<button
			type="button"
			class="text-faint-foreground hover:text-foreground hover:bg-hover -m-1 shrink-0 rounded-sm p-1"
			aria-label="Copy commands"
			onclick={() => copy(lines.join('\n'))}
		>
			{#if copied === lines.join('\n')}<Check class="size-3.5" />{:else}<Copy
					class="size-3.5"
				/>{/if}
		</button>
	</div>
{/snippet}

{#snippet configRow(row: ReportRow)}
	{@const v = shown(row)}
	<div class="px-4 py-3">
		<div class="flex items-start justify-between gap-4">
			<div class="min-w-0 flex-1">
				<p class="text-foreground flex items-center gap-1.5 text-sm leading-snug font-medium">
					{#if flagged.has(row.key)}
						<span class="bg-warning size-1.5 shrink-0 rounded-full" aria-label="Needs attention"
						></span>
					{/if}
					{row.label ?? row.key}
				</p>
				<p class="text-muted-foreground mt-0.5 text-xs leading-snug">{row.description}</p>
				<code class="text-faint-foreground text-2xs mt-1 block font-mono">{row.key}</code>
				{#if row.problem}
					<p class="text-destructive mt-1 text-xs">Value {row.problem}.</p>
				{/if}
			</div>
			<div class="flex shrink-0 flex-col items-end gap-1">
				<span
					class={`max-w-64 truncate rounded-sm px-2 py-0.5 text-xs ${v.mono ? 'font-mono' : 'font-medium'} ${TONE[v.tone]}`}
					title={v.title}
				>
					{#if v.tone === 'ok' && v.text === 'Set'}<Check
							class="mr-0.5 inline size-3 align-[-2px]"
						/>{/if}{v.text}
				</span>
				{#if row.source !== 'unset'}
					<span class="text-faint-foreground text-2xs">{sourceLabel(row)}</span>
				{/if}
			</div>
		</div>
		{#if ROTATE[row.key]}
			{@const r = ROTATE[row.key]}
			<details class="group mt-2">
				<summary
					class="text-muted-foreground hover:text-foreground flex w-fit cursor-pointer items-center gap-1 text-xs select-none"
				>
					<ChevronRight class="size-3 transition-transform group-open:rotate-90" />
					Change the {r.name}
				</summary>
				<div class="text-muted-foreground mt-2 space-y-1 pl-4 text-xs">
					<p>
						Do this if the key may have leaked, or as routine hygiene. On the server, in the install
						folder, run:
					</p>
					{@render commands([`npx selva keys rotate ${r.arg}`, 'npx selva restart'])}
					<p class="pt-1">
						{r.breaks} If the old key leaked and must stop working now, use
						<code class="font-mono">--leaked</code> instead; that signs everyone out.
					</p>
				</div>
			</details>
		{/if}
	</div>
{/snippet}

<div class="space-y-6">
	<section class="space-y-2">
		{#if problems.length === 0}
			<Callout tone="success" title="Nothing needs your attention">
				Every setting this server reads has a usable value.
			</Callout>
		{/if}
		{#each [...problems, ...notes] as c (c.id)}
			<Callout
				tone={c.level === 'error' ? 'danger' : c.level === 'warning' ? 'warning' : 'info'}
				title={c.title}
			>
				<p>{c.detail}</p>
				{#if c.fix}
					<p class="pt-1">To fix it, run on the server:</p>
					{@render commands(c.fix)}
				{/if}
			</Callout>
		{/each}
	</section>

	{#if changes.length > 0}
		<div class="space-y-1 rounded-lg border px-4 py-3 text-xs">
			<p class="font-medium">Changed since the last start</p>
			{#each changes as c (c.key)}
				<p class="text-muted-foreground">
					<code class="text-foreground font-mono">{c.key}</code>
					{#if c.change === 'added'}set{c.to !== undefined ? ` to ${c.to}` : ''}
					{:else if c.change === 'removed'}removed{c.from !== undefined ? ` (was ${c.from})` : ''}
					{:else if c.from !== undefined}{c.from} → {c.to}
					{:else}changed{/if}
				</p>
			{/each}
		</div>
	{/if}

	<Search bind:value={query} clearable placeholder="Search {report.rows.length} settings" />

	{#if query.trim()}
		<div class="divide-y rounded-lg border">
			{#each matches as row (row.key)}
				{@render configRow(row)}
			{:else}
				<p class="text-muted-foreground px-4 py-6 text-center text-sm">No setting matches.</p>
			{/each}
		</div>
	{:else}
		{#each groups as group (group.title)}
			<section class="space-y-2.5">
				<h3 class="text-foreground flex items-baseline gap-2 text-sm font-semibold">
					{group.title}
					{#if group.title === 'Reaching your server'}
						<span class="text-muted-foreground text-xs font-normal">
							{proxied
								? 'This request came through a reverse proxy.'
								: 'This request reached the app directly, without a proxy.'}
						</span>
					{/if}
				</h3>
				<div class="divide-y rounded-lg border">
					{#each group.rows as row (row.key)}
						{@render configRow(row)}
					{/each}
				</div>
			</section>
		{/each}

		<details class="group rounded-lg border" bind:open={allOpen}>
			<summary
				class="hover:bg-hover flex cursor-pointer items-center gap-2 rounded-lg px-4 py-3 text-sm font-semibold select-none"
			>
				<ChevronRight class="size-4 shrink-0 transition-transform group-open:rotate-90" />
				All settings
				<span class="text-muted-foreground text-xs font-normal"
					>for fine-tuning; most never need changing</span
				>
				<span class="text-muted-foreground ml-auto font-mono text-xs">{report.rows.length}</span>
			</summary>
			{#if allOpen}
				<div class="border-t">
					{#if untouchedCount > 0}
						<label
							class="text-muted-foreground flex cursor-pointer items-center gap-2 border-b px-4 py-2.5 text-xs"
						>
							<Switch bind:checked={showUntouched} />
							Include {untouchedCount} settings left at their default or unset
						</label>
					{/if}
					<div class="divide-y">
						{#each allRows as row (row.key)}
							{@render configRow(row)}
						{/each}
					</div>
				</div>
			{/if}
		</details>
	{/if}
</div>
