import { brandForEntry } from "@/features/brands/brands";
import { SIGN_IN_OPTIONS } from "./sign-in";
import type { Entry, LoginEntry, SignInMethod } from "../types";

// Which provider a saved login is an account OF (a Gmail login is a Google account), if any.
// A plain @gmail.com username counts as Google even without a logo.
function providerOf(e: LoginEntry): SignInMethod | null {
  const slug = brandForEntry(e)?.slug ?? "";
  const owner = SIGN_IN_OPTIONS.find((o) => o.accountBrands?.includes(slug));
  if (owner) return owner.value;
  return /@(gmail|googlemail)\.com$/i.test(e.username) ? "google" : null;
}

// Logins you could be signing in through: the provider's own accounts, then logins of no known
// provider (a Google Workspace account on a custom domain looks like nothing). Accounts of a
// DIFFERENT provider (your Facebook login, when signing in with Google) are left out.
// keepId keeps the currently linked account listed even if it no longer fits.
export function accountCandidates(entries: Entry[], method: SignInMethod, selfId?: string, keepId?: string) {
  // A closed account (tombstone) is no way in.
  const logins = entries.filter((e): e is LoginEntry => e.kind === "login" && e.id !== selfId && e.lifecycle?.state !== "gone");
  const provider = logins.filter((e) => providerOf(e) === method);
  const other = logins.filter((e) => !provider.includes(e) && (providerOf(e) === null || e.id === keepId));
  return { provider, other };
}
