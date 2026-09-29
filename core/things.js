// Where Is It (the thing kind): the order things are grabbed in, the same on the Evacuate view
// (src/features/things) and its printed page (electron/evacuation.cjs).

/**
 * Grab first, then by room (things with no room last, any case), then by title.
 * @template {{ grab: number, room?: string, title: string }} T
 * @param {T[]} things @returns {T[]} a sorted copy
 */
export function evacuationOrder(things) {
  const room = (/** @type {T} */ t) => (t.room ?? "").trim();
  return [...things].sort(
    (a, b) =>
      a.grab - b.grab ||
      Number(!room(a)) - Number(!room(b)) ||
      room(a).localeCompare(room(b), undefined, { sensitivity: "base" }) ||
      a.title.localeCompare(b.title),
  );
}
