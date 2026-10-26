// Grasshopper's PDF export can't read WebP: the plugin's PDF library has no WebP decoder, and
// nothing on Windows or Rhino.Compute decodes it reliably. The browser can, so a WebP picked for
// an input that also takes PNG is re-encoded here. PNG rather than JPEG keeps transparency.

/** True when a WebP should go out as PNG: the input takes PNG, so a PNG is a valid value. */
export function shouldConvertWebp(fileEnding: string, acceptedFormats: readonly string[]): boolean {
	return fileEnding === '.webp' && acceptedFormats.includes('.png');
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
