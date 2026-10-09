import { parseR2Url } from "../../../../core/index.js";

// Where a typed S3 API URL points: the R2 account id (its first label) and the bucket. Keys someone else
// supplied would send this vault's backups to their bucket, so Connect shows both first. null when the URL
// is not an R2 bucket (Connect then says so). Same rule as the phone's bucketOf.
export function bucketOf(url: string): { account: string; bucket: string } | null {
  const target = parseR2Url(url);
  if (!target) return null;
  return { account: new URL(target.endpoint).hostname.split(".")[0], bucket: target.bucket };
}
