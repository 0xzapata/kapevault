import type { BiometricStatus } from "@/lib/vault-api";

// What the Unlock switch says when it cannot be turned on. A PC whose policy blocks the Windows Hello
// bridge is not one that needs Hello set up, so it gets its own line.
export function unsupportedNote(status: Pick<BiometricStatus, "blockedByPolicy">, mac: boolean): string {
  if (status.blockedByPolicy) return "This PC's policy blocks Windows Hello for KAPEVault.";
  return mac ? "Touch ID is not available on this Mac." : "Set up Windows Hello first: Windows Settings > Accounts > Sign-in options.";
}
