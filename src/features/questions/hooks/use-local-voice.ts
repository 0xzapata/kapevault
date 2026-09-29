import { useCallback, useEffect, useRef, useState } from "react";

// A system voice that runs on this machine (localService), so reading an answer aloud never sends
// it anywhere. English first, since the spelling is English. null = none, and Read aloud hides.
function localVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis?.getVoices().filter((v) => v.localService) ?? [];
  return voices.find((v) => v.lang.startsWith("en") && v.default) ?? voices.find((v) => v.lang.startsWith("en")) ?? voices[0] ?? null;
}

export function useLocalVoice() {
  const [voice, setVoice] = useState<SpeechSynthesisVoice | null>(localVoice);
  const [speaking, setSpeaking] = useState(false);
  const current = useRef<SpeechSynthesisUtterance | null>(null);

  // Chromium lists the voices a moment after the page loads.
  useEffect(() => {
    const synth = window.speechSynthesis;
    if (!synth) return;
    const refresh = () => setVoice(localVoice());
    synth.addEventListener("voiceschanged", refresh);
    return () => {
      synth.removeEventListener("voiceschanged", refresh);
      synth.cancel(); // leaving the view stops the voice mid-sentence
    };
  }, []);

  function speak(text: string) {
    if (!voice) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.voice = voice;
    utterance.lang = voice.lang;
    utterance.rate = 0.85; // slow enough to write down
    // cancel() ends the previous utterance a moment later; only the one speaking now may say it stopped.
    utterance.onend = utterance.onerror = () => current.current === utterance && setSpeaking(false);
    current.current = utterance;
    setSpeaking(true);
    window.speechSynthesis.speak(utterance);
  }

  const stop = useCallback(() => {
    current.current = null;
    window.speechSynthesis?.cancel();
    setSpeaking(false);
  }, []);

  return { available: voice !== null, speaking, speak, stop };
}
