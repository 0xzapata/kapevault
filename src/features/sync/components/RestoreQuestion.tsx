import { Button } from "@/components/form";

const ANSWERS = [
  { everywhere: true, label: "Use it on all devices", note: "Your other devices switch to this vault. What they changed since then is kept as copies." },
  { everywhere: false, label: "Merge it in", note: "Their changes join this vault. Items they deleted stay deleted." },
];

// After a restore sync waits (SYNC.md 3.7): the other devices still hold the newer vault, which would
// undo part of the restore. One question, each answer with what it does to them.
export function RestoreQuestion({ busy, onAnswer }: { busy: boolean; onAnswer: (everywhere: boolean) => void }) {
  return (
    <section aria-label="After the restore" className="space-y-3 rounded-[12px] bg-warn-soft px-3.5 py-3">
      <p className="text-[13.5px] font-medium text-ink">You restored a backup. What about your other devices?</p>
      {ANSWERS.map((answer) => (
        <div key={answer.label} className="flex items-center gap-3">
          <p className="min-w-0 flex-1 text-[12.5px] text-ink-2">{answer.note}</p>
          <Button type="button" className={`h-8 shrink-0 bg-raised ${busy ? "shimmer" : ""}`} disabled={busy} onClick={() => onAnswer(answer.everywhere)}>
            {answer.label}
          </Button>
        </div>
      ))}
    </section>
  );
}
