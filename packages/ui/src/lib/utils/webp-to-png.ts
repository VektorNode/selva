// Grasshopper's PDF export can't read WebP: the plugin's PDF library has no WebP decoder, and
// nothing on Windows or Rhino.Compute decodes it reliably. The browser can, so a WebP picked for
// an input that also takes PNG is re-encoded here. PNG rather than JPEG keeps transparency.

/** True when a WebP should go out as PNG: the input takes PNG, so a PNG is a valid value. */
export function shouldConvertWebp(fileEnding: string, acceptedFormats: readonly string[]): boolean {
	return fileEnding === '.webp' && acceptedFormats.includes('.png');
}

/** Whether the input takes a file with this ending, counting a WebP it would get as PNG. */
export function acceptsFileEnding(fileEnding: string, acceptedFormats: readonly string[]): boolean {
	const ending = fileEnding.toLowerCase();
	if (acceptedFormats.length === 0 || acceptedFormats.includes(ending)) return true;
	return shouldConvertWebp(ending, acceptedFormats);
}

const ascii = (bytes: Uint8Array, start: number, end: number) =>
	String.fromCharCode(...bytes.subarray(start, end));

/**
 * By content, not name: image CDNs serve WebP from URLs with no extension or one naming another
 * format. A WebP file starts `RIFF`, a 4-byte size, then `WEBP`.
 */
export async function isWebp(blob: Blob): Promise<boolean> {
	if (blob.type === 'image/webp') return true;
	const head = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
	return head.length === 12 && ascii(head, 0, 4) === 'RIFF' && ascii(head, 8, 12) === 'WEBP';
}

export async function webpToPng(blob: Blob): Promise<Blob> {
	const bitmap = await createImageBitmap(blob);
	try {
		const canvas = document.createElement('canvas');
		canvas.width = bitmap.width;
		canvas.height = bitmap.height;
		const context = canvas.getContext('2d');
		if (!context) throw new Error('Canvas 2D context unavailable');
		context.drawImage(bitmap, 0, 0);
		return await new Promise<Blob>((resolve, reject) =>
			canvas.toBlob(
				(png) => (png ? resolve(png) : reject(new Error('PNG encoding failed'))),
				'image/png'
			)
		);
	} finally {
		bitmap.close();
	}
}
