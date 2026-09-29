// Button looks that repeat across features, defined once. A caller adds only what differs (a colour,
// a margin); a look used in one place stays in that file.

// A card's one filled next step, and the quiet text buttons beside it (ClosingStatus, the Security banner).
export const cardPrimary = "press h-8 rounded-full bg-accent px-3.5 text-[12.5px] font-semibold text-on-accent shadow-accent hover:brightness-110 focus-ring";
export const cardQuiet = "press h-8 rounded-full px-3 text-[12.5px] font-semibold text-accent transition-colors hover:bg-accent-soft focus-ring";

// A grey pill in a card's header row: Show codes, Show note.
export const cardPill = "press flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-field px-3 text-[12.5px] font-semibold text-ink transition-colors hover:bg-line focus-ring";

// A pill in a title bar: Edit on an item, Done on a full-window view.
export const barPill = "press flex h-8 items-center gap-1.5 rounded-full bg-field px-3.5 text-[13px] font-medium text-ink transition-colors hover:bg-line focus-ring";

// A small round icon button inside a form field: show, generate, remove.
export const fieldIconButton = "press grid size-7 place-items-center rounded-full text-ink-3 hover:bg-accent-soft hover:text-accent focus-ring";

// A button that reads as a link (More options, Scan again). The caller gives the colour.
export const textLink = "press flex w-fit items-center gap-1 rounded text-[12.5px] font-semibold focus-ring";
