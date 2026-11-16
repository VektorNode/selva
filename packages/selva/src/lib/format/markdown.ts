// Markdown for version notes: the subset people write in a changelog, rendered to HTML safe for
// `{@html}`. Everything is HTML-escaped before any tag is added, so the only markup in the output
// is what this file writes, and links only ever point at http, https or mailto.
//
// Blocks: paragraphs, `#`–`###` headings, `-`/`*`/`1.` lists, `>` quotes, ``` fences.
// Inline: `code`, **bold**, *italic* or _italic_, ~~strike~~, [text](url).

const ESCAPES: Record<string, string> = {
	'&': '&amp;',
	'<': '&lt;',
	'>': '&gt;',
	'"': '&quot;',
	"'": '&#39;'
};

function escapeHtml(text: string): string {
	return text.replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

const SAFE_URL = /^(https?:\/\/|mailto:)/i;

// Code spans are parked behind a private-use character, which no note contains.
const PARK = '';
const PARKED = new RegExp(`${PARK}(\\d+)${PARK}`, 'g');

/** Runs on already-escaped text. */
function inline(escaped: string): string {
	const codes: string[] = [];
	let out = escaped.replace(/`([^`]+)`/g, (_m, code: string) => {
		codes.push(`<code>${code}</code>`);
		return `${PARK}${codes.length - 1}${PARK}`;
	});
	out = out
		.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, text: string, url: string) =>
			SAFE_URL.test(url)
				? `<a href="${url}" target="_blank" rel="noopener noreferrer nofollow">${text}</a>`
				: m
		)
		.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
		.replace(/~~([^~]+)~~/g, '<del>$1</del>')
		.replace(/(^|[^*\w])\*([^*\s][^*]*)\*(?!\w)/g, '$1<em>$2</em>')
		.replace(/(^|[^_\w])_([^_\s][^_]*)_(?!\w)/g, '$1<em>$2</em>');
	return out.replace(PARKED, (_m, i: string) => codes[Number(i)]);
}

type Block =
	| { kind: 'p'; lines: string[] }
	| { kind: 'h'; level: number; text: string }
	| { kind: 'ul' | 'ol'; items: string[] }
	| { kind: 'quote'; lines: string[] }
	| { kind: 'code'; lines: string[] };

export function renderMarkdown(source: string): string {
	const blocks: Block[] = [];
	const lines = escapeHtml(source.replace(/\r\n?/g, '\n')).split('\n');
	let fence: Block | null = null;

	for (const line of lines) {
		if (fence) {
			if (/^\s*```/.test(line)) fence = null;
			else (fence as { lines: string[] }).lines.push(line);
			continue;
		}
		if (/^\s*```/.test(line)) {
			fence = { kind: 'code', lines: [] };
			blocks.push(fence);
			continue;
		}
		if (!line.trim()) {
			blocks.push({ kind: 'p', lines: [] });
			continue;
		}

		const last = blocks.at(-1);
		const heading = /^(#{1,3})\s+(.*)$/.exec(line);
		const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
		const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
		const quote = /^&gt;\s?(.*)$/.exec(line);

		if (heading) blocks.push({ kind: 'h', level: heading[1].length, text: heading[2] });
		else if (bullet || numbered) {
			const kind = bullet ? 'ul' : 'ol';
			const text = (bullet ?? numbered)![1];
			if (last?.kind === kind) last.items.push(text);
			else blocks.push({ kind, items: [text] });
		} else if (quote) {
			if (last?.kind === 'quote') last.lines.push(quote[1]);
			else blocks.push({ kind: 'quote', lines: [quote[1]] });
		} else if (last?.kind === 'p') last.lines.push(line);
		else blocks.push({ kind: 'p', lines: [line] });
	}

	return blocks
		.map((b) => {
			switch (b.kind) {
				case 'p':
					return b.lines.length ? `<p>${b.lines.map(inline).join('<br>')}</p>` : '';
				case 'h':
					// h3–h5: a note sits under the page's own headings.
					return `<h${b.level + 2}>${inline(b.text)}</h${b.level + 2}>`;
				case 'ul':
				case 'ol':
					return `<${b.kind}>${b.items.map((i) => `<li>${inline(i)}</li>`).join('')}</${b.kind}>`;
				case 'quote':
					return `<blockquote>${b.lines.map(inline).join('<br>')}</blockquote>`;
				case 'code':
					return `<pre><code>${b.lines.join('\n')}</code></pre>`;
			}
		})
		.join('');
}

/** The first line of a note as plain text, for a one-line summary. */
export function markdownTitle(source: string): string {
	const first = source.split(/\r?\n/).find((l) => l.trim() && !/^\s*```/.test(l)) ?? '';
	return first
		.replace(/^#{1,6}\s+|^\s*[-*]\s+|^\s*\d+[.)]\s+|^>\s?/, '')
		.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
		.replace(/[*_`~]/g, '')
		.trim();
}
