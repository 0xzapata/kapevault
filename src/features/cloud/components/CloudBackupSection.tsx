import { CloudArrowUp, CloudCheck, CloudWarning, WarningCircle } from "@phosphor-icons/react";
import { Button, ErrorText, Switch } from "@/components/form";
import { SyncCard } from "@/features/sync/components/SyncCard";
import { useSync } from "@/features/sync/hooks/use-sync";
import { useCloudBackup } from "../hooks/use-cloud-backup";
import { formatWhen } from "@/lib/format";
import { AddPhone } from "./AddPhone";
import { CredentialsForm } from "./CredentialsForm";
import { OlderBackupsNotice } from "./OlderBackupsNotice";
import { SnapshotList } from "./SnapshotList";

// Settings section: connect an R2 bucket, then back up, list, and restore.
export function CloudBackupSection() {
  const cloud = useCloudBackup();
  const sync = useSync();
  const settings = cloud.status?.settings;
  const last = cloud.status?.last;

  let line = "Not backed up yet this session.";
  let Icon = CloudArrowUp;
  if (last?.state === "ok" && last.at) {
    line = `Last backup ${formatWhen(last.at)}`;
    Icon = CloudCheck;
  }
  if (last?.state === "error") {
    line = `Last backup failed: ${last.error}`;
    Icon = CloudWarning;
  }
  if (cloud.busy === "backup") line = "Backing up...";

  return (
    <section className="mt-7 border-t border-line pt-6">
      <h3 className="text-[13px] font-semibold text-ink-2">Cloud backup</h3>
      <p className="mt-1 text-[13px] text-ink-3">
        Keep copies of the vault in your own Cloudflare R2 bucket. Only the encrypted file is uploaded - a backup opens with your master password and nothing else.
      </p>

      {cloud.status && !settings && (
        <div className="mt-4">
          <CredentialsForm submitLabel="Connect" busyLabel="Connecting..." busy={cloud.busy === "connect"} error={cloud.error} onSubmit={cloud.connect} />
        </div>
      )}

      {settings && (
        <div className="settle mt-4 space-y-4">
          <div className="flex items-center gap-3 rounded-[12px] bg-field px-3.5 py-3">
            <Icon size={22} weight="duotone" className={last?.state === "error" ? "text-danger" : "text-accent"} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13.5px] font-medium text-ink">{settings.url.replace(/^https:\/\//, "")}</p>
              <p className={`truncate text-[12.5px] ${last?.state === "error" ? "text-danger" : "text-ink-3"}`}>{line}</p>
            </div>
            <Button type="button" className="h-8 bg-raised" disabled={cloud.busy !== null} onClick={cloud.backupNow}>
              Back up now
            </Button>
          </div>

          {sync.status && sync.status.off !== "no-cloud" && <SyncCard status={sync.status} busy={sync.busy} onSyncNow={sync.syncNow} />}

          <AddPhone />

          {cloud.status?.openerReplaced && (
            <p className="settle flex items-center gap-2 text-[12.5px] text-warn">
              <WarningCircle size={16} weight="fill" className="shrink-0" />
              Someone changed the Opener in your bucket. KAPEVault put the real one back - open vaults with the Opener from your kit or a saved copy.
            </p>
          )}

          <label className="flex items-center justify-between gap-4">
            <span className="text-[13.5px] text-ink">
              Back up automatically
              <span className="block text-[12.5px] text-ink-3">A few seconds after each change.</span>
            </span>
            <Switch label="Back up automatically" checked={settings.auto} onChange={cloud.setAuto} />
          </label>

          {settings.olderBackups && <OlderBackupsNotice />}

          <ErrorText message={cloud.error} />

          <div>
            <p className="mb-2 text-[12.5px] font-medium text-ink-2">Backups</p>
            <SnapshotList snapshots={cloud.snapshots} onRestore={cloud.restore} />
            <p className="mt-2 text-[12px] text-ink-3">Keeps the newest 20, then one a day for 60 days.</p>
          </div>

          <div className="flex justify-end">
            <Button type="button" variant="danger" onClick={cloud.disconnect}>
              Disconnect
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
