# Creating Custom Definition Loaders

This directory contains definition loader implementations. You can add new loaders by creating a new file and implementing the `IDefinitionLoader` interface.

## Example: S3 Loader

Here's how you would create an S3 loader for AWS storage:

```typescript
// loaders/s3.ts
import { S3Client, GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { sdkStreamMixin } from '@aws-sdk/util-stream-node';
import type {
	IDefinitionLoader,
	Definition,
	DefinitionMetadata,
	DefinitionFileType
} from '../types';

export interface S3LoaderConfig {
	bucket: string;
	region: string;
	accessKeyId: string;
	secretAccessKey: string;
	prefix?: string; // e.g., "definitions/"
}

export class S3DefinitionLoader implements IDefinitionLoader {
	private s3: S3Client;
	private config: Required<S3LoaderConfig>;

	constructor(config: S3LoaderConfig) {
		this.config = {
			prefix: 'definitions/',
			...config
		};

		this.s3 = new S3Client({
			region: this.config.region,
			credentials: {
				accessKeyId: this.config.accessKeyId,
				secretAccessKey: this.config.secretAccessKey
			}
		});
	}

	private getFileType(key: string): DefinitionFileType {
		const ext = key.split('.').pop()?.toLowerCase() || 'gh';
		if (ext === 'gh' || ext === 'ghx') {
			return ext as DefinitionFileType;
		}
		throw new Error(`Unsupported file type: ${ext}`);
	}

	async listDefinitions(): Promise<Definition[]> {
		const command = new ListObjectsV2Command({
			Bucket: this.config.bucket,
			Prefix: this.config.prefix
		});

		const response = await this.s3.send(command);
		const definitions: Definition[] = [];

		if (!response.Contents) return definitions;

		for (const item of response.Contents) {
			if (!item.Key || !item.Key.endsWith('.json')) continue;

			try {
				const metadata = await this.loadMetadataFromS3(item.Key);
				const filename = item.Key.replace(`${this.config.prefix}metadata/`, '');

				definitions.push({
					filename,
					fileType: this.getFileType(filename),
					...metadata
				});
			} catch (err) {
				console.warn(`[S3Loader] Failed to load metadata from ${item.Key}: ${err}`);
			}
		}

		return definitions.sort((a, b) => a.displayName.localeCompare(b.displayName));
	}

	async getMetadata(filename: string): Promise<DefinitionMetadata> {
		const key = `${this.config.prefix}metadata/${filename}.json`;
		return this.loadMetadataFromS3(key);
	}

	private async loadMetadataFromS3(key: string): Promise<DefinitionMetadata> {
		const command = new GetObjectCommand({
			Bucket: this.config.bucket,
			Key: key
		});

		const response = await this.s3.send(command);
		const body = await sdkStreamMixin(response.Body).transformToString('utf-8');
		return JSON.parse(body);
	}

	async loadDefinition(filename: string): Promise<Uint8Array> {
		const key = `${this.config.prefix}${filename}`;
		const command = new GetObjectCommand({
			Bucket: this.config.bucket,
			Key: key
		});

		const response = await this.s3.send(command);
		const buffer = await sdkStreamMixin(response.Body).transformToByteArray();
		return new Uint8Array(buffer);
	}

	async getDefinitionUrl(filename: string): Promise<string> {
		// Generate a signed URL (valid for 1 hour)
		const command = new GetObjectCommand({
			Bucket: this.config.bucket,
			Key: `${this.config.prefix}${filename}`
		});

		const url = await getSignedUrl(this.s3, command, { expiresIn: 3600 });
		return url;
	}
}
```

Then register it in the factory:

```typescript
// factory.ts
import { S3DefinitionLoader } from './loaders/s3';

// In createLoader method
case 's3':
  return new S3DefinitionLoader({
    bucket: env.AWS_BUCKET || 'my-definitions',
    region: env.AWS_REGION || 'us-east-1',
    accessKeyId: env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY || '',
    prefix: env.S3_DEFINITIONS_PREFIX
  });
```

## Key Points

1. **Implement all methods** from `IDefinitionLoader`
2. **Error handling** - throw descriptive errors
3. **File type validation** - only allow .gh and .ghx
4. **Performance** - consider caching metadata
5. **Security** - validate filenames, never expose secrets to client
6. **Type safety** - use TypeScript for compile-time checks

## Testing Custom Loaders

```typescript
import { S3DefinitionLoader } from './loaders/s3';

// In your test
const loader = new S3DefinitionLoader({
	bucket: 'test-bucket',
	region: 'us-east-1',
	accessKeyId: 'test-key',
	secretAccessKey: 'test-secret'
});

const definitions = await loader.listDefinitions();
expect(definitions.length).toBeGreaterThan(0);
```
