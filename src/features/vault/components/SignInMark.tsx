import { Buildings, EnvelopeSimple, Key } from "@phosphor-icons/react";
import { brandBySlug } from "@/features/brands/brands";
import { signInOption } from "../lib/sign-in";
import type { SignInMethod } from "../types";

const GLYPHS = { password: Key, "email-link": EnvelopeSimple, sso: Buildings } as const;

// The provider's logo (Google, Apple...) or a glyph for password / email link / SSO.
export function SignInMark({ method, size = 16 }: { method: SignInMethod; size?: number }) {
  const option = signInOption(method);
  const logo = option.brand ? brandBySlug(option.brand) : null;
  if (logo) return <img src={logo.logo} alt="" draggable={false} style={{ width: size, height: size }} className="object-contain" />;
  const Glyph = GLYPHS[method as keyof typeof GLYPHS] ?? Key;
  return <Glyph size={size} weight="bold" className="text-accent" />;
}
