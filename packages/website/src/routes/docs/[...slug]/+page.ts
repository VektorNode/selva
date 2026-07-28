import { docs, getDoc, getDocNeighbors } from '$lib/docs';
import { error } from '@sveltejs/kit';
import type { EntryGenerator, PageLoad } from './$types';

export const prerender = true;

// Tell the prerenderer every doc slug to render.
export const entries: EntryGenerator = () => {
	return docs.map((d) => ({ slug: d.slug }));
};

export const load: PageLoad = async ({ params }) => {
	const entry = getDoc(params.slug);
	if (!entry) {
		error(404, `Doc not found: ${params.slug}`);
	}

	const { default: content } = await entry.load();
	const { prev, next } = getDocNeighbors(entry.slug);
	// Pass only the fields the nav needs — DocEntry carries a non-serializable
	// `load` thunk that can't cross the load boundary.
	const link = (d?: typeof entry) => (d ? { title: d.title, slug: d.slug } : null);
	return { content, title: entry.title, prev: link(prev), next: link(next) };
};
