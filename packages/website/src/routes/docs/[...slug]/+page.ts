import { docs, getDoc } from '$lib/docs';
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
	return { content, title: entry.title };
};
