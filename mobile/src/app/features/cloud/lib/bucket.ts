import { parseR2Url } from "../../../host/r2";

// Where a scanned setup code points: the R2 account id (the S3 API URL's first label) and the bucket.
// A code from someone else would send this vault's backups to their bucket, so the phone shows both and
// asks before it connects. null when the URL is not an R2 bucket (the connect itself then says so).
export function bucketOf(url: string): { account: string; bucket: string } | null {
  const target = parseR2Url(url);
  if (!target) return null;
  return { account: new URL(target.endpoint).hostname.split(".")[0], bucket: target.bucket };
}
