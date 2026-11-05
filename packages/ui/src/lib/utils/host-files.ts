// Where a file the page offers goes, and where a file the page asks for comes from. A browser
// gets an <a download> click and a hidden <input type=file>. A host whose WebView can't do
// either safely (the Rhino panel) installs its own once at start-up, before the first save or pick.

/** Resolves false when the user cancelled. An anchor download always resolves true: it can't tell. */
export type BlobSaver = (blob: Blob, fileName: string) => Promise<boolean>;

/** `accept` is what `<input accept>` takes: `.slvp,.sps`, `image/*`. Resolves null on cancel. */
export type FilePicker = (options: { accept: string }) => Promise<File | null>;

let saver: BlobSaver = saveWithAnchor;
let picker: FilePicker = pickWithInput;

export function setBlobSaver(next: BlobSaver): void {
	saver = next;
}

export function setFilePicker(next: FilePicker): void {
	picker = next;
}

export function saveBlob(blob: Blob, fileName: string): Promise<boolean> {
	return saver(blob, fileName);
}

export function pickFile(options: { accept: string }): Promise<File | null> {
	return picker(options);
}

async function saveWithAnchor(blob: Blob, fileName: string): Promise<boolean> {
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = fileName;
	// Firefox only downloads from an anchor that is in the document.
	document.body.appendChild(a);
	a.click();
	a.remove();
	// Revoking synchronously can abort the download: the browser pins the blob only once it starts.
	setTimeout(() => URL.revokeObjectURL(url), 10_000);
	return true;
}

function pickWithInput({ accept }: { accept: string }): Promise<File | null> {
	return new Promise((resolve) => {
		const input = document.createElement('input');
		input.type = 'file';
		input.accept = accept;
		input.style.display = 'none';

		const settle = (file: File | null) => {
			input.remove();
			resolve(file);
		};
		input.addEventListener('change', () => settle(input.files?.[0] ?? null), { once: true });
		input.addEventListener('cancel', () => settle(null), { once: true });

		document.body.appendChild(input);
		input.click();
	});
}
