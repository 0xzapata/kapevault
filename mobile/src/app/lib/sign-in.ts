// Made from the PC's src/features/vault/lib/sign-in.ts by scripts/brands-sync.mjs - change it there, then run the script.
import type { SignInMethod } from "../host/types";
import { SIGN_IN } from "@core";

// How a login is signed in to. No logo catalogue here, so search runs under node --test.

export interface SignInOption {
  value: SignInMethod;
  label: string;
  brand?: string; // logo slug; password / email-link / sso use a glyph instead
  accountBrands?: string[]; // saved logins that count as "your <provider> account"
}

const LOOKS: Record<SignInMethod, Omit<SignInOption, "value">> = {
  password: { label: "Password" },
  google: { label: "Google", brand: "google", accountBrands: ["google", "gmail", "google-drive", "google-docs", "google-sheets", "google-calendar", "google-cloud", "youtube"] },
  microsoft: { label: "Microsoft", brand: "microsoft", accountBrands: ["microsoft", "outlook", "teams", "onedrive", "word", "excel"] },
  apple: { label: "Apple", brand: "apple", accountBrands: ["apple"] },
  github: { label: "GitHub", brand: "github", accountBrands: ["github"] },
  facebook: { label: "Facebook", brand: "facebook", accountBrands: ["facebook", "meta", "instagram"] },
  "email-link": { label: "Email link" },
  sso: { label: "Company SSO" },
};

// core's ways to sign in (the ones main saves), in its order, as the form offers them.
export const SIGN_IN_OPTIONS: SignInOption[] = (SIGN_IN as SignInMethod[]).map((value) => ({ value, ...LOOKS[value] }));

export function signInOption(method: SignInMethod): SignInOption {
  return SIGN_IN_OPTIONS.find((o) => o.value === method) ?? SIGN_IN_OPTIONS[0];
}

export const usesPassword = (method: SignInMethod) => method === "password";
