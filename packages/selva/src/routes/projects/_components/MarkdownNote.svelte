<script lang="ts">
	import { renderMarkdown } from '#lib/format/markdown.js';

	interface Props {
		source: string;
		class?: string;
	}

	let { source, class: className = '' }: Props = $props();

	// Safe for {@html}: renderMarkdown escapes the source before writing any tag.
	const html = $derived(renderMarkdown(source));
</script>

<div
	class="[&_a]:text-primary [&_blockquote]:text-muted-foreground [&_code]:bg-muted [&_pre]:bg-muted
		space-y-2 text-sm leading-relaxed break-words
		[&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:pl-3
		[&_code]:rounded-sm [&_code]:px-1 [&_code]:font-mono [&_code]:text-xs [&_h3]:text-base
		[&_h3]:font-semibold [&_h4]:font-semibold [&_h5]:font-medium [&_ol]:list-decimal [&_ol]:pl-5
		[&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:p-3 [&_pre_code]:bg-transparent
		[&_pre_code]:p-0 [&_ul]:list-disc [&_ul]:pl-5 {className}"
>
	<!-- eslint-disable-next-line svelte/no-at-html-tags -- renderMarkdown escapes its input first -->
	{@html html}
</div>
