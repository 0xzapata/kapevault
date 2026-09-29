// Whose bucket a scanned setup code names (features/cloud/lib/bucket.ts), shown before it connects.
export function BucketFacts({ account, bucket }: { account: string; bucket: string }) {
  const row = (label: string, value: string) => (
    <div className="flex flex-col gap-0.5 px-4 py-2.5 text-left">
      <span className="text-[12px] text-ink-3">{label}</span>
      <span className="font-mono text-[13px] break-all text-ink">{value}</span>
    </div>
  );
  return (
    <div className="w-full divide-y divide-line overflow-hidden rounded-2xl border border-line">
      {row("Account", account)}
      {row("Bucket", bucket)}
    </div>
  );
}
