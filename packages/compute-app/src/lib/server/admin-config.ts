/** Allowed Grasshopper file extensions */
export const GH_EXTENSIONS = ['.gh', '.ghx'];

/** Allowed image extensions */
export const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];

/** All allowed upload extensions (GH + images) */
export const ALLOWED_UPLOAD_EXTENSIONS = [...GH_EXTENSIONS, ...IMAGE_EXTENSIONS];

/** MIME types for image extensions */
export const IMAGE_CONTENT_TYPES: Record<string, string> = {
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.png': 'image/png',
	'.gif': 'image/gif',
	'.webp': 'image/webp'
};

/** Max upload sizes */
export const MAX_GH_FILE_SIZE = 50 * 1024 * 1024; // 50 MB
export const MAX_IMAGE_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
