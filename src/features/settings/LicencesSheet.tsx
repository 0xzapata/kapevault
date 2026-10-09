import { useEffect, useState } from "react";
import { Sheet } from "@/components/Sheet";
import { Button } from "@/components/form";
import { vaultApi, type LicenceText } from "@/lib/vault-api";

// Settings > General > Open source licences. Main reads the four texts the installer ships; nothing is
// fetched and the page names no file.
export function LicencesSheet({ onClose }: { onClose: () => void }) {
  const [texts, setTexts] = useState<LicenceText[] | null>(null);
  const [version, setVersion] = useState("");

  useEffect(() => {
    vaultApi.licences().then(setTexts, () => setTexts([]));
    vaultApi.appVersion().then(setVersion, () => undefined);
  }, []);

  return (
    <Sheet title="Open source licences" width="w-[760px]" bare onClose={onClose}>
      {(close) => (
        <div className="flex h-[min(640px,calc(100dvh-24px))] flex-col">
          <div className="px-6 pt-5 pb-3 sm:px-7">
            <h2 className="text-[20px] font-semibold tracking-[-0.02em]">Open source licences</h2>
            <p className="mt-1 text-[13px] text-ink-3">
              {version && `KAPEVault ${version}. `}KAPEVault is free software under the GNU GPL v3. See LICENSE.
            </p>
          </div>

          {/* biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region takes the focus so the arrow keys can scroll it */}
          <div tabIndex={0} className="min-h-0 flex-1 space-y-6 overflow-y-auto border-t border-line px-6 py-5 focus-ring focus-ring-inset sm:px-7">
            {texts === null && <p className="text-[13px] text-ink-3">Loading</p>}
            {texts?.length === 0 && <p className="text-[13px] text-ink-3">The licence files could not be read.</p>}
            {texts?.map(({ name, text }) => (
              <section key={name} aria-labelledby={`licence-${name}`}>
                <h3 id={`licence-${name}`} className="text-[13px] font-semibold text-ink-2">
                  {name}
                </h3>
                <pre className="selectable mt-2 whitespace-pre-wrap break-words rounded-[10px] bg-field px-3.5 py-3 font-mono text-[12px] leading-[1.55] text-ink-2">{text}</pre>
              </section>
            ))}
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
