/**
 * What a card remembers across a remount, and the rule for reconciling that memory with what the host replays.
 *
 * ## Why the widget needs a memory at all
 *
 * A host remounts the frame when it scrolls back into view (Claude Desktop, 2026-10-10) and replays the ORIGINAL
 * tool result into it. For `generate_video` that result is `status: 'processing'` with no items, so a card that
 * had finished minutes ago went back to skeletons and polled from scratch, and every tile cross-faded in again
 * from a laurel. Nothing was wrong with the data; the widget had simply forgotten it.
 *
 * ## Why sessionStorage and not the host
 *
 * ⚠️ `@modelcontextprotocol/ext-apps` 2.0.0 gives a view no persisted state it can read back. The nearest thing,
 * `updateModelContext` (`dist/src/app.d.ts`), writes to the MODEL's context and has no getter, so it cannot
 * restore anything. The frame's own sessionStorage is the store left, keyed by what the result itself names
 * (see `cardKey`), never by anything the host assigns per mount.
 *
 * ⛔ NOT keyed by `toolInfo.id`. That is the JSON-RPC id of the call, which restarts with each connection, and a
 * host may serve every conversation from one sandbox origin, so two cards in two chats can share it. Showing a
 * different card's media is worse than a moment of waiting, so the key comes from the payload and hydration
 * happens the instant the replayed result names it.
 *
 * ⭐ Pure functions plus two storage calls that never throw, so the merge rule is testable without a frame.
 */

/** The fields this module reads. The widget's own payload type is a superset. */
export interface CardPayload {
  readonly outputId?: string | null
  readonly status?: 'processing' | 'completed'
  readonly expected?: number
  readonly items?: readonly { readonly url: string; readonly reference?: string | null }[]
  readonly outputs?: readonly { readonly url: string }[]
}

/** What is stored per card: the latest payload, and the urls that already had pixels on screen. */
export interface SavedCard<T extends CardPayload> {
  readonly data: T
  readonly loaded: readonly string[]
}

/** Bumped when the stored shape changes, so an old record is ignored rather than misread. */
const PREFIX = 'contenthero:card:v1:'

/** Every url or reference a payload names, in order. */
function namesOf(p: CardPayload): string[] {
  if (p.items?.length) return p.items.map((it) => it.reference ?? it.url)
  return (p.outputs ?? []).map((o) => o.url)
}

/** A short, stable digest (FNV-1a, 32 bit) so a key built from many urls stays small. */
function digest(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}

/**
 * The card's identity, from what the result itself names.
 *
 * ⭐ A generation has an `outputId` at every stage, pending included, so a replayed pending result and the
 * finished one it became share a key. A set with no `outputId` (`get_media`, an import) is named by its items,
 * which never change for one result. Null means there is nothing stable to key on, and nothing is saved.
 */
export function cardKey(p: CardPayload | null | undefined): string | null {
  if (!p) return null
  if (p.outputId) return `${PREFIX}o:${p.outputId}`
  const names = namesOf(p)
  return names.length ? `${PREFIX}i:${digest(names.join('\n'))}` : null
}

/** How far along a payload is: a terminal one beats any pending one, and within pending, more tiles win. */
function progressOf(p: CardPayload): number {
  const count = namesOf(p).length
  return p.status === 'processing' ? count : Number.MAX_SAFE_INTEGER
}

/**
 * ⭐⭐⭐ **THE MORE COMPLETE OF THE TWO WINS, AND A TIE GOES TO THE HOST.**
 *
 * The host replays the result the call RETURNED, which for a slow job is the pending answer. What we saved is
 * whatever the poll learned after that, so a saved terminal payload beats a replayed `processing` one, and a
 * saved partial with more tiles beats a pending one with fewer. When the two are equally far along, the host's
 * copy is taken: it is the canonical result and the save is only a cache of it.
 *
 * ⚠️ `expected` is carried over whichever side wins, because only the original pending result knew how many
 * tiles were asked for, and losing it makes the remaining skeletons vanish (see `mergePoll`).
 */
export function preferSaved<T extends CardPayload>(incoming: T, saved: T | null | undefined): T {
  if (!saved || cardKey(saved) !== cardKey(incoming)) return incoming
  const winner = progressOf(saved) > progressOf(incoming) ? saved : incoming
  const expected = incoming.expected ?? saved.expected
  return expected === undefined ? winner : { ...winner, expected }
}

/**
 * One poll answer folded into the card.
 *
 * ⭐⭐ MERGED, NOT REPLACED. The poll's answer knows the items; only the ORIGINAL pending result knew how many
 * were asked for. Replacing wholesale would drop `expected` and the remaining skeletons would vanish the moment
 * the first tile landed, which reads as "finished" when it is not.
 */
export function mergePoll<T extends CardPayload>(prev: T | null, answer: T): T {
  const merged = { ...prev, ...answer } as T
  const expected = prev?.expected ?? answer.expected
  return expected === undefined ? merged : { ...merged, expected }
}

/** Whether the card still has work coming, which is the only reason to poll. */
export function isUnfinished(p: CardPayload | null | undefined): boolean {
  return p?.status === 'processing'
}

/**
 * The call the card makes to learn how its generation is doing: the server's `get_status`, by the output's id.
 * The answer's `structuredContent` is the same card payload the generation started with (the server builds it from
 * the status's `detail`), so the poll merges it as is.
 *
 * ⚠️ `ids`, PLURAL, and an array even for one. The singular spelling is a validation error.
 */
export function statusPollCall(outputId: string): { name: 'get_status'; arguments: { ids: string[] } } {
  return { name: 'get_status', arguments: { ids: [outputId] } }
}

/**
 * Reads a card's saved state. Storage can be absent or throw in a sandboxed frame (no same-origin, blocked
 * site data), so every failure reads as "nothing saved" and the widget behaves exactly as it did before.
 */
export function loadCard<T extends CardPayload>(key: string | null, store: Storage | undefined = sessionStore()): SavedCard<T> | null {
  if (!key || !store) return null
  try {
    const raw = store.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<SavedCard<T>>
    if (!parsed || typeof parsed !== 'object' || !parsed.data) return null
    return { data: parsed.data, loaded: Array.isArray(parsed.loaded) ? parsed.loaded.filter((u) => typeof u === 'string') : [] }
  } catch {
    return null
  }
}

/** Saves a card's state. A full or refusing store is ignored: the save is a cache, never the source. */
export function saveCard<T extends CardPayload>(
  key: string | null,
  card: SavedCard<T>,
  store: Storage | undefined = sessionStore(),
): void {
  if (!key || !store) return
  try {
    store.setItem(key, JSON.stringify(card))
  } catch {
    /* Quota or a sandbox refusal. The card still works; it just will not survive a remount. */
  }
}

/** The frame's sessionStorage, or undefined where touching it throws. */
function sessionStore(): Storage | undefined {
  try {
    return typeof sessionStorage === 'undefined' ? undefined : sessionStorage
  } catch {
    return undefined
  }
}
