// A host's event list (onState, onChanged, onSync): add returns the unsubscribe, emit calls every one.
export function listeners<T extends unknown[]>() {
  const set = new Set<(...args: T) => void>();
  return {
    add(fn: (...args: T) => void) {
      set.add(fn);
      return () => void set.delete(fn);
    },
    emit: (...args: T) => set.forEach((fn) => fn(...args)),
  };
}
