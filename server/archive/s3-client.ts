export interface ArchiveS3Config {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export function getArchiveS3Config(env: Record<string, string | undefined> = process.env): ArchiveS3Config | null {
  const endpoint = env.ARCHIVE_S3_ENDPOINT;
  const bucket = env.ARCHIVE_S3_BUCKET;
  const accessKeyId = env.ARCHIVE_S3_ACCESS_KEY;
  const secretAccessKey = env.ARCHIVE_S3_SECRET_KEY;
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) return null;
  return { endpoint, bucket, accessKeyId, secretAccessKey };
}

export async function uploadArchiveObject(
  key: string,
  body: Uint8Array,
  env: Record<string, string | undefined> = process.env,
): Promise<{ ok: true; uri: string } | { ok: false; reason: string }> {
  const config = getArchiveS3Config(env);
  if (!config) return { ok: false, reason: 'ARCHIVE_S3_NOT_CONFIGURED' };

  try {
    const mod = await import('@aws-sdk/client-s3');
    const client = new mod.S3Client({
      endpoint: config.endpoint,
      region: 'auto',
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      forcePathStyle: true,
    });
    await client.send(new mod.PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      Body: body,
    }));
    return { ok: true, uri: `s3://${config.bucket}/${key}` };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

