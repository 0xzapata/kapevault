import { useEffect, useState, type ReactNode } from "react";
import { ArrowsClockwise, CaretRight, CloudCheck, Crown, Desktop, EyeSlash, FileArrowUp, Fingerprint, Key, Password, Scroll, ShieldCheck, Sun, Timer } from "@phosphor-icons/react";
import { Segmented, Switch } from "../../components/form";
import { useNow } from "../../components/fields";
import { useToast } from "../../components/Toast";
import { useHost } from "../../host/host-context";
import { usePro, useSync } from "../../hooks/use-vault";
import { autofill } from "../../host/autofill";
import { AutofillSheet, autofillValue, useAutofillStatus } from "../autofill/AutofillSetting";
import { capital, hoursText, relativeTime } from "../../lib/format";
import { useSettings } from "./settings-context";
import { ProSheet } from "../pro/ProSheet";
import { ProTag } from "../pro/ProTag";
import { afterSyncToast, lastTime, syncsNow } from "../sync/sync-text";
import { ConnectSheet } from "./ConnectSheet";
import { LicencesSheet } from "./LicencesSheet";
import { ChangeMasterSheet, CloudSheet, LockAfterSheet, THEME_LABELS, ThemeSheet } from "./settings-sheets";
import type { BiometricStatus, CloudStatus, LockGrace } from "../../host/types";

// What only the PC can do stays listed, greyed, with "On your PC".
const PC_ONLY = ["Keep KAPEVault offline", "Quick search", "Start with Windows", "Folder browser", "Scan a label", "Hand back", "Import", "Emergency Kit", "Encrypted copy", "Forever Opener"];
const GRACE: { value: LockGrace; label: string }[] = [
  { value: 0, label: "At once" },
  { value: 30, label: "30 seconds" },
  { value: 60, label: "1 minute" },
];
// Google Play asks for it inside the app too.
const PRIVACY_URL = "https://kapevault.brewedops.cloud/privacy/";

type Open = "master" | "lock-after" | "theme" | "cloud" | "connect" | "autofill" | "pro" | "licences" | null;

const groupTitle = "mx-5 mb-1.5 mt-[22px] text-[13px] font-semibold text-ink-2";
const card = "mx-4 overflow-hidden rounded-2xl border border-line bg-raised shadow-card";
const rowBase = "flex min-h-[50px] w-full items-center gap-3 border-b border-line px-3.5 py-1.5 text-left text-[13.5px] last:border-b-0";

function Icon({ tone, children }: { tone: string; children: ReactNode }) {
  return (
    <span className="grid size-[26px] shrink-0 place-items-center rounded-[7px] text-on-accent" style={{ background: `var(${tone})` }}>
      {children}
    </span>
  );
}

function NavRow({ icon, label, value, onClick }: { icon: ReactNode; label: string; value?: ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={`press ${rowBase} focus-ring [--focus-ring-offset:-2px]`}>
      {icon}
      <span className="flex-1">{label}</span>
      {value !== undefined && <span className="text-[13px] text-ink-3">{value}</span>}
      <CaretRight size={12} weight="bold" className="text-ink-3" />
    </button>
  );
}

