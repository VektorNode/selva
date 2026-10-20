<script lang="ts">
	// The message centre: every message the last solve raised, reached from the footer badge.
	//
	// The counterpart to `SolveMessages`, which interrupts only for what the definition's author
	// wrote. Everything else — Grasshopper complaining about its own components — lands here,
	// where it is available without being in the way. Most severe first, with the component that
	// raised each message on its own line rather than spliced into its text.

	import type { Snippet } from 'svelte';
	import type { SolveDiagnostic } from '@selvajs/solve/shared';
	import * as Dialog from '$lib/components/primitives/dialog';
	import IssueList, { type Issue } from '$lib/components/primitives/IssueList.svelte';
	import { getLocaleContext } from '$lib/i18n/localeContext.svelte';
	import { formatCount } from '$lib/i18n/messages';

	interface Props {
		/** The last solve's messages. Preferred over `errors`/`warnings` when both are given. */
		diagnostics?: SolveDiagnostic[];
		/** Fallback for hosts that only have the flat text. */
		errors?: string[];
		warnings?: string[];
		/** Renders inside Dialog.Trigger. */
		trigger: Snippet;
	}

	let { diagnostics, errors = [], warnings = [], trigger }: Props = $props();

	const locale = getLocaleContext();
	const t = $derived(locale.messages);

	let open = $state(false);

	const rows = $derived<SolveDiagnostic[]>(
		diagnostics?.length
			? diagnostics
			: [
					...errors.map((message) => ({ level: 'error' as const, message })),
					...warnings.map((message) => ({ level: 'warning' as const, message }))
				]
	);

	interface Item {
		level: SolveDiagnostic['level'];
		message: string;
		source?: string;
		count: number;
	}

	const levels = $derived([
		{ level: 'error', severity: 'error', one: t.errorCountOne, other: t.errorCountOther },
		{ level: 'warning', severity: 'warning', one: t.warningCountOne, other: t.warningCountOther },
		{ level: 'remark', severity: 'note', one: t.noteCountOne, other: t.noteCountOther }
	] as const);

	/**
	 * One section per level that has messages, most severe first; within a level, the order the
	 * solve raised them. Repeats collapse into one row with a count: a definition fanning over 200
	 * branches raises the same warning 200 times, and an unstacked list buries every other message.
	 */
	const sections = $derived(
		levels
			.map((meta) => {
				// A null-prototype object rather than a Map: a local built fresh on each derive, never
				// reactive state, and the lint rule that steers Map → SvelteMap cannot tell them apart.
				const byKey: Record<string, Item> = Object.create(null);
				const items: Item[] = [];
				for (const d of rows) {
					if (d.level !== meta.level) continue;
					const key = `${d.message} ${d.source ?? ''}`;
					if (byKey[key]) {
						byKey[key].count++;
					} else {
						byKey[key] = { level: d.level, message: d.message, source: d.source, count: 1 };
						items.push(byKey[key]);
					}
				}
				return { ...meta, items };
			})
			.filter((section) => section.items.length > 0)
	);

	const issues = $derived<Issue[]>(
		sections.flatMap((section) =>
			section.items.map((item) => ({
				severity: section.severity,
				message: item.message,
				source: item.source,
				count: item.count
			}))
		)
	);
</script>

<Dialog.Root bind:open>
	<Dialog.Trigger>
		{@render trigger()}
	</Dialog.Trigger>

	<Dialog.Content class="max-w-lg">
		<Dialog.Header>
			<Dialog.Title>{t.messagesTitle}</Dialog.Title>
			<Dialog.Description>
				{#each sections as section, i (section.level)}
					{#if i > 0}<span class="mx-1.5">·</span>{/if}
					<span>{formatCount(section.items.length, section.one, section.other)}</span>
				{/each}
			</Dialog.Description>
		</Dialog.Header>

		<IssueList {issues} />
	</Dialog.Content>
</Dialog.Root>
