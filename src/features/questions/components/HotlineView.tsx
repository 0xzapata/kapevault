import { useCallback, useEffect, useState } from "react";
import { CaretLeft, CaretRight, Check, Copy, SpeakerHigh, Stop, X } from "@phosphor-icons/react";
import { TitleBar } from "@/components/TitleBar";
import { useModal, useSheetExit } from "@/components/Sheet";
import { barPill } from "@/components/buttons";
import { vaultApi } from "@/lib/vault-api";
import { useCopyAction } from "@/hooks/use-copy-action";
import type { SecurityQuestion } from "@/features/vault/types";
import { spell, spellingLine } from "../lib/phonetic";
import { useLocalVoice } from "../hooks/use-local-voice";

interface HotlineViewProps {
  entryId: string;
  title: string;
  questions: SecurityQuestion[];
  start: number;
  onClose: () => void;
}

const pill = "press flex h-11 items-center gap-2 rounded-full px-5 text-[15px] font-semibold focus-ring";
const quiet = `${pill} bg-raised text-accent shadow-tile hover:bg-hover`;
const round = "press grid size-9 place-items-center rounded-full bg-raised text-accent shadow-tile hover:bg-hover aria-disabled:opacity-40 focus-ring";

// Hotline mode: one question and its answer filling the window, big enough to read to an agent on the
// phone, spelled out letter by letter and read aloud by a local system voice. Escape closes.
export function HotlineView({ entryId, title, questions, start, onClose }: HotlineViewProps) {
  const [index, setIndex] = useState(start);
  const [answer, setAnswer] = useState<string | null>(null);
  const { closing, close } = useSheetExit(onClose);
  const modal = useModal(); // the detail pane stays mounted underneath: Tab goes round in here, focus goes back to it after
  const voice = useLocalVoice();
  const copy = useCopyAction();
  const question = questions[index];

  useEffect(() => {
    setAnswer(null);
    if (!question.hasAnswer) return setAnswer("");
    let live = true;
    vaultApi.getSecret(entryId, "answer", index).then((a) => live && setAnswer(a), () => {});
    return () => {
      live = false;
    };
  }, [entryId, index, question.hasAnswer]);

  const stop = voice.stop;
  const go = useCallback(
    (delta: number) => {
      stop();
      setIndex((i) => Math.min(questions.length - 1, Math.max(0, i + delta)));
    },
    [questions.length, stop],
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go]);

  const spelling = answer ? spell(answer) : [];

  return (
    <div data-closing={closing || undefined} className="fixed inset-0 z-50">
      <div {...modal} role="dialog" aria-modal="true" aria-label="Phone call view" tabIndex={-1} className="sheet flex h-full flex-col bg-surface outline-none">
        <TitleBar edgeLeft edgeRight className="px-4">
          <button
            type="button"
            // biome-ignore lint/a11y/noAutofocus: a full-window view opens with the focus on Done
            autoFocus
            onClick={close}
            className={barPill}
          >
            <X size={13} weight="bold" />
            Done
          </button>
        </TitleBar>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex min-h-full max-w-[960px] flex-col justify-center px-8 pb-20 pt-4">
            <div className="flex items-center justify-between gap-4">
              <p className="text-[13px] font-medium text-ink-3">
                {title} <span className="mx-1">·</span> Question {index + 1} of {questions.length}
              </p>
              {questions.length > 1 && (
                <div className="flex gap-2">
                  {/* aria-disabled, not disabled: a disabled button would drop the focus at the first or last question */}
                  <button type="button" aria-label="Previous question" title="Previous question" aria-disabled={index === 0} onClick={() => go(-1)} className={round}>
                    <CaretLeft size={16} weight="bold" />
                  </button>
                  <button type="button" aria-label="Next question" title="Next question" aria-disabled={index === questions.length - 1} onClick={() => go(1)} className={round}>
                    <CaretRight size={16} weight="bold" />
                  </button>
                </div>
              )}
            </div>
            <h2 className="selectable mt-3 text-[clamp(22px,3vw,30px)] font-semibold leading-snug tracking-[-0.02em] text-ink-2">{question.question}</h2>

            {answer === "" ? (
              <p className="mt-8 text-[20px] text-ink-3">No answer saved</p>
            ) : (
              <>
                <p data-hotline-answer className="selectable mt-7 min-h-[1.05em] break-words text-[clamp(44px,7.5vw,92px)] font-bold leading-[1.05] tracking-[-0.035em] text-ink">
                  {answer}
                </p>
                <ol aria-label="Spelled out" className="mt-9 flex flex-wrap gap-2">
                  {spelling.map((s, i) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: the letters of one answer, read-only and replaced whole
                    <li key={i} aria-label={s.say} className="flex min-w-[68px] flex-col items-center rounded-[14px] bg-raised px-3 pb-2 pt-2.5 shadow-tile">
                      <span aria-hidden className={`font-mono text-[26px] font-semibold leading-none ${s.char === " " ? "text-ink-3" : "text-ink"}`}>{s.char === " " ? "␣" : s.char}</span>
                      <span aria-hidden className="mt-1.5 whitespace-nowrap text-[12px] text-ink-3">{s.hint}</span>
                    </li>
                  ))}
                </ol>
              </>
            )}

            <div className="mt-10 flex flex-wrap items-center gap-2.5">
              {answer && voice.available && (
                <button
                  type="button"
                  onClick={() => (voice.speaking ? voice.stop() : voice.speak(`${answer}. Spelled: ${spellingLine(answer)}.`))}
                  className={`${pill} bg-accent text-on-accent shadow-accent hover:brightness-110`}
                >
                  {voice.speaking ? <Stop size={17} weight="fill" /> : <SpeakerHigh size={17} weight="fill" />}
                  {voice.speaking ? "Stop" : "Read aloud"}
                </button>
              )}
              {answer && (
                <button type="button" onClick={() => copy.run(() => vaultApi.copySecret(entryId, "answer", index), "Answer copied - clears in 30s")} className={quiet}>
                  {copy.copied ? <Check size={17} weight="bold" className="swap-in" /> : <Copy size={17} weight="bold" />}
                  {copy.copied ? "Copied" : "Copy answer"}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