// Every setting on one scroll, white cards on the grey ground. It is the Settings tab.
export function SettingsTab({ onRestoreFile }: { onRestoreFile: () => void }) {
  const host = useHost();
  const toast = useToast();
  const { settings, update } = useSettings();
  const sync = useSync();
  const pro = usePro();
  const [bio, setBio] = useState<BiometricStatus | null>(null);
  const [cloud, setCloud] = useState<CloudStatus | null>(null);
  const [open, setOpen] = useState<Open>(null);
  const [syncing, setSyncing] = useState(false);
  const [fill, setFill] = useAutofillStatus();
  useNow();

  useEffect(() => {
    host.cloudStatus().then(setCloud);
  }, [host]);
  // Read again whenever sync moves on: adopting a master password changed elsewhere turns it off.
  useEffect(() => {
    host.biometricStatus().then(setBio);
  }, [host, sync]);

  async function setFingerprint(on: boolean) {
    if (!on) {
      await host.disableBiometric();
      toast("Fingerprint unlock is off");
    } else {
      const result = await host.enableBiometric();
      if (!result.ok) {
        if (result.code !== "canceled") toast(result.error, "error");
        return;
      }
      toast("Fingerprint unlock is on");
    }
    setBio(await host.biometricStatus());
  }

  async function syncNow() {
    setSyncing(true);
    const result = await host.syncNow();
    setSyncing(false);
    if (!result.ok) return toast(result.error, "error");
    // A review, a new master password or a device problem is not "synced": say where to look.
    const done = afterSyncToast(await host.syncStatus());
    toast(done ?? "Sync needs a look: open the sync line", done ? "ok" : "error");
  }
  const last = sync && lastTime(sync);

  return (
    <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain pb-4">
      <div className="h-[52px]" />
      <h1 className="px-5 text-[26px] font-bold leading-[1.15] tracking-[-0.025em]">Settings</h1>

      <p className={groupTitle}>Unlock</p>
      <div className={card}>
        <label className={rowBase}>
          <Icon tone="--color-sys-blue">
            <Fingerprint size={15} weight="bold" />
          </Icon>
          <span className="flex-1">
            Fingerprint
            <small className="mt-px block text-[12.5px] text-ink-3">{bio && !bio.available ? "Set up a fingerprint on this phone first" : "Master password every 14 days"}</small>
          </span>
          <Switch label="Fingerprint" checked={Boolean(bio?.enabled)} disabled={!bio?.available} onChange={setFingerprint} />
        </label>
        <NavRow icon={<Icon tone="--color-sys-gray"><Key size={15} weight="fill" /></Icon>} label="Change master password" onClick={() => setOpen("master")} />
      </div>

      <p className={groupTitle}>Lock</p>
      <div className={card}>
        <div className="border-b border-line px-3.5 py-3">
          <p className="mb-2 text-[13.5px]">When you leave the app</p>
          <Segmented label="When you leave the app" options={GRACE} value={settings?.lockGrace ?? 30} onChange={(v) => void update({ lockGrace: v })} />
        </div>
        <NavRow icon={<Icon tone="--color-sys-indigo"><Timer size={15} /></Icon>} label="Lock after" value={settings ? hoursText(settings.lockAfterHours) : ""} onClick={() => setOpen("lock-after")} />
      </div>

      <p className={groupTitle}>Screen</p>
      <div className={card}>
        <label className={rowBase}>
          <Icon tone="--color-sys-gray">
            <EyeSlash size={15} weight="bold" />
          </Icon>
          <span className="flex-1">
            Hide from screen capture
            <small className="mt-px block text-[12.5px] text-ink-3">
              {settings?.hideFromCapture === false ? "Screenshots, recordings and screen sharing show the vault. On Android 11 and 12 it also shows in Recents" :"Screenshots, recordings and screen sharing show a blank screen"}
            </small>
          </span>
          <Switch label="Hide from screen capture" checked={settings?.hideFromCapture ?? true} disabled={!settings} onChange={(v) => void update({ hideFromCapture: v })} />
        </label>
      </div>

      <p className={groupTitle}>Fill in other apps</p>
      <div className={card}>
        {/* Off: Android's own "Autofill service" screen, with KAPEVault chosen. On: what it does, and Turn off. */}
        <NavRow
          icon={<Icon tone="--color-sys-purple"><Password size={15} weight="bold" /></Icon>}
          label="Autofill"
          value={autofillValue(fill)}
          onClick={() => {
            if (fill?.enabled) setOpen("autofill");
            else if (fill?.supported) void autofill.openSettings().then(setFill);
          }}
        />
      </div>

      <p className={groupTitle}>Backup and sync</p>
      <div className={card}>
        {/* R2 is optional: while it is off, this row connects it - and is the phone's "No backup yet". */}
        {cloud && !cloud.connected ? (
          <NavRow icon={<Icon tone="--color-sys-teal"><CloudCheck size={15} weight="fill" /></Icon>} label="Connect to R2" value="No backup yet" onClick={() => setOpen("connect")} />
        ) : (
          <NavRow icon={<Icon tone="--color-sys-teal"><CloudCheck size={15} weight="fill" /></Icon>} label="Cloud backup" value={cloud ? (cloud.apart ? "Backup only" : cloud.carried ? "Check bucket" : "Connected") : ""} onClick={() => setOpen("cloud")} />
        )}
        <button type="button" onClick={syncNow} disabled={syncing || !cloud?.connected} className={`press ${rowBase} focus-ring [--focus-ring-offset:-2px]`}>
          <Icon tone="--color-sys-green">
            <ArrowsClockwise size={15} weight="bold" />
          </Icon>
          <span className="flex-1">{sync && !syncsNow(sync) ? "Back up now" : "Sync now"}</span>
          {syncing || sync?.state === "syncing" ? <span className="shimmer accent inline-block h-[3px] w-20 rounded-[3px] bg-line" role="img" aria-label="Syncing" /> : <span key={sync?.state} className="settle text-[13px] text-ink-3">{last ? capital(relativeTime(last)) : ""}</span>}
        </button>
        <NavRow icon={<Icon tone="--color-sys-gray"><FileArrowUp size={15} weight="fill" /></Icon>} label="Restore from a file" onClick={onRestoreFile} />
        <NavRow icon={<Icon tone="--color-sys-orange"><Crown size={15} weight="fill" /></Icon>} label="KAPEVault Pro" value={pro?.owned ? "On" : pro?.pending ? "Pending" : <ProTag />} onClick={() => setOpen("pro")} />
      </div>

      <p className={groupTitle}>Appearance</p>
      <div className={card}>
        <NavRow icon={<Icon tone="--color-sys-orange"><Sun size={15} /></Icon>} label="Theme" value={settings ? THEME_LABELS[settings.theme] : ""} onClick={() => setOpen("theme")} />
      </div>

      <p className={groupTitle}>On your PC</p>
      <div className={card}>
        {PC_ONLY.map((f) => (
          <div key={f} className={`${rowBase} opacity-50`}>
            <span className="flex-1">{f}</span>
            <span className="flex shrink-0 items-center gap-1 rounded-full bg-field px-2 py-0.5 text-[11.5px] font-semibold text-ink-3">
              <Desktop size={12} />
              PC
            </span>
          </div>
        ))}
      </div>

      <p className={groupTitle}>About</p>
      <div className={card}>
        {/* The way an item's website opens (native.ts openUrl): Capacitor hands the page to the phone's browser. */}
        <NavRow icon={<Icon tone="--color-sys-gray"><ShieldCheck size={15} weight="fill" /></Icon>} label="Privacy policy" onClick={() => void window.open(PRIVACY_URL, "_blank", "noopener")} />
        <NavRow icon={<Icon tone="--color-sys-gray"><Scroll size={15} weight="fill" /></Icon>} label="Open source licences" onClick={() => setOpen("licences")} />
      </div>

      {open === "master" && <ChangeMasterSheet onClose={() => setOpen(null)} onBiometricOff={() => host.biometricStatus().then(setBio)} />}
      {open === "lock-after" && settings && <LockAfterSheet value={settings.lockAfterHours} onPick={(v) => void update({ lockAfterHours: v })} onClose={() => setOpen(null)} />}
      {open === "theme" && settings && <ThemeSheet value={settings.theme} onPick={(v) => void update({ theme: v })} onClose={() => setOpen(null)} />}
      {open === "cloud" && cloud && <CloudSheet status={cloud} onStatus={setCloud} onClose={() => setOpen(null)} />}
      {open === "autofill" && <AutofillSheet onStatus={setFill} onClose={() => setOpen(null)} />}
      {open === "pro" && <ProSheet onClose={() => setOpen(null)} />}
      {open === "licences" && <LicencesSheet onClose={() => setOpen(null)} />}
      {open === "connect" && <ConnectSheet onClose={() => setOpen(null)} onConnected={() => void host.cloudStatus().then(setCloud)} />}
    </div>
  );
}
