import { useEffect, useState } from "react";
import { ArrowsClockwise, CaretDown } from "@phosphor-icons/react";
import { Button } from "../../components/form";
import { Card, SecretField } from "../../components/fields";
import { Sheet } from "../../components/Sheet";
import { useCopyAction, useToast } from "../../components/Toast";
import { rowIcon } from "../../components/buttons";
import { useHost } from "../../host/host-context";
import { relativeTime } from "../../lib/format";
import { DEFAULT_GENERATOR, generatePassword } from "../../lib/generate-password";
import type { GeneratedRow } from "../../host/types";

const textButton = "press hit h-8 rounded-full px-3 text-[12.5px] font-semibold focus-ring";

// The PC's generator popover as a sheet: a new password, Copy, Use password, and Recent - the last values
// that left the generator, kept in the vault even when the item form is lost before it is saved.
export function GeneratorSheet({ onUse, onClose }: { onUse: (password: string) => void; onClose: () => void }) {
  const host = useHost();
  const toast = useToast();
  const copy = useCopyAction();
  const [password, setPassword] = useState(() => generatePassword(DEFAULT_GENERATOR));
  const [recent, setRecent] = useState<GeneratedRow[]>([]);
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    host.generatedList().then(setRecent, () => {}); // a locked vault shows the lock screen
  }, [host]);

  // A value is kept the moment it leaves the generator (copied, selected and copied, or used), before the
  // item is saved. A new password keeps nothing.
  async function keep(value: string) {
    try {
      setRecent(await host.recordGenerated(value));
    } catch {
      toast("Could not keep this one in Recent", "error");
    }
  }

  async function clear() {
    setRecent(await host.clearGenerated());
    setConfirming(false);
    toast("Recent cleared");
  }

  return (
    <Sheet
      title="New password"
      onClose={onClose}
      footer={(close) => (
        <>
          <Button
            onClick={() =>
              copy.run(async () => {
                await keep(password);
                await host.copyText(password);
              }, "Password copied")
            }
          >
            {copy.copied ? "Copied" : "Copy"}
          </Button>
          <span className="flex-1" />
          <Button
            variant="primary"
            onClick={() => {
              void keep(password);
              onUse(password);
              close();
            }}
          >
            Use password
          </Button>
        </>
      )}
    >
      {() => (
        <>
          <div className="mt-4 flex items-start gap-1 rounded-[10px] bg-field py-2 pl-3 pr-1">
            <p onCopy={() => void keep(password)} className="selectable min-h-11 min-w-0 flex-1 break-all py-1 font-mono text-[15px] leading-[22px]">
              {password}
            </p>
            <button type="button" aria-label="New password" onClick={() => setPassword(generatePassword(DEFAULT_GENERATOR))} className={rowIcon}>
              <ArrowsClockwise size={16} weight="bold" />
            </button>
          </div>

          {recent.length > 0 && (
            <Card className="mt-5">
              <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="press flex min-h-[52px] w-full items-center justify-between gap-3 px-4 text-left text-[14px] font-semibold focus-ring">
                Recent ({recent.length})
                <CaretDown size={13} weight="bold" className={`shrink-0 text-ink-3 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
              </button>
              {open && (
                <div className="settle border-t border-line">
                  {recent.map((row, i) => (
                    <SecretField
                      // biome-ignore lint/suspicious/noArrayIndexKey: recent passwords are addressed by position; the timestamp in the key makes a shifted list remount its rows, so a revealed password never sticks to another one
                      key={`${row.at}-${i}`}
                      label={relativeTime(Date.parse(row.at))}
                      what="generated password"
                      reveal={() => host.getGenerated(i)}
                      copy={() => host.copyGenerated(i)}
                      copiedToast="Password copied - clears in 30s"
                    />
                  ))}
                  <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-3 py-2">
                    {confirming ? (
                      <>
                        <span className="mr-auto px-1 text-[12.5px] text-ink-3">These cannot be brought back.</span>
                        <button type="button" onClick={() => setConfirming(false)} className={`${textButton} text-ink-2`}>
                          Cancel
                        </button>
                        <button type="button" onClick={() => void clear()} className={`${textButton} bg-danger-soft text-danger`}>
                          Confirm clear
                        </button>
                      </>
                    ) : (
                      <button type="button" onClick={() => setConfirming(true)} className={`${textButton} text-danger`}>
                        Clear
                      </button>
                    )}
                  </div>
                </div>
              )}
            </Card>
          )}
        </>
      )}
    </Sheet>
  );
}
