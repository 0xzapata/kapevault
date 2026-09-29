import appIcon from "@/assets/app-icon.svg";

// KAPEVault's logo (kape = coffee): an espresso cup from above, latte art poured as a keyhole. The
// same SVG is rendered into the window and taskbar icon (build/icon.ico) by `npm run icon`, so the
// app and Windows always match.
// The shadow sits on a rounded wrapper, not a CSS drop-shadow filter: a filter over the
// transparent acrylic window leaves blurry smudges in Chromium.
export function AppIcon({ size = 96 }: { size?: number }) {
  return (
    <span className="inline-grid shrink-0 rounded-[22.6%] shadow-icon" style={{ width: size, height: size }}>
      <img src={appIcon} width={size} height={size} alt="" draggable={false} />
    </span>
  );
}
