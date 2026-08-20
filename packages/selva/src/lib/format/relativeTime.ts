/** Relative timestamp — "2m ago", "3h ago", "5d ago" — for recent-activity rows. */
export function formatRelative(iso: string): string {
	const diff = Date.now() - new Date(iso).getTime();
	const m = Math.floor(diff / 60_000);
	if (m < 1) return 'just now';
	if (m < 60) return `${m}m ago`;
	const h = Math.floor(m / 60);
	if (h < 24) return `${h}h ago`;
	const d = Math.floor(h / 24);
	return `${d}d ago`;
}
