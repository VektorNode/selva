import { docs, getDoc, getDocNeighbors, getUnpublishedTitle, unpublishedSlugs } from '$lib/docs';
import { error } from '@sveltejs/kit';
import type { EntryGenerator, PageLoad } from './$types';

export const prerender = true;

// Every published doc, plus a stub for each unpublished one so its URL explains
// itself rather than 404-ing.
export const entries: EntryGenerator = () => {
	return [...docs.map((d) => d.slug), ...unpublishedSlugs].map((slug) => ({ slug }));
};

export const load: PageLoad = async ({ params }) => {
	const entry = getDoc(params.slug);
	if (!entry) {
		const pendingTitle = getUnpublishedTitle(params.slug);
		if (pendingTitle) {
			return { content: null, title: pendingTitle, pending: true, prev: null, next: null };
		}
		error(404, `Doc not found: ${params.slug}`);
	}

	const { default: content } = await entry.load();
	const { prev, next } = getDocNeighbors(entry.slug);
	// Pass only the fields the nav needs — DocEntry carries a non-serializable
	// `load` thunk that can't cross the load boundary.
	const link = (d?: typeof entry) => (d ? { title: d.title, slug: d.slug } : null);
	return {
		content,
		title: entry.title,
		pending: false,
		prev: link(prev),
		next: link(next)
	};
};
