// HelpFlow AI — object storage client (ADR-003). Cloudflare R2 in production, an S3-compatible
// local emulator in dev (see docker-compose.yml); same S3 API either way via @aws-sdk/client-s3.
import { Readable } from "node:stream";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { loadEnv } from "@helpflow/config";

let client: S3Client | null = null;

function getClient(): S3Client {
  if (client) return client;
  const env = loadEnv();
  client = new S3Client({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    },
  });
  return client;
}

function bucket(): string {
  return loadEnv().S3_BUCKET;
}

/** Key format: org/{orgId}/kb/{kbId}/doc/{docId}/{sha256}.{ext} (ADR-003). */
export function buildDocumentStorageKey(params: {
  organizationId: string;
  knowledgeBaseId: string;
  documentId: string;
  sha256: string;
  extension: string;
}): string {
  return `org/${params.organizationId}/kb/${params.knowledgeBaseId}/doc/${params.documentId}/${params.sha256}${params.extension}`;
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  await getClient().send(new PutObjectCommand({ Bucket: bucket(), Key: key, Body: body, ContentType: contentType }));
}

export async function getObjectBuffer(key: string): Promise<Buffer> {
  const result = await getClient().send(new GetObjectCommand({ Bucket: bucket(), Key: key }));
  const stream = result.Body as Readable;
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export async function deleteObject(key: string): Promise<void> {
  await getClient().send(new DeleteObjectCommand({ Bucket: bucket(), Key: key }));
}
