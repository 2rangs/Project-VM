// The manager's inbox. Items are DATA: a `key` the UI looks up in its ko/en strings
// (`inbox.<key>.title` / `inbox.<key>.body`) plus `params` to fill them in. A module that ships
// no strings of its own can pass `text` ({ en, ko } title/body) and the UI shows that instead.
//
// An item with `options` needs an answer: Continue stops until the manager picks one. The chosen
// option id is stored in `answer`; a module reacts to it through its own `onAnswer` hook.
import type { IsoDate } from "./calendar.ts";

export type InboxCategory = "result" | "fixture" | "board" | "scouting" | "staff" | "squad" | "competition" | "season" | "finance" | "transfer" | "training" | "other";

export interface InboxText { title: string; body?: string }

export interface InboxOption {
  /** Stored in `answer` when chosen. */
  readonly id: string;
  /** UI string key `inbox.<item key>.option.<id>`; `label` is the fallback text. */
  readonly label?: { en: string; ko: string };
}

export interface InboxItem {
  readonly id: string;
  readonly date: IsoDate;
  readonly category: InboxCategory;
  /** String key (see header). */
  readonly key: string;
  readonly params: Readonly<Record<string, string | number>>;
  /** Fallback text when the UI has no strings for `key`. */
  readonly text?: { en: InboxText; ko: InboxText };
  /** Who it is from: a string key `inbox.from.<from>` (board, analyst, scout, headCoach, league, …). */
  readonly from: string;
  /** The module that posted it (core: "career"); answers are routed back to its hook. */
  readonly source: string;
  /** Things the UI can link to (a fixture, a player, a team). */
  readonly ref?: { fixtureId?: string; playerId?: string; teamId?: string; staffId?: string };
  readonly options?: readonly InboxOption[];
  answer?: string;
  read: boolean;
}

/** What a poster supplies; id, date, read and source are filled in by `postInbox`. */
export type InboxDraft = Omit<InboxItem, "id" | "date" | "read" | "source" | "params"> & {
  readonly params?: Readonly<Record<string, string | number>>;
};

export interface InboxBox {
  inbox: InboxItem[];
  nextInboxId: number;
  date: IsoDate;
}

export function postInbox(box: InboxBox, draft: InboxDraft, source = "career"): InboxItem {
  const item: InboxItem = {
    ...draft,
    params: draft.params ?? {},
    id: `m${box.nextInboxId.toString(36).padStart(5, "0")}`,
    date: box.date,
    read: false,
    source,
  };
  box.nextInboxId += 1;
  box.inbox.push(item);
  return item;
}

/** Items still waiting for an answer (they stop Continue). */
export const awaitingAnswer = (box: Pick<InboxBox, "inbox">): InboxItem[] =>
  box.inbox.filter((m) => m.options && m.options.length > 0 && m.answer === undefined);

export const unreadCount = (box: Pick<InboxBox, "inbox">): number => box.inbox.filter((m) => !m.read).length;
