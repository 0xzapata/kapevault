import { useEffect, useState } from "react";
import { autofill, type FillTarget } from "../../host/autofill";

// The fill request waiting for a pick, or null. Asked for when the page starts and whenever the app
// comes back to the front (a request can arrive while the page is paused), and followed live.
export function useFillRequest() {
  const [target, setTarget] = useState<FillTarget | null>(null);
  useEffect(() => {
    let live = true;
    const check = () => void autofill.pending().then((t) => live && setTarget(t), () => {});
    check();
    const off = autofill.listen(
      (t) => live && setTarget(t),
      () => live && setTarget(null),
    );
    window.addEventListener("kapevault:resume", check);
    return () => {
      live = false;
      off();
      window.removeEventListener("kapevault:resume", check);
    };
  }, []);
  return target;
}
