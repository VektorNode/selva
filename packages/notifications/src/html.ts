/**
 * Escape text for interpolation into an HTML attribute or text node.
 *
 * One copy on purpose: per-template copies are how one of them ends up missing
 * a case. Every value a template interpolates goes through this, including
 * URLs — an `acceptUrl` carries a token, and a token can contain characters
 * that would otherwise close the `href` early.
 */
export function escapeHtml(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}
