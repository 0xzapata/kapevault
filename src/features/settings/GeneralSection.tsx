import { useEffect, useId, useState } from "react";
import { Keyboard, WarningCircle } from "@phosphor-icons/react";
import { Button, ErrorText, Select } from "@/components/form";
import { ConfirmDelete } from "@/components/ConfirmDelete";
import { vaultApi, type AppSettings, type SessionLimitHours } from "@/lib/vault-api";
import { isMac, keys } from "@/lib/platform";
import { formatDay, localToday } from "@/lib/local-date";
import { Group, Kbd, SwitchRow } from "./SettingRow";
import { ThemePicker } from "./ThemePicker";
import { hoursText } from "./lib/session-limit";

const HOTKEY = keys("mod", "shift", "Space");

export function GeneralSection({ onShowShortcuts }: { onShowShortcuts: () => void }) {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [path, setPath] = useState("");
  const [oldError, setOldError] = useState("");
  const limitId = useId();

  useEffect(() => {
    vaultApi.getSettings().then(setSettings);
    vaultApi.status().then((s) => setPath(s.path));
  }, []);

  async function update(patch: Partial<AppSettings>) {
    setSettings((s) => (s ? { ...s, ...patch } : s)); // the switch answers at once; main confirms
    setSettings(await vaultApi.setSettings(patch));
  }

  // BOVault's old folder goes only on a confirm with the OLD vault's master password, and only while
  // this vault is unlocked (main checks both).
  async function removeOldCopy(master: string) {
    setOldError("");
    const result = await vaultApi.removeOldCopy(master);
    if (result.ok) setSettings(result.settings);
    else setOldError(result.error);
  }

  const startLabel = isMac ? "Open at login" : "Start with Windows";
  const hotkeyTaken = settings?.quickSearch && !settings.hotkeyOk;

  return (
    <>
      <Group title="Appearance">
        <ThemePicker value={settings?.theme} disabled={!settings} onChange={(theme) => update({ theme })} />
        <p className="text-[12.5px] text-ink-3">System follows {isMac ? "macOS" : "Windows"} light and dark. Colorblind never tells good from bad by red and green alone.</p>
      </Group>

      <Group title="Quick access">
        <SwitchRow
          title="Quick search"
          badge={<Kbd>{HOTKEY}</Kbd>}
          checked={settings?.quickSearch ?? false}
          disabled={!settings}
          onChange={(quickSearch) => update({ quickSearch })}
          note={
            <>
              Keeps KAPEVault in the tray when you close the window, locked.
              {hotkeyTaken && <span className="mt-1 block text-warn">Another app is using {HOTKEY}.</span>}
            </>
          }
        />
        <SwitchRow
          title={startLabel}
          checked={settings?.startWithWindows ?? false}
          disabled={!settings?.canStartWithOs}
          onChange={(startWithWindows) => update({ startWithWindows })}
          note={settings && !settings.canStartWithOs ? "Available in the installed app." : "Starts in the tray, locked."}
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="min-w-0 flex-1 text-[12.5px] text-ink-3">
            Every shortcut in one sheet. It also opens with <Kbd>{keys("mod", "/")}</Kbd>
          </p>
          <Button type="button" className="flex shrink-0 items-center gap-1.5" onClick={onShowShortcuts}>
            <Keyboard size={15} weight="bold" />
            Keyboard shortcuts
          </Button>
        </div>
      </Group>

      <Group title="Vault file">
        <p className="-mt-2 text-[13px] text-ink-3">
          Encrypted with AES-256-GCM. Locks after 5 minutes idle, on sleep, and when {isMac ? "the Mac" : "Windows"} locks. Copied passwords clear after 30 seconds
          {isMac ? "." : ", and are kept out of Windows clipboard history (Win+V)."}
        </p>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <label htmlFor={limitId} className="text-[13.5px] text-ink">
              Lock after
            </label>
            <p id={`${limitId}-note`} className="mt-0.5 text-[12.5px] text-ink-3">
              Counted from when you unlock, even while you use it.
            </p>
          </div>
          <Select
            id={limitId}
            aria-describedby={`${limitId}-note`}
            value={settings?.sessionLimitHours ?? 8}
            disabled={!settings}
            onChange={(e) => update({ sessionLimitHours: Number(e.target.value) as SessionLimitHours })}
            className="w-[140px] shrink-0"
          >
            {(settings?.sessionLimitOptions ?? [8]).map((h) => (
              <option key={h} value={h}>
                {hoursText(h)}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex items-center gap-2 rounded-[10px] bg-field px-3 py-2.5">
          <span className="selectable min-w-0 flex-1 truncate font-mono text-[12.5px] text-ink-2" title={path}>
            {path}
          </span>
          <Button type="button" className="h-8 shrink-0 bg-raised" onClick={() => vaultApi.revealFile()}>
            Show file
          </Button>
        </div>
      </Group>

      {/* Left from before the rename: the old vault stays until deleted here; an old install keeps its hotkey. */}
      {(settings?.oldCopy || settings?.oldInstall) && (
        <Group title="Old BOVault">
          {settings.oldCopy && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[12px] bg-field px-3.5 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-[13.5px] font-medium text-ink">Old vault</p>
                <p className="text-[12.5px] text-ink-3">
                  {formatDay(localToday(new Date(settings.oldCopy.modifiedAt)))} · Opens with your old master password.
                </p>
              </div>
              <ConfirmDelete
                password={{
                  label: "Old master password",
                  note: (
                    <>
                      It may be the only copy of that vault, so only its own password deletes it. Forgot it? Delete the folder by hand:{" "}
                      <span className="selectable break-all font-mono">{settings.oldCopy.path.replace(/[\\/][^\\/]*$/, "")}</span>
                    </>
                  ),
                }}
                onConfirm={removeOldCopy}
              />
            </div>
          )}
          <ErrorText message={oldError} />
          {settings.oldInstall && (
            <div className="space-y-1.5">
              <p className="flex items-start gap-2 text-[12.5px] text-warn">
                <WarningCircle size={16} weight="fill" className="mt-px shrink-0" />
                BOVault is still installed and holds {HOTKEY}. Uninstall it in Windows Settings.
              </p>
              <p className="selectable truncate font-mono text-[12.5px] text-ink-2" title={settings.oldInstall}>
                {settings.oldInstall}
              </p>
            </div>
          )}
        </Group>
      )}
    </>
  );
}
