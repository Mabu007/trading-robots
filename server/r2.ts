import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";

export type R2Config = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
};

export function getR2Config(
  env: NodeJS.ProcessEnv = process.env
): R2Config | null {
  const accountId = env.R2_ACCOUNT_ID?.trim();
  const accessKeyId = env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY?.trim();
  const bucket = env.R2_BUCKET?.trim();

  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
    return null;
  }

  return {
    accountId,
    accessKeyId,
    secretAccessKey,
    bucket,
  };
}

function createClient(config: R2Config): S3Client {
  return new S3Client({
    region: "auto",
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    forcePathStyle: true,
  });
}

let cachedClient: S3Client | undefined;
let cachedConfigKey = '';

function getConnection() {
  const config = getR2Config();

  if (!config) {
    throw new Error(
      "R2 is not configured. Check your R2 environment variables."
    );
  }

  const configKey = `${config.accountId}:${config.bucket}:${config.accessKeyId}:${config.secretAccessKey}`;
  if (!cachedClient || cachedConfigKey !== configKey) {
    cachedClient?.destroy();
    cachedClient = createClient(config);
    cachedConfigKey = configKey;
  }
  return { config, client: cachedClient };
}

export async function readR2Object(
  key: string
): Promise<string | null> {
  const { config, client } = getConnection();

  try {
    const response = await client.send(
      new GetObjectCommand({
        Bucket: config.bucket,
        Key: key,
      })
    );

    return (await response.Body?.transformToString()) ?? "";
  } catch (error: any) {
    if (
      error.name === "NoSuchKey" ||
      error.name === "NotFound" ||
      error.$metadata?.httpStatusCode === 404
    ) {
      return null;
    }

    console.error("R2 READ ERROR", {
      key,
      name: error.name,
      message: error.message,
      status: error.$metadata?.httpStatusCode,
    });

    throw error;
  }
}

export async function writeR2Object(
  key: string,
  body: string
): Promise<void> {
  const { config, client } = getConnection();

  try {
    await client.send(
      new PutObjectCommand({
        Bucket: config.bucket,
        Key: key,
        Body: body,
        ContentType: "application/json; charset=utf-8",
      })
    );
  } catch (error: any) {
    console.error("R2 WRITE ERROR", {
      key,
      name: error.name,
      message: error.message,
    });

    throw error;
  }
}

export async function deleteR2Object(key: string): Promise<void> {
  const { config, client } = getConnection();
  await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }));
}

export async function listR2Objects(
  prefix: string,
  maxKeys = 100
): Promise<string[]> {
  const { config, client } = getConnection();

  const keys: string[] = [];
  let continuationToken: string | undefined;

  do {
    const response = await client.send(
      new ListObjectsV2Command({
        Bucket: config.bucket,
        Prefix: prefix,
        MaxKeys: Math.min(1000, Math.max(1, maxKeys - keys.length)),
        ContinuationToken: continuationToken,
      })
    );

    keys.push(
      ...(response.Contents ?? [])
        .map((object) => object.Key)
        .filter((key): key is string => Boolean(key))
    );

    continuationToken = response.IsTruncated
      ? response.NextContinuationToken
      : undefined;
  } while (continuationToken && keys.length < maxKeys);

  return keys;
}
