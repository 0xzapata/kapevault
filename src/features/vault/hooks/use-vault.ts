import { useEffect, useMemo, useState } from "react";
import { vaultApi } from "@/lib/vault-api";
import { filterEntries, matchesView } from "../lib/filter-entries";
import { viewOf } from "../lib/views";
import { checkPayee } from "@/features/payee/lib/payee-check";
import { personKey } from "@/features/held-for/lib/held-for";
import type { EntryInput, PayeeEntry, SortOrder, VaultView, ViewFilter } from "../types";

const SORT_KEY = "kapevault.sort";
const SORTS: SortOrder[] = ["recent", "title", "edited"];

// A per-viewer convenience, so storage failing (private profile) just means the default order.
function savedSort(): SortOrder {
  try {
    const value = localStorage.getItem(SORT_KEY) as SortOrder | null;
    return value && SORTS.includes(value) ? value : "recent";
  } catch {
    return "recent";
  }
}

export function useVault(initial: VaultView) {
  const [data, setData] = useState<VaultView>(initial);
  const [chosenView, setView] = useState<ViewFilter>("all");
  const [spaceId, setSpaceId] = useState<string | null>(null);
  const [chosenPerson, setHeldFor] = useState<string | null>(null);
  const [query, setQueryState] = useState("");
  const [sort, setSortState] = useState<SortOrder>(savedSort);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // A hideWhenEmpty view (Payees, Things, Devices, IDs, Closing, Closed) shows in the sidebar only while it holds items: emptying one leaves it.
  const emptied = viewOf(chosenView).hideWhenEmpty && !data.entries.some((e) => matchesView(e, chosenView));
  const view = emptied ? "all" : chosenView;
  // Same for a person: once nothing is held for them, their row and their list go.
  const heldFor = chosenPerson && data.entries.some((e) => personKey(e.heldFor) === personKey(chosenPerson)) ? chosenPerson : null;

  // The main process pushes every change (from this window, quick search, or "recently used").
  useEffect(() => vaultApi.onChanged(setData), []);

  const visible = useMemo(
    () => filterEntries({ entries: data.entries, spaces: data.spaces, view, spaceId, heldFor, query, sort }),
    [data, view, spaceId, heldFor, query, sort],
  );

  // Payee Check: a number in the search is checked against every saved payee, whatever the view.
  const payeeVerdict = useMemo(() => checkPayee(query, data.entries.filter((e): e is PayeeEntry => e.kind === "payee")), [data, query]);

  // The chosen item stays chosen even when an action takes it out of this list (unfavorited in
  // Favorites, fixed in Security) - otherwise the next row would silently take its place and the
  // next shortcut would act on the wrong item. With nothing chosen, the first row is.
  const selected = visible.find((e) => e.id === selectedId) ?? data.entries.find((e) => e.id === selectedId) ?? visible[0] ?? null;

  // A new list or a new search starts from its top row.
  function setQuery(next: string) {
    setQueryState(next);
    setSelectedId(null);
  }

  function setSort(next: SortOrder) {
    setSortState(next);
    try {
      localStorage.setItem(SORT_KEY, next);
    } catch {
      // not remembered this time
    }
  }

  function chooseView(next: ViewFilter) {
    setView(next);
    setSpaceId(null);
    setHeldFor(null);
    setSelectedId(null);
  }

  // Jump to any item (e.g. the Google account an OAuth login signs in through), even if the
  // current view or search would hide it.
  function reveal(id: string) {
    setView("all");
    setSpaceId(null);
    setHeldFor(null);
    setQueryState("");
    setSelectedId(id);
  }

  function chooseSpace(next: string) {
    setView("all");
    setSpaceId(next);
    setHeldFor(null);
    setSelectedId(null);
  }

  // Everything kept for one person (Mama), across every space.
  function choosePerson(name: string) {
    setView("all");
    setSpaceId(null);
    setHeldFor(name);
    setSelectedId(null);
  }

  // Keyboard: move the selection through the visible list without wrapping.
  function step(delta: number) {
    if (visible.length === 0) return;
    const at = selected ? visible.findIndex((e) => e.id === selected.id) : -1;
    const next = Math.min(visible.length - 1, Math.max(0, at + delta));
    setSelectedId(visible[next].id);
  }

  async function saveEntry(input: EntryInput) {
    const result = await vaultApi.saveEntry(input);
    setData(result.vault);
    setQueryState("");
    setSelectedId(result.id);
  }

  async function deleteEntry(id: string) {
    setData(await vaultApi.deleteEntry(id));
  }

  async function toggleFavorite(id: string) {
    setData(await vaultApi.toggleFavorite(id));
  }

  async function moveEntry(id: string, toSpaceId: string) {
    setData(await vaultApi.moveEntry(id, toSpaceId));
  }

  async function addSpace(name: string) {
    const result = await vaultApi.addSpace(name);
    setData(result.vault);
    chooseSpace(result.id);
  }

  async function renameSpace(id: string, name: string) {
    setData(await vaultApi.renameSpace(id, name));
  }

  async function deleteSpace(id: string, moveToId: string | null) {
    setData(await vaultApi.deleteSpace(id, moveToId));
    if (spaceId === id) chooseSpace(moveToId ?? data.spaces.find((s) => s.kind === "personal")!.id);
  }

  return {
    entries: data.entries,
    spaces: data.spaces,
    view,
    spaceId,
    heldFor,
    query,
    sort,
    visible,
    selected,
    payeeVerdict,
    setQuery,
    setSort,
    setSelectedId,
    chooseView,
    chooseSpace,
    choosePerson,
    reveal,
    step,
    saveEntry,
    deleteEntry,
    toggleFavorite,
    moveEntry,
    addSpace,
    renameSpace,
    deleteSpace,
    load: setData,
  };
}

export type VaultState = ReturnType<typeof useVault>;
