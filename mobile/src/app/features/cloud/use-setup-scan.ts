import { useState } from "react";
import { useHost } from "../../host/host-context";
import type { R2Keys } from "../../host/types";
import { bucketOf } from "./lib/bucket";

type ScannedCode = { keys: R2Keys; account: string; bucket: string };

// The PC's "Add a phone" code off the camera, for Restore from backup and Settings > Connect to R2. A
// scanned code connects only after the user has seen whose bucket it names (scanned, until Connect or
// Scan again); one whose URL is not an R2 bucket goes straight to connect, which says what is wrong.
// Closing the camera says nothing.
export function useSetupScan(fail: (error: string) => void) {
  const host = useHost();
  const [scanned, setScanned] = useState<ScannedCode | null>(null);
  async function scan(connect: (keys: R2Keys) => unknown) {
    const result = await host.scanQr("setup");
    if (!result.ok) return "canceled" in result ? undefined : fail(result.error);
    const parsed = host.parseSetupCode(result.text);
    if (!parsed.ok) return fail(parsed.error);
    const place = bucketOf(parsed.keys.url);
    if (!place) return void connect(parsed.keys);
    setScanned({ keys: parsed.keys, ...place });
  }
  return { scanned, setScanned, scan };
}
