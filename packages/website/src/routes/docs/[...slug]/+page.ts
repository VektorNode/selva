import { docs, getDoc } from '$lib/docs';
import { error } from '@sveltejs/kit';

export const prerender = true;

// Tell the prerenderer every doc slug to render.
export function entries() {
	return docs.map((d) => ({ slug: d.slug }));
}

export async function load({ params }) {
	const entry = getDoc(params.slug);
	if (!entry) {
		error(404, `Doc not found: ${params.slug}`);
	}

	const { default: content } = await entry.load();
	return { content, title: entry.title };
}
