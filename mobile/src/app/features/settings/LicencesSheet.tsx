import { useEffect, useState } from "react";
import { Button } from "../../components/form";
import { Sheet } from "../../components/Sheet";

type Notices = typeof import("virtual:kapevault-notices").default;

// Settings > About > Open source licences. The texts are made at build time from what ships in the app
// (mobile/scripts/lib/notices.mjs) and load in a chunk of their own, so nothing is read until this opens.
export function LicencesSheet({ onClose }: { onClose: () => void }) {
  const [notices, setNotices] = useState<Notices | null>(null);

  useEffect(() => {
    import("virtual:kapevault-notices").then((m) => setNotices(m.default));
  }, []);

  return (
    <Sheet title="Open source licences" tall onClose={onClose} footer={(close) => (<><span className="flex-1" /><Button onClick={close}>Done</Button></>)}>
      {() => (
        <>
          <p className="mt-3 text-[13px] leading-relaxed text-ink-2">
            {notices && `KAPEVault ${notices.version}. `}KAPEVault is free software under the GNU GPL v3. See LICENSE.
          </p>
          <div className="mt-5 space-y-6">
            {notices?.sections.map(({ name, text }) => (
              <section key={name} aria-labelledby={`licence-${name}`}>
                <h3 id={`licence-${name}`} className="text-[13px] font-semibold text-ink-2">
                  {name}
                </h3>
                <pre className="selectable mt-2 whitespace-pre-wrap break-words rounded-[10px] bg-field px-3 py-2.5 font-mono text-[11.5px] leading-[1.55] text-ink-2">{text}</pre>
              </section>
            ))}
          </div>
        </>
      )}
    </Sheet>
  );
}
