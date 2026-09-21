/**
 * How a model is PRESENTED, remembered from the catalog the server already fetches.
 *
 * ## ⭐⭐ THIS IS NOT THE CACHE THAT WAS DELETED
 *
 * This package once fetched the whole model catalog on every chip and kept a module-level copy behind a
 * `catch` that returned the RAW ID. An id reads enough like a label that a failed fetch surfaced as a chip
 * flickering between kebab case and title case, with nothing logging why. Deleting it was correct.
 *
 * Two things are different here. A failure renders NO CHIP, never an id: the map is simply empty and every
 * card loads without one, which is exactly what happens today. And it costs no request of its own, because
 * `resolveModelEnums` already calls `listModels` at startup for the tool enums and these fields ride along
 * in the same rows.
 *
 * ## Why it exists at all
 *
 * The prompt, the model and the shape are all decided at SUBMIT, but a card used to show none of them until
 * the generation FINISHED and the completed row carried its own provenance. So the entire loading period,
 * which is the part a person actually watches, was placeholders and nothing else.
 *
 * ⛔ IT LIVES IN ITS OWN MODULE because `server.ts` reads it and `models.ts` writes it. Putting it in
 * either one makes those two import each other, and a cycle between the tool definitions and the catalog
 * resolver is the kind of thing that works until a bundler orders them differently.
 */
import type { ModelInfo } from '@contenthero/sdk'

export interface ModelChip {
  name: string
  brandColor: string | null
  iconKey: string | null
}

let chips = new Map<string, ModelChip>()

/** Replace what is known about every model. Called once per catalog fetch. */
export function rememberModelPresentation(models: readonly ModelInfo[]): void {
  const next = new Map<string, ModelChip>()
  for (const m of models) {
    next.set(m.modelId, {
      name: m.displayName,
      brandColor: m.brandColor ?? null,
      iconKey: m.iconKey ?? null,
    })
  }
  // ⚠️ REPLACED WHOLESALE, never merged: a model retired upstream must stop being named here too, and a
  // merge would keep naming it forever from a fetch that no longer mentions it.
  chips = next
}

/** The chip for a model id, or null when the catalog does not name it. Null means render nothing. */
export function modelChipFor(modelId: string | null | undefined): ModelChip | null {
  return modelId ? (chips.get(modelId) ?? null) : null
}
