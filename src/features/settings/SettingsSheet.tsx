import { useId, useRef, useState, type KeyboardEvent } from "react";
import { CloudArrowUp, GearSix, ShieldCheck, ArrowSquareIn, type Icon } from "@phosphor-icons/react";
import { Sheet } from "@/components/Sheet";
import { Button } from "@/components/form";
import type { VaultView } from "@/features/vault/types";
import type { RestoreKept } from "@/lib/vault-api";
import { RestoreSheet } from "@/features/cloud/components/RestoreSheet";
import { BackupSection } from "@/features/backup/components/BackupSection";
import { GeneralSection } from "./GeneralSection";
import { SecuritySection } from "./SecuritySection";
import { ImportSection } from "./ImportSection";

export type SettingsSection = "general" | "security" | "backup" | "import";

const SECTIONS: { id: SettingsSection; label: string; icon: Icon }[] = [
  { id: "general", label: "General", icon: GearSix },
  { id: "security", label: "Security", icon: ShieldCheck },
  { id: "backup", label: "Backup", icon: CloudArrowUp },
  { id: "import", label: "Import", icon: ArrowSquareIn },
];

interface SettingsSheetProps {
  onClose: () => void;
  onImported: (vault: VaultView) => void;
  onRestored: (vault: VaultView, kept: RestoreKept) => void; // a file restore opened the restored vault
  onShowShortcuts: () => void;
  initialSection?: SettingsSection;
}

// Section list on the left from sm up; a segmented tab row above the content below that.
export function SettingsSheet({ onClose, onImported, onRestored, onShowShortcuts, initialSection = "general" }: SettingsSheetProps) {
  const [section, setSection] = useState<SettingsSection>(initialSection);
  // A file restore: picked in its sheet, or the replaced vault, already picked (its name).
  const [restoring, setRestoring] = useState<{ replaced?: string } | null>(null);
  const tabRefs = useRef<Partial<Record<SettingsSection, HTMLButtonElement | null>>>({});
  const ids = useId();

  function onTabKey(e: KeyboardEvent) {
    const i = SECTIONS.findIndex((s) => s.id === section);
    let next = -1;
    if (e.key === "ArrowDown" || e.key === "ArrowRight") next = (i + 1) % SECTIONS.length;
    if (e.key === "ArrowUp" || e.key === "ArrowLeft") next = (i - 1 + SECTIONS.length) % SECTIONS.length;
    if (e.key === "Home") next = 0;
    if (e.key === "End") next = SECTIONS.length - 1;
    if (next < 0) return;
    e.preventDefault();
    const id = SECTIONS[next].id;
    setSection(id);
    tabRefs.current[id]?.focus();
  }

  // One dialog at a time: Settings steps aside while the restore sheet is up, and comes back on Backup.
  if (restoring) {
    return (
      <RestoreSheet
        initialTab="file"
        replaced={restoring.replaced}
        onClose={() => setRestoring(null)}
        onOpened={(vault, kept) => {
          onRestored(vault, kept);
          onClose();
        }}
      />
    );
  }

  return (
    <Sheet title="Settings" width="w-[760px]" bare onClose={onClose}>
      {(close) => (
        <div className="flex h-[min(640px,calc(100dvh-24px))] flex-col">
          <h2 className="px-6 pt-5 pb-3 text-[20px] font-semibold tracking-[-0.02em] sm:px-7 [@media(max-height:700px)]:pt-4 [@media(max-height:700px)]:pb-2">Settings</h2>

          <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
            <div
              role="tablist"
              aria-label="Settings sections"
              onKeyDown={onTabKey}
              className="mx-4 flex shrink-0 rounded-full bg-field p-1 sm:mx-0 sm:w-[184px] sm:flex-col sm:gap-0.5 sm:rounded-none sm:bg-transparent sm:px-3 sm:py-1"
            >
              {SECTIONS.map(({ id, label, icon: Glyph }) => {
                const selected = section === id;
                return (
                  <button
                    key={id}
                    ref={(el) => {
                      tabRefs.current[id] = el;
                    }}
                    type="button"
                    role="tab"
                    id={`${ids}-${id}-tab`}
                    aria-selected={selected}
                    aria-controls={`${ids}-${id}-panel`}
                    tabIndex={selected ? 0 : -1}
                    onClick={() => setSection(id)}
                    className={`row flex h-8 min-w-0 flex-1 items-center justify-center gap-2 rounded-full px-2 text-[13px] font-medium focus-ring sm:flex-none sm:justify-start sm:rounded-[8px] sm:px-2.5 sm:text-[13.5px] ${
                      selected ? "bg-raised text-ink shadow-tile sm:bg-accent sm:text-on-accent sm:shadow-none" : "text-ink-2 hover:text-ink sm:hover:bg-hover"
                    }`}
                  >
                    <Glyph size={17} weight={selected ? "fill" : "regular"} className="hidden shrink-0 sm:block" />
                    <span className="truncate">{label}</span>
                  </button>
                );
              })}
            </div>

            <div
              key={section}
              role="tabpanel"
              id={`${ids}-${section}-panel`}
              aria-labelledby={`${ids}-${section}-tab`}
              tabIndex={0}
              className="settle mt-3 flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-5 pb-6 focus-ring focus-ring-inset sm:mt-0 sm:border-l sm:border-line sm:px-7 sm:pt-1"
            >
              {section === "general" && (
                <GeneralSection
                  onShowShortcuts={() => {
                    close(); // one sheet at a time: two would both close on a single Escape
                    onShowShortcuts();
                  }}
                />
              )}
              {section === "security" && <SecuritySection />}
              {section === "backup" && <BackupSection onRestoreFromFile={(replaced) => setRestoring({ replaced })} />}
              {section === "import" && <ImportSection onImported={onImported} />}
            </div>
          </div>

          <div className="flex shrink-0 justify-end border-t border-line px-5 py-3 sm:px-7">
            <Button type="button" onClick={close}>
              Done
            </Button>
          </div>
        </div>
      )}
    </Sheet>
  );
}
