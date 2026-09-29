import { useState } from "react";
import { Eye, EyeSlash, Phone } from "@phosphor-icons/react";
import { vaultApi } from "@/lib/vault-api";
import { useReveal } from "@/hooks/use-reveal";
import { Card } from "@/components/Card";
import { CopyButton, IconButton } from "@/components/IconButton";
import type { LoginEntry, SecurityQuestion } from "@/features/vault/types";
import { HotlineView } from "./HotlineView";

// A login's security questions on the detail pane: questions in plain sight, each answer masked until
// revealed (one fetch from main), copied through main, or opened full-window in Hotline mode.
export function SecurityQuestions({ entry }: { entry: LoginEntry }) {
  const [hotline, setHotline] = useState<number | null>(null);
  if (entry.questions.length === 0) return null;

  return (
    <section aria-label="Security questions" className="mt-5">
      <Card>
        <p className="px-4 pb-1 pt-3.5 text-[14px] font-medium @md:px-5">Security questions</p>
        <ol>
          {entry.questions.map((q, i) => (
            <QuestionRow key={i} entryId={entry.id} question={q} index={i} onHotline={() => setHotline(i)} />
          ))}
        </ol>
      </Card>
      {hotline !== null && <HotlineView entryId={entry.id} title={entry.title} questions={entry.questions} start={hotline} onClose={() => setHotline(null)} />}
    </section>
  );
}

function QuestionRow({ entryId, question: q, index: i, onHotline }: { entryId: string; question: SecurityQuestion; index: number; onHotline: () => void }) {
  const answer = useReveal(() => vaultApi.getSecret(entryId, "answer", i));
  const shown = answer.value !== null;

  return (
    <li className="flex min-h-14 items-center gap-3 border-b border-line px-4 py-2.5 last:border-b-0 @md:px-5">
      <div className="min-w-0 flex-1">
        <p className="selectable break-words text-[13px] text-ink-3">{q.question}</p>
        {q.hasAnswer ? (
          <p className="selectable mt-0.5 truncate font-mono text-[14px] tracking-wide">{answer.value ?? "•".repeat(12)}</p>
        ) : (
          <p className="mt-0.5 text-[14px] text-ink-3">No answer saved</p>
        )}
      </div>
      {q.hasAnswer && (
        <div className="flex shrink-0 gap-0.5">
          <IconButton label={shown ? `Hide answer ${i + 1}` : `Reveal answer ${i + 1}`} onClick={answer.toggle}>
            {shown ? <EyeSlash size={16} /> : <Eye size={16} />}
          </IconButton>
          <CopyButton label={`Copy answer ${i + 1} (clears in 30s)`} copy={() => vaultApi.copySecret(entryId, "answer", i)} toastText="Answer copied - clears in 30s" />
          <IconButton label={`Phone call view, question ${i + 1}`} onClick={onHotline}>
            <Phone size={16} />
          </IconButton>
        </div>
      )}
    </li>
  );
}
