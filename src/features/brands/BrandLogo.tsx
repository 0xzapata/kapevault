import type { Brand } from "./brands";

// A brand's logo at `size` px. A brand with no logo ("logo": false in brands.json) gets its first letter on
// the Monogram gradient instead, so it never shows a broken image. `marked` adds data-brand for the e2e checks.
export function BrandLogo({ brand, size, marked = false }: { brand: Brand; size: number; marked?: boolean }) {
  const mark = marked ? { "data-brand": brand.slug } : {};
  if (brand.logo) return <img src={brand.logo} alt="" draggable={false} style={{ width: size, height: size }} className="object-contain" {...mark} />;
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size, fontSize: size * 0.45 }}
      className="grid shrink-0 place-items-center rounded-full bg-linear-to-b from-mono-top to-mono-bottom font-semibold text-on-accent"
      {...mark}
    >
      {brand.name.charAt(0).toUpperCase()}
    </span>
  );
}
