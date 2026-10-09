import { useEffect, useState, type ReactNode } from "react";
import { Browser, CloudArrowUp, EyeSlash, Fingerprint, FolderSimpleLock, HardDrives, LockKey, Wall, WarningCircle } from "@phosphor-icons/react";
import { Sheet } from "@/components/Sheet";
import { vaultApi } from "@/lib/vault-api";
import { DEVICE, biometricName, explorerName, isMac } from "@/lib/platform";
import { hoursText } from "@/features/settings/lib/session-limit";

// The trust page: what KAPEVault does with your data, in plain words. Every line here must stay true
// to the code - if a behaviour changes, change this page in the same commit.
function Point({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <section className="flex gap-3.5">
      <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-[9px] bg-accent-soft text-accent">{icon}</span>
      <div className="min-w-0">
        <h3 className="text-[14px] font-semibold text-ink">{title}</h3>
        <div className="mt-1 space-y-1.5 text-[13px] leading-relaxed text-ink-2">{children}</div>
      </div>
    </section>
  );
}

export function TrustSheet({ onClose }: { onClose: () => void }) {
  const biometric = biometricName();
  // Lock after, as set now: 0 = off, so the page promises no limit. null until read.
  const [limit, setLimit] = useState<number | null>(null);

  useEffect(() => {
    vaultApi.getSettings().then((s) => setLimit(s.sessionLimitHours));
  }, []);

  return (
    <Sheet title="How KAPEVault protects you" onClose={onClose} width="w-[600px]">
      {(close) => (
        <>
          <p className="-mt-1 text-[14px] leading-relaxed text-ink-2">
            KAPEVault is a vault that lives on your {DEVICE}. There is no KAPEVault account and no KAPEVault server, so nobody at BrewedOps can see, reset or
            recover what you keep in it. It is yours alone.
          </p>

          <div className="mt-6 space-y-5">
            <Point icon={<HardDrives size={17} weight="bold" />} title={`Everything stays on this ${DEVICE}`}>
              <p>Your vault is one encrypted file on this {DEVICE}. KAPEVault has no analytics, no tracking and no ads, and it never sends your data anywhere.</p>
              <p>It only goes online when you open a link yourself, when you switch on cloud backup to your own bucket, or when you switch on Check for updates.</p>
              <p>
                Check for updates (Settings, General) is off until you turn it on. Then, once a day, it asks api.github.com whether a newer KAPEVault is out. The
                request carries only the app's name and version - nothing from your vault - and GitHub sees your internet address, as any website does.
              </p>
            </Point>

            <Point icon={<LockKey size={17} weight="bold" />} title="Locked with your master password">
              <p>
                Everything in the vault is encrypted with AES-256. The key comes from your master password through scrypt, which is slow on purpose, so
                guessing passwords against a stolen copy takes a very long time.
              </p>
              <p>Your master password is never saved - not even in the vault file. If you forget it, no one can get you back in, so keep the Emergency Kit (Settings, Backup) somewhere safe.</p>
            </Point>

            <Point icon={<EyeSlash size={17} weight="bold" />} title="Shown only when you ask">
              <p>
                Passwords, 2FA keys, backup codes, security answers, notes, API secrets, a device's passwords and label photo, an ID's number and photo, and the recent passwords from the generator
                (kept 90 days, in the vault) stay hidden until you show or copy one. A printout (Emergency Kit, Hand back) holds them only if you tick the box. Read aloud uses a voice on this {DEVICE}, and Scan a
                label reads the photo right here, offline.
              </p>
              <p>
                A copied password is cleared from the clipboard after 30 seconds{isMac ? "" : " and is kept out of Windows clipboard history"}.
                {isMac ? "" : " Windows keeps the KAPEVault window out of most screenshots and screen sharing, unless you turn that off in Settings."} The vault locks
                when your {DEVICE} has been idle for 5 minutes, when it sleeps,{" "}
                {limit ? `when you lock it, and ${hoursText(limit)} after you unlock it.` : "and when you lock it."}
              </p>
            </Point>

            <Point icon={<Fingerprint size={17} weight="bold" />} title={`${biometric} is optional`}>
              <p>
                Turn it on in Settings to unlock without typing. Your master password is still asked for every 14 days, so you do not forget it, and {biometric}{" "}
                turns off by itself when the master password changes.
              </p>
              <p>Anyone who can sign in to this {DEVICE} as you can use {biometric} here too, so keep your {DEVICE} sign-in to yourself.</p>
            </Point>

            <Point icon={<CloudArrowUp size={17} weight="bold" />} title="Cloud backup goes to your bucket, encrypted">
              <p>Backup is off until you connect your own Cloudflare R2 bucket. Only the encrypted vault file is uploaded - the same file that sits on this {DEVICE} - plus the Forever Opener page, which holds none of your data.</p>
              <p>
                Keep a copy in a folder writes that same encrypted file, and the Opener, into a folder you choose after each change. KAPEVault only
                writes it on this {DEVICE}; a OneDrive, Google Drive or Dropbox folder is uploaded by that app. Those apps keep older versions, which
                still open with the master password they were saved under - after changing it, delete the old versions there too.
              </p>
              <p>
                Your devices sync through the same bucket - by themselves while automatic backup is on, and whenever you press Sync now: KAPEVault
                downloads the encrypted backups your other devices put there, opens them here with your vault's key and merges in their changes. It
                downloads nothing else. Add a phone shows your R2 keys as a code on this screen, only when you ask, for a minute.
              </p>
              <p>
                Restoring a backup asks for the master password it was made with. KAPEVault keeps your current vault first - in your bucket when it
                can, otherwise on this {DEVICE} - and asks before replacing it only if it cannot keep it at all. After a restore, sync waits until you
                choose what your other devices do with it.
              </p>
            </Point>

            <Point icon={<Browser size={17} weight="bold" />} title="Your vault opens without KAPEVault">
              <p>
                The Forever Opener is a web page that opens your vault file in any browser, offline, with your master password - so your vault outlives
                this app. It never goes online. Save it in Settings, Backup.
              </p>
            </Point>

            {!isMac && (
              <Point icon={<Wall size={17} weight="bold" />} title="Windows can keep KAPEVault offline">
                <p>
                  Turn on Keep KAPEVault offline (Settings, Security) and Windows Firewall blocks KAPEVault from going online while the firewall is on -
                  Windows enforces it, not just a promise. Test shows it working.
                </p>
                <p>
                  Cloud backup and sync still work: a tool built into Windows carries the encrypted files up and down, never your R2 secret key. The update
                  check, if you turned it on, goes the same way. Links still open in your browser.
                </p>
              </Point>
            )}

            <Point icon={<FolderSimpleLock size={17} weight="bold" />} title="File links stay safe">
              <p>KAPEVault only reads the folders you saved as file links. Programs, and office files that can hold macros, are never opened from KAPEVault - they are shown in {explorerName} instead.</p>
              <p>
                Web pages open in previews with their scripts off until you choose to run them, and a preview cannot reach the internet. KAPEVault never
                asks for your master password inside a preview.
              </p>
            </Point>

            <Point icon={<WarningCircle size={17} weight="bold" />} title="What no vault can protect against">
              <p>
                Malware on your {DEVICE} (a keylogger can watch you type), someone who knows your master password, or a master password that is easy to
                guess. Keep your {DEVICE} updated, use a long master password you use nowhere else, and never share it.
              </p>
            </Point>
          </div>

          <div className="mt-7 flex justify-end">
            <button type="button" onClick={close} className="press h-9 rounded-full bg-field px-5 text-[13.5px] font-medium text-ink hover:bg-line">
              Done
            </button>
          </div>
        </>
      )}
    </Sheet>
  );
}
