import { useRef, useState } from "react";
import { MagicWand, Plus, X } from "@phosphor-icons/react";
import { EyeButton, TextInput } from "@/components/form";
import { fieldIconButton } from "@/components/buttons";
import { vaultApi } from "@/lib/vault-api";
import type { QuestionInput, SecurityQuestion } from "@/features/vault/types";
import { inventAnswer } from "../lib/invent-answer";

interface QuestionsInputProps {
  entryId?: string; // editing: a saved answer loads from main when its row asks for it
  saved: SecurityQuestion[];
  onChange: (questions: QuestionInput[]) => void; // not called until something is edited
}

// answer null = a saved answer not loaded (main keeps it unless the row changes it); from = its index
// in the saved list.

const MAX_QUESTIONS = 10; // main's limits (cleanQuestions) - keep in step
const MAX_QUESTION = 300;
const MAX_ANSWER = 200;
interface Row {
  key: number;
  question: string;
  answer: string | null;
  from?: number;
  shown: boolean;
}

const textButton = "press flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-semibold text-accent hover:bg-accent-soft focus-ring";

// The "Security questions" group of a login's form: add or remove rows, type or invent an answer.
export function QuestionsInput({ entryId, saved, onChange }: QuestionsInputProps) {
  const nextKey = useRef(saved.length);
  const [rows, setRows] = useState<Row[]>(() => saved.map((q, i) => ({ key: i, question: q.question, answer: q.hasAnswer ? null : "", from: i, shown: false })));

  function update(next: Row[]) {
    setRows(next);
    onChange(next.map((r) => ({ question: r.question, answer: r.answer ?? undefined, from: r.from })));
  }

  const change = (key: number, patch: Partial<Row>) => update(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  function add() {
    update([...rows, { key: nextKey.current++, question: "", answer: "", shown: false }]);
  }

  // Show on a saved answer fetches just that one. A row typed into meanwhile keeps what was typed.
  async function toggleShown(r: Row) {
    if (r.shown || r.answer !== null || !entryId || r.from === undefined) return change(r.key, { shown: !r.shown });
    try {
      const stored = await vaultApi.getSecret(entryId, "answer", r.from);
      setRows((rs) => rs.map((x) => (x.key === r.key ? { ...x, answer: x.answer ?? stored, shown: true } : x)));
    } catch {
      // Locked: the lock screen takes over.
    }
  }

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <span className="text-[12.5px] font-medium text-ink-2">Security questions</span>
        <button type="button" onClick={add} disabled={rows.length >= MAX_QUESTIONS} className={`${textButton} -mr-2 disabled:opacity-40`}>
          <Plus size={13} weight="bold" />
          Add question
        </button>
      </div>
      <p className="text-[12px] leading-relaxed text-ink-3">
        Answers don't need to be true - KAPEVault remembers them.
      </p>
      {rows.length > 0 && (
        <ol aria-label="Security questions" className="mt-2.5 space-y-2.5">
          {rows.map((r, i) => (
            <li key={r.key} className="settle space-y-2 rounded-[12px] border border-line p-2.5">
              <div className="flex items-center gap-1.5">
                <TextInput
                  aria-label={`Question ${i + 1}`}
                  autoFocus={r.from === undefined && !r.question}
                  value={r.question}
                  maxLength={MAX_QUESTION}
                  onChange={(e) => change(r.key, { question: e.target.value })}
                  placeholder="Name of your first pet?"
                />
                <button type="button" aria-label={`Remove question ${i + 1}`} title="Remove question" onClick={() => update(rows.filter((x) => x.key !== r.key))} className={fieldIconButton}>
                  <X size={15} />
                </button>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="relative min-w-0 flex-1">
                  <TextInput
                    aria-label={`Answer ${i + 1}`}
                    type={r.shown ? "text" : "password"}
                    value={r.answer ?? ""}
                    maxLength={MAX_ANSWER}
                    onChange={(e) => change(r.key, { answer: e.target.value })}
                    placeholder={r.answer === null ? "Saved - type to change" : "Answer"}
                    spellCheck={false}
                    autoComplete="off"
                    className="pr-11 font-mono"
                  />
                  <EyeButton shown={r.shown} what={`answer ${i + 1}`} onClick={() => toggleShown(r)} className="absolute right-1.5 top-1/2 -translate-y-1/2" />
                </div>
                <button
                  type="button"
                  aria-label={`Invent answer ${i + 1}`}
                  title="Make up a memorable answer"
                  onClick={() => change(r.key, { answer: inventAnswer(r.answer ?? ""), shown: true })}
                  className={`${textButton} bg-accent-soft hover:brightness-95`}
                >
                  <MagicWand size={14} />
                  Invent
                </button>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
