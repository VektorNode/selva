import { describe, expect, it } from 'vitest';
import { markdownTitle, renderMarkdown } from '../format/markdown.js';

describe('renderMarkdown', () => {
	it('escapes HTML before adding any markup', () => {
		expect(renderMarkdown('<script>alert(1)</script> & "x"')).toBe(
			'<p>&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;x&quot;</p>'
		);
	});

	it('only links http, https and mailto', () => {
		expect(renderMarkdown('[a](https://x.test/?a=1&b=2)')).toBe(
			'<p><a href="https://x.test/?a=1&amp;b=2" target="_blank" rel="noopener noreferrer nofollow">a</a></p>'
		);
		expect(renderMarkdown('[a](javascript:alert(1))')).not.toContain('<a');
		expect(renderMarkdown('[a](" onmouseover="x)')).not.toContain('<a');
	});

	it('renders headings one level under h2', () => {
		expect(renderMarkdown('# A\n## B\n### C')).toBe('<h3>A</h3><h4>B</h4><h5>C</h5>');
	});

	it('groups list items and keeps separate lists apart', () => {
		expect(renderMarkdown('- a\n- b\n\n1. c\n2. d')).toBe(
			'<ul><li>a</li><li>b</li></ul><ol><li>c</li><li>d</li></ol>'
		);
	});

	it('joins paragraph lines with breaks and splits paragraphs on blank lines', () => {
		expect(renderMarkdown('a\nb\n\nc')).toBe('<p>a<br>b</p><p>c</p>');
	});

	it('renders inline marks, leaving code spans literal', () => {
		expect(renderMarkdown('**b** *i* _j_ ~~s~~ `**not bold**`')).toBe(
			'<p><strong>b</strong> <em>i</em> <em>j</em> <del>s</del> <code>**not bold**</code></p>'
		);
	});

	it('keeps snake_case and multiplication intact', () => {
		expect(renderMarkdown('wall_thickness_mm and 2 * 3 * 4')).toBe(
			'<p>wall_thickness_mm and 2 * 3 * 4</p>'
		);
	});

	it('renders fences and quotes', () => {
		expect(renderMarkdown('```\n<b>\n```\n> note')).toBe(
			'<pre><code>&lt;b&gt;</code></pre><blockquote>note</blockquote>'
		);
	});
});

describe('markdownTitle', () => {
	it('takes the first line as plain text', () => {
		expect(markdownTitle('## **Wider** walls\n\nmore')).toBe('Wider walls');
		expect(markdownTitle('\n- [Fix](https://x.test) `w`')).toBe('Fix w');
	});
});
