// File-type constraints for the compute-app HTTP API layer.
// These are independent of whichever provider is configured.
export {
	GH_EXTENSIONS,
	COVER_IMAGE_EXTENSIONS as IMAGE_EXTENSIONS,
	ALLOWED_UPLOAD_EXTENSIONS,
	COVER_IMAGE_CONTENT_TYPES as IMAGE_CONTENT_TYPES
} from '@selva/platform/definitions';

export const MAX_GH_FILE_SIZE = 50 * 1024 * 1024; // 50 MB
export const MAX_IMAGE_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
