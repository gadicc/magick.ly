import AWS from "aws-sdk";
import { ObjectId } from "bson";
import crypto from "crypto";
import { fileTypeFromBuffer } from "file-type";
import * as mm from "music-metadata";
import sharp from "sharp";
import gs /* Auth, User, Order,  ObjectId */ from "@/api-lib/db-full";

// import { format } from 'date-fns';

// const AWS_S3_BUCKET = "shadowlang";
const AWS_S3_BUCKET =
  process.env.AWS_S3_DEFAULT_BUCKET || "AWS_S3_BUCKET-env-var-not-set";

const defaults = {
  AWS_REGION: "eu-west-3", // Paris
};

// db.files.createIndex({ "sha256": 1 }, { name: 'sha256' });

const env = process.env;
AWS.config.update({
  accessKeyId: env.AWS_ACCESS_KEY_ID_APP || env.AWS_ACCESS_KEY_ID,
  secretAccessKey: env.AWS_SECRET_ACCESS_KEY_APP || env.AWS_SECRET_ACCESS_KEY,
  region: env.AWS_REGION_APP || env.AWS_REGION || defaults.AWS_REGION,
  s3: {
    // endpoint: env.AWS_S3_ENDPOINT_URL,
    endpoint:
      env.AWS_S3_ENDPOINT_URL && new AWS.Endpoint(env.AWS_S3_ENDPOINT_URL),
    s3ForcePathStyle: env.AWS_S3_ENDPOINT_URL ? true : false,
  },
});

if (!gs.dba) throw new Error("gs.dba not set");

interface FileError {
  $error: {
    code: string;
    message?: string;
    stack?: string;
  };
}

interface FileEntryBase {
  [key: string]: unknown;
  // _id: string | ObjectId;
  _id: ObjectId;
  filename?: string;
  sha256: string;
  size: number;
  type: string; // "image",
  mimeType?: string;
  createdAt: Date;
}

interface FileEntryOther extends FileEntryBase {
  type: "other";
}

interface FileEntryImage extends FileEntryBase {
  type: "image";
  image: {
    format: sharp.Metadata["format"];
    size?: number;
    width?: number;
    height?: number;
  };
}

interface FileEntryAudio extends FileEntryBase {
  type: "audio";
  audio: mm.IAudioMetadata["format"];
}

type FileEntry = FileEntryAudio | FileEntryImage | FileEntryOther;

const Files = gs.dba.collection<FileEntry>("files");

async function createFileFromBuffer(
  buffer: Buffer,
  {
    filename,
    mimeType,
    size,
    existingId,
    sha256,
    ...extra
  }: {
    filename?: string;
    mimeType?: string;
    size?: number;
    existingId?: string;
    sha256?: string | null;
    extra?: Record<string, unknown>;
  } = {},
) {
  // TODO, check if it's an image.

  // @ts-expect-error: broke on ts upgrade, fix later
  const _sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
  if (sha256) {
    if (sha256 !== _sha256) {
      return { $error: { code: "SHA256_MISMATCH" } };
    }
  } else {
    sha256 = _sha256;
  }

  size = size || Buffer.byteLength(buffer);
  if (!mimeType) {
    const fileType = await fileTypeFromBuffer(buffer);
    mimeType = fileType ? fileType.mime : "";
  }

  const specific = await (async function () {
    if (mimeType.match(/image/)) {
      const image = sharp(buffer);
      const metadata = await image.metadata();

      return {
        type: "image" as const,
        image: {
          format: metadata.format,
          size: metadata.size,
          width: metadata.width,
          height: metadata.height,
        },
      };
    } else if (mimeType.match(/audio/)) {
      // @ts-expect-error: broke on ts upgrade, fix later
      const metadata = await mm.parseBuffer(buffer, mimeType);
      return {
        type: "audio" as const,
        audio: metadata.format,
      };
    } else {
      return { type: "other" as const };
    }
  })();

  const now = new Date();

  const entry: FileEntry = {
    // _id: existingId || new ObjectId(),
    _id: new ObjectId(existingId),
    filename,
    sha256,
    size: size,
    mimeType,
    createdAt: now,
    ...extra,
    ...specific,
  };

  console.log(entry);

  const params = {
    Bucket: AWS_S3_BUCKET,
    Key: sha256,
    Body: buffer,
  };

  // console.log(params);

  const result = await new AWS.S3().putObject(params).promise();
  console.log({ result });

  if (existingId) {
    const $set = (({ _id, ...rest }) => rest)(entry);
    await Files.updateOne({ _id: new ObjectId(existingId) }, { $set });
  } else {
    await Files.insertOne(entry);
  }

  // return [entry, buffer];
  return entry;
}

export { AWS, AWS_S3_BUCKET, createFileFromBuffer, Files };
export type { FileEntry, FileError };
