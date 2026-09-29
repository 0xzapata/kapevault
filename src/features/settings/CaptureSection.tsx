import { useEffect, useState } from "react";
import { EyeSlash } from "@phosphor-icons/react";
import { vaultApi } from "@/lib/vault-api";
import { isMac } from "@/lib/platform";
import { Group, SwitchRow } from "./SettingRow";

const TITLE = "Hide from screen capture";

// On: screenshots, recordings and screen sharing leave KAPEVault out (main's setContentProtection).
export function CaptureSection() {
  const [hidden, setHidden] = useState<boolean | null>(null);

  useEffect(() => {
    vaultApi.getSettings().then((s) => setHidden(s.hideFromCapture));
  }, []);

  async function update(hideFromCapture: boolean) {
    setHidden(hideFromCapture); // the switch answers at once; main confirms
    setHidden((await vaultApi.setSettings({ hideFromCapture })).hideFromCapture);
  }

  return (
    <Group title="Screen">
      <SwitchRow
        title={TITLE}
        icon={<EyeSlash size={18} weight="bold" />}
        checked={hidden ?? true}
        disabled={hidden === null}
        onChange={update}
        note={
          hidden === false
            ? `Screenshots, recordings and screen sharing show KAPEVault, with any password you reveal. So do the ${isMac ? "Mission Control" : "taskbar and Alt-Tab"} previews.`
            : "Screenshots, recordings and screen sharing leave KAPEVault out. Turn off to share your screen with it."
        }
      />
    </Group>
  );
}
