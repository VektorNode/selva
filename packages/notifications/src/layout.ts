import { escapeHtml } from './html.js';

export interface LayoutInput {
	/** Shown as the mail's heading. Escaped here — pass plain text. */
	heading: string;
	/** Body HTML. Already-escaped markup; templates build this themselves. */
	body: string;
	/** Small print under the rule. Already-escaped markup, omitted when absent. */
	footer?: string;
}

/**
 * The frame every Selva mail shares: card chrome, type stack, colours.
 * Templates supply a body; this supplies the look, so mail written by
 * different people at different times still reads as coming from one product.
 *
 * Deliberately plain — no images, no tracking pixel, no external stylesheet.
 * Inline styles with a table-free layout survive the common clients, and mail
 * clients that strip the styling still get readable, ordered content.
 */
export function renderLayout({ heading, body, footer }: LayoutInput): string {
	return `<!doctype html>
<html>
<body style="margin:0;padding:24px;background:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1a1a1a;">
	<div style="max-width:480px;margin:0 auto;background:#ffffff;border:1px solid #e4e6eb;border-radius:12px;padding:32px;">
		<h1 style="margin:0 0 16px;font-size:20px;font-weight:600;">${escapeHtml(heading)}</h1>
${body}${
		footer
			? `
		<hr style="border:none;border-top:1px solid #e4e6eb;margin:24px 0;" />
		<p style="margin:0;font-size:12px;line-height:1.5;color:#8a8a8a;">
			${footer}
		</p>`
			: ''
	}
	</div>
</body>
</html>`;
}

/** The primary action button. One definition so every mail's call to action matches. */
export function renderButton(href: string, label: string): string {
	return `<a href="${escapeHtml(href)}" style="display:inline-block;padding:11px 20px;background:#1a1a1a;color:#ffffff;text-decoration:none;border-radius:8px;font-size:15px;font-weight:500;">${escapeHtml(label)}</a>`;
}

/**
 * Fallback for clients that do not make the button clickable. Every mail whose
 * point is a link needs this: a button that does not render leaves the reader
 * with no way to continue.
 */
export function renderUrlFallback(href: string): string {
	return `<p style="margin:24px 0 0;font-size:13px;line-height:1.5;color:#6b6b6b;">
			Or paste this into your browser:<br />
			<span style="word-break:break-all;color:#4a4a4a;">${escapeHtml(href)}</span>
		</p>`;
}
