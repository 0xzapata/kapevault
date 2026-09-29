import { useEffect, useState } from "react";
import { useHost } from "./host/host-context";
import { useKeyboardInset } from "./hooks/use-keyboard-inset";
import { useLockOnLeave } from "./hooks/use-lock-on-leave";
import { useTheme } from "./hooks/use-theme";
import { FillPicker } from "./features/autofill/FillPicker";
import { useFillRequest } from "./features/autofill/use-fill-request";
import { CreateVault } from "./features/first-run/CreateVault";
import { RestoreFromBackup } from "./features/first-run/RestoreFromBackup";
import { HomeScreen } from "./features/home/HomeScreen";
import { useSettings } from "./features/settings/settings-context";
import { UnlockScreen } from "./features/unlock/UnlockScreen";
import type { LockReason, VaultState } from "./host/types";

// Which screen the vault's state calls for. First run makes a vault on the phone; Restore from backup
// (a link there and on the lock screen) brings one from R2 or a file, and Settings > Restore from a file
// from a file; each goes back where it came from. They stay up until their last step even though the
// vault is unlocked by then - and through a lock, which leaving for the file picker can cause.
export function App() {
  const host = useHost();
  const { settings } = useSettings();
  const [state, setState] = useState<VaultState | null>(null);
  const [reason, setReason] = useState<LockReason>();
  const [onboarding, setOnboarding] = useState<"create" | "restore-new" | "restore" | "restore-file" | null>(null);
  const [backToSettings, setBackToSettings] = useState(false); // Settings > Restore from a file, cancelled
  const fillTarget = useFillRequest();

  useEffect(() => {
    host.state().then((s) => {
      setState(s);
      if (s === "first-run") setOnboarding("create");
    });
    return host.onState((s, why) => {
      setState(s);
      setReason(why);
      if (s !== "unlocked") setBackToSettings(false); // once: the next unlock opens on the items
    });
  }, [host]);

  useTheme(settings?.theme ?? "system");
  useKeyboardInset();
  useLockOnLeave(state === "unlocked", settings?.lockGrace ?? 30, () => void host.lock("background"));

  if (state === null) return null;
  if (onboarding === "create") return <CreateVault onRestore={() => setOnboarding("restore-new")} onDone={() => setOnboarding(null)} />;
  if (onboarding)
    return (
      <RestoreFromBackup
        fromFile={onboarding === "restore-file"}
        onCancel={() => {
          setBackToSettings(onboarding === "restore-file");
          setOnboarding(onboarding === "restore-new" ? "create" : null);
        }}
        onDone={() => {
          setBackToSettings(false);
          setOnboarding(null);
        }}
      />
    );
  // Another app asked to be filled (Android autofill): its picker opens over the vault once it is unlocked.
  if (state === "unlocked")
    return (
      <>
        <HomeScreen startTab={backToSettings ? "settings" : "items"} onRestoreFile={() => setOnboarding("restore-file")} />
        {fillTarget && <FillPicker key={JSON.stringify(fillTarget)} target={fillTarget} />}
      </>
    );
  return <UnlockScreen reason={reason} onRestore={() => setOnboarding("restore")} />;
}
