import type { ReactNode } from "react";
import { CloudArrowUp, DeviceMobile, EyeSlash, Fingerprint, LockKey, WarningCircle } from "@phosphor-icons/react";
import { Button } from "../../components/form";
import { Sheet } from "../../components/Sheet";

function Point({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <section className="flex gap-3.5">
      <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-[9px] bg-accent-soft text-accent">{icon}</span>
      <div className="min-w-0">
        <h3 className="text-[14px] font-semibold text-ink">{title}</h3>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-2">{children}</p>
      </div>
    </section>
  );
}

// The trust page at phone size: the PC's page, cut to what is true on the phone. Every line must stay
// true to the code - if a behaviour changes, change this page in the same commit.
export function TrustSheet({ onClose }: { onClose: () => void }) {
  return (
    <Sheet title="How KAPEVault protects you" tall onClose={onClose} footer={(close) => (<><span className="flex-1" /><Button onClick={close}>Done</Button></>)}>
      {() => (
        <>
          <p className="mt-3 text-[14px] leading-relaxed text-ink-2">There is no KAPEVault account and no KAPEVault server, so nobody at BrewedOps can see, reset or recover what you keep in it. It is yours alone.</p>
          <div className="mt-6 space-y-5">
            <Point icon={<DeviceMobile size={17} weight="bold" />} title="Everything stays on this phone">
              Your vault is one encrypted file on this phone. KAPEVault has no analytics, no tracking and no ads. It only goes online to sync with your own bucket, or when you open a link yourself.
            </Point>
            <Point icon={<LockKey size={17} weight="bold" />} title="Locked with your master password">
              Everything in the vault is encrypted with AES-256, with a key made from your master password by scrypt. Your master password is never saved. If you forget it, no one can get you back in.
            </Point>
            <Point icon={<EyeSlash size={17} weight="bold" />} title="Shown only when you ask">
              Passwords, 2FA keys, notes and secrets stay hidden until you show or copy one. A copied password is cleared from the clipboard after 30 seconds. Screenshots and the recent-apps preview are blocked (Settings can allow screenshots), and the vault locks after you leave the app.
            </Point>
            <Point icon={<Fingerprint size={17} weight="bold" />} title="Fingerprint is optional">
              Your master password is still asked for every 14 days, and fingerprint unlock turns off by itself when the master password changes.
            </Point>
            <Point icon={<CloudArrowUp size={17} weight="bold" />} title="Sync goes to your bucket, encrypted">
              Only the encrypted vault file travels, and only to your own Cloudflare R2 bucket. A change made on both devices keeps both versions.
            </Point>
            <Point icon={<WarningCircle size={17} weight="bold" />} title="What no vault can protect against">
              Malware on your phone, someone who knows your master password, or a master password that is easy to guess. Use a long one you use nowhere else.
            </Point>
          </div>
        </>
      )}
    </Sheet>
  );
}
