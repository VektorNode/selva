import { decodeBase64ToBinary } from '@/core';

import { FileBaseInfo, FileData, ProcessedFile } from './types';

/**
 * Extracts and processes files from compute response data without downloading them.
 * Returns an array of ProcessedFile objects that can be used programmatically.
 *
 * @param downloadableFiles - An array of FileData items from the compute response.
 * @param additionalFiles - Optional additional files to include (fetched from URLs).
 * @returns A Promise resolving to an array of ProcessedFile objects.
 * @throws Will throw an error if file processing fails.
 *
 * @example
 * const files = await extractFilesFromComputeResponse(fileData);
 * files.forEach(file => {
 *   console.log(`File: ${file.fileName}, Size: ${file.content.length}`);
 * });
 */
export const extractFilesFromComputeResponse = async (
  downloadableFiles: FileData[],
  additionalFiles: FileBaseInfo[] | FileBaseInfo | null = null
): Promise<ProcessedFile[]> => {
  try {
    return await processFiles(downloadableFiles, additionalFiles);
  } catch (err) {
    console.error('Error extracting files:', err);
    throw new Error('Failed to extract files from compute response');
  }
};

/**
 * Downloads files from a compute response as a ZIP archive.
 * Packages multiple files into a single ZIP file and triggers a browser download.
 *
 * @param downloadableFiles - An array of FileData items from the compute response.
 * @param additionalFiles - Optional additional files to include in the ZIP (fetched from URLs).
 * @param fileFoldername - The name of the ZIP file (without extension).
 * @throws Will throw an error if the file handling or download fails.
 *
 * @example
 * await downloadDataFromComputeResponse(fileData, null, 'my-export');
 * // Downloads 'my-export.zip'
 */
export const downloadFileData = async (
  downloadableFiles: FileData[],
  fileFoldername: string,
  additionalFiles: FileBaseInfo[] | FileBaseInfo | null = null
): Promise<void> => {
  try {
    const processedFiles = await processFiles(downloadableFiles, additionalFiles);
    await createAndDownloadZip(processedFiles, fileFoldername);
  } catch (err) {
    console.error('Error downloading files:', err);
    throw new Error('Failed to download files from compute response');
  }
};

/**
 * Processes files from compute response data and additional files.
 * Converts base64-encoded data to binary and fetches additional files from URLs.
 *
 * @param dataItems - An array of FileData items to process.
 * @param additionalFiles - Optional additional files to fetch and include.
 * @returns A Promise resolving to an array of ProcessedFile objects.
 */
const processFiles = async (
  dataItems: FileData[],
  additionalFiles: FileBaseInfo[] | FileBaseInfo | null
): Promise<ProcessedFile[]> => {
  const processedFiles: ProcessedFile[] = [];

  // Process compute response files
  dataItems.forEach((item) => {
    let filePath = `${item.FileName}${item.FileType}`;

    if (item.SubFolder && item.SubFolder.trim() !== '') {
      filePath = `${item.SubFolder}/${filePath}`;
    }

    if (item.IsBase64Encoded === true && item.Data) {
      const bites = decodeBase64ToBinary(item.Data);
      processedFiles.push({
        fileName: `${item.FileName}${item.FileType}`,
        content: new Uint8Array(bites.buffer),
        path: filePath,
      });
    } else if (item.IsBase64Encoded === false && item.Data) {
      processedFiles.push({
        fileName: `${item.FileName}${item.FileType}`,
        content: item.Data,
        path: filePath,
      });
    }
  });

  if (additionalFiles) {
    const filesArray = Array.isArray(additionalFiles) ? additionalFiles : [additionalFiles];
    const additionalProcessed = await Promise.all(
      filesArray.map(async (file) => {
        try {
          const response = await fetch(file.FilePath);
          if (!response.ok) {
            console.error(`Failed to fetch additional file from URL: ${file.FilePath}`);
            return null;
          }
          const fileBlob = await response.blob();
          const arrayBuffer = await fileBlob.arrayBuffer();
          return {
            fileName: file.FileName,
            content: new Uint8Array(arrayBuffer),
            path: file.FileName,
          } as ProcessedFile;
        } catch (error) {
          console.error(`Error fetching additional file from URL: ${file.FilePath}`, error);
          return null;
        }
      })
    );

    processedFiles.push(...additionalProcessed.filter((f): f is ProcessedFile => f !== null));
  }

  return processedFiles;
};

/**
 * Creates a ZIP archive from processed files and triggers a browser download.
 *
 * @param files - An array of ProcessedFile objects to include in the ZIP.
 * @param zipName - The name of the ZIP file (without extension).
 * @returns A Promise that resolves when the ZIP is generated and download is triggered.
 */
async function createAndDownloadZip(files: ProcessedFile[], zipName: string): Promise<void> {
  const { zipSync, strToU8 } = await import('fflate');

  // Convert files to fflate format
  const zipData: Record<string, Uint8Array> = {};
  files.forEach((file) => {
    zipData[file.path] = typeof file.content === 'string' ? strToU8(file.content) : file.content;
  });

  const zipped = zipSync(zipData, { level: 6 });

  const blob = new Blob([zipped as BlobPart], { type: 'application/zip' });
  saveFile(blob, `${zipName}.zip`);
}

/**
 * Saves a Blob object as a file in the user's browser.
 *
 * @param blob - The Blob object representing the file content.
 * @param filename - The name to give the downloaded file (including extension).
 */
function saveFile(blob: Blob, filename: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
