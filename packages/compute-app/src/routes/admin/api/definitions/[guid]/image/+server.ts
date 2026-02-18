import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { getDefinitionStore } from '$lib/server/definitions.server';
import { GuidSchema } from '$lib/server/definitions/schemas';
import { MAX_IMAGE_FILE_SIZE } from '$lib/server/admin-config';

// POST /admin/api/definitions/{guid}/image — upload a cover image into the GUID folder
export const POST: RequestHandler = async ({ params, request }) => {
  const guidParsed = GuidSchema.safeParse(params.guid);
  if (!guidParsed.success) throw error(400, 'Invalid GUID');

  try {
    const formData = await request.formData();
    const file = formData.get('image');

    if (!file || !(file instanceof File) || file.size === 0) {
      throw error(400, 'Image file is required');
    }

    if (file.size > MAX_IMAGE_FILE_SIZE) {
      throw error(400, `Image too large. Max size: ${MAX_IMAGE_FILE_SIZE / (1024 * 1024)} MB`);
    }

    const coverImage = await getDefinitionStore().saveImage(guidParsed.data, {
      name: file.name,
      data: await file.arrayBuffer()
    });

    return json({ success: true, coverImage });
  } catch (err) {
    if (err && typeof err === 'object' && 'status' in err) throw err;
    console.error('[Image POST] Failed:', err);
    throw error(500, 'Failed to upload image');
  }
};

