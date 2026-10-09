/**
 * Helpers that turn SDK results and errors into MCP CallToolResult content.
 * Tool errors are returned as `isError` results (not thrown) so the agent sees
 * a readable message instead of a transport failure.
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
// The spec's own spelling of the key that binds a result to its widget. See `server.ts` for why only the
// constants come from this package and not its server helpers.
import { aspectLabel } from '@contenthero-ai/brand-ui'
import { RESOURCE_URI_META_KEY } from '@modelcontextprotocol/ext-apps'

/**
 * ⭐⭐⭐ **EVERY SPELLING OF "THIS RESULT BELONGS TO THE GENERATION WIDGET", IN ONE PLACE.**
 *
 * This object was written out by hand at SIX call sites, each naming `GENERATION_WIDGET_URI` twice. That is
 * twelve copies of one URI, and the widget's resource uri carries the package version, so every publish
 * rewrites all twelve. One missed copy points a host at a resource that no longer exists, and the symptom is
 * a blank frame in that host only.
 *
 * ⛔ **`openai/outputTemplate` IS THE THIRD SPELLING AND THE REASON THIS CONVERGED NOW.** Adding it to six
 * hand-written literals would have made eighteen copies. Adding it here makes one.
 */
const WIDGET_META = {
  [RESOURCE_URI_META_KEY]: GENERATION_WIDGET_URI,
  ui: { resourceUri: GENERATION_WIDGET_URI },
  'openai/outputTemplate': GENERATION_WIDGET_URI,
} as const
import { GENERATION_WIDGET_URI } from './widget-resource.js'
import type {
  Avatar,
  AvatarListResult,
  VoiceListResult,
  BrandKitListResult,
  FolderListResult,
  KlingElementListResult,
  SpaceListResult,
  TagListResult,
  TrackedAccountListResult,
  ConnectedAccountListResult,
  ProjectSummary,
  ProjectShare,
  MediaShare,
  ProjectVersionListResult,
  ProjectExportListResult,
  SavedProjectVersion,
  RestoredProjectVersion,
  TimelineSettings,
  UndoResult,
  Account,
  Charge,
  BrandKit,
  BrandKitAccount,
  BrandKitSummaryRead,
  BrandKitSectionsRead,
  BrandKnowledgeItem,
  BrandKnowledgeDetail,
  BrandKnowledgeListResult,
  BrandKnowledgeMatch,
  ConnectedAccount,
  CostEstimate,
  CreateAvatarResult,
  KlingElement,
  Template,
  TemplateSummary,
  TemplateListResult,
  Generation,
  GenerationOutput,
  GenerateResult,
  EditAudioResult,
  MediaListResult,
  SearchMediaPage,
  FolderContents,
  ProjectListResult,
  MediaBatchResult,
  ResolvedMediaBatchItem,
  CreateMediaUploadResult,
  ImportedMedia,
  UploadedMedia,
  ModelInfo,
  PlatformSummary,
  PlatformSchema,
  Stage,
  Space,
  CardAsset,
  Post,
  CardDetail,
  CardListResult,
  StageListResult,
  CardSummary,
  Tag,
  PublishResult,
  TrackedAccount,
  ContentSummary,
  ContentDetail,
  ContentAnalysisResult,
  ContentAnalysisKind,
  ContentScenesResult,
  ContentListResult,
  TrackedAccountDetail,
  Transcription,
  Voice,
  ApplyEditorOpsResult,
  ProjectDetail,
  LiveContextResult,
  LayerTypeCatalog,
  TimelineTypeCatalog,
  TranscriptResult,
  ExportJob,
  ExportFormatCatalog,
  LinkFormats,
  CodeGuide,
  EffectList,
  EffectDetail,
  CodeDiagnostic,
  BrandImportOutcome,} from '@contenthero/sdk'
import { ContentHeroError, LimitError, RateLimitError, ServiceUnavailableError, chargeSentence, describeCodeWarnings, describeEditorOps, describeExportShareLink, describeFileSize, describeLimit, describeMediaShare, describeProjectShare, describeProjectShareLink, describeReferences, describeRenderFailure, describeReserved, describeScope, importedMediaFrom, withCodeWarnings } from '@contenthero/sdk'

export function text(body: string, isError = false): CallToolResult {
  return { content: [{ type: 'text', text: body }], isError }
}

/** What a paid call cost, in one line: the SDK's one wording (`chargeSentence`). */
export const chargeLine = (charge: Charge | null | undefined): string | null => chargeSentence(charge)

/**
 * The charge as data, for a result's `structuredContent`: the charge itself and its sentence.
 *
 * ⭐ A HOST MAY HAND THE MODEL `structuredContent` INSTEAD OF THE TEXT. Measured 2026-09-30 on claude.ai: a
 * finished generation reached the agent as its widget data alone, so the cost line in the text never arrived and
 * an agent could not tell what it had spent, which is the whole point of a receipt. Every result that carries
 * structured data carries its charge there too.
 */
export function chargeData(charge: Charge | null | undefined): { charge?: Charge; cost?: string } {
  const line = chargeLine(charge)
  return charge && line ? { charge, cost: line } : {}
}

/** `result` with the cost line added to its text and its charge to its structured data, so every paid tool reports what it cost the same way. */
export function withCharge(result: CallToolResult, charge: Charge | null | undefined): CallToolResult {
  const line = chargeLine(charge)
  if (!line) return result
  const content = [...result.content]
  const first = content.findIndex((c) => c.type === 'text')
  if (first === -1) content.unshift({ type: 'text', text: line })
  else content[first] = { ...content[first], text: `${(content[first] as { text: string }).text}\n${line}` } as (typeof content)[number]
  const structured = result.structuredContent ? { structuredContent: { ...result.structuredContent, ...chargeData(charge) } } : {}
  return { ...result, content, ...structured }
}

/**
 * An attachment for a finished generation: the bytes to inline, or a link for the host to render.
 *
 * ⭐⭐⭐ **THE SHAPE FOLLOWS THE MEDIUM, NOT OUR PREFERENCE.** MCP's `ContentBlock` union is
 * `text | image | audio | resource_link | resource`. Images and audio have first-class blocks and are small
 * enough to carry as bytes, so they are EMBEDDED: that is what makes them render in the chat and what makes
 * them outlive any URL. Video has no block of its own and would be megabytes of base64 inside a transcript,
 * so it travels as a `resource_link`, which is exactly what a working implementation does (verified against
 * the Higgsfield MCP, whose `job_display` returns `[Resource link: ....mp4]`).
 */
export type GeneratedAttachment =
  | { kind: 'bytes'; type: 'image' | 'audio'; data: string; mimeType: string }
  | { kind: 'link'; uri: string; mimeType: string; name: string }

/**
 * A finished generation: the asset URLs and placement outcome, plus the asset ITSELF.
 *
 * ## Why this used to be text only
 *
 * 🚨 **AN AGENT THAT GENERATES AN IMAGE COULD NOT SEE IT.** This returned a header, an outputId and a
 * numbered list of urls, so the model had metadata and nothing else. Measured 2026-09-19 in a real ChatGPT
 * and Claude session: Claude said "I can't see the image myself, only the metadata", and the link it
 * surfaced was dead on arrival because ChatGPT had appended `utm_source=chatgpt.com` to a presigned URL and
 * broken its signature.
 *
 * ⭐ The machinery already existed and was wired to the wrong tools: `mediaBatchResult` and
 * `liveContextResult` have pushed image blocks for a while. Generation, the surface where a user most wants
 * to SEE the result, was the one that did not.
 *
 * ## ⛔ THE AGENT CANNOT SEE WHAT IT MADE FROM THIS RESULT, AND THAT IS DELIBERATE
 *
 * An `image` block feeds the MODEL's vision; a `resource_link` gives the HOST something to render for the
 * human. So the user sees every variation inline, and the model has a name and a url.
 *
 * ⭐ **`get_media` IS HOW A MODEL ACTUALLY LOOKS AT SOMETHING.** It embeds bytes as image blocks for exactly
 * that purpose, so an agent that needs to judge a result (is the hand wrong, is the text legible, which of
 * these four is best) calls it with the outputId. Embedding bytes HERE instead would spend the user's
 * context on every generation to answer a question they may never ask, and a four-image batch would pay
 * that cost four times over, repeated in every later turn.
 *
 * ⚠️ ATTACHMENTS ARE BUILT BY THE CALLER, not here. This module stays pure, the same split
 * `mediaBatchResult` already uses: the handler decides, the formatter assembles.
 */
/**
 * What the generation WIDGET reads.
 *
 * ⭐⭐ `structuredContent` IS THE WIDGET'S ONLY INPUT. It is a separate channel from `content`: the blocks
 * feed the model and any host without app support, this feeds the UI. Both are emitted, so nothing regresses
 * where widgets are unsupported and nothing is duplicated where they are.
 *
 * ⚠️ URLS ONLY, NEVER BYTES. The widget runs in the host's frame and fetches media itself, and our
 * capability urls carry their token in the QUERY STRING, so `<video src>` loads one directly with no header
 * to set. Embedding base64 here would pay the context cost twice over.
 */
/**
 * ⭐⭐ HOW PROSE NAMES AN ITEM: its id, then its app link when the server sent one.
 *
 * ONE spelling everywhere, so an agent learns it once and can hyperlink any item for the person. The link is the
 * server's `appUrl`, never composed here: this module once built its own studio links, and their format drifted
 * from the app's. An item whose type carries no `appUrl` (or an older server) simply renders its id.
 */
export function idOf(item: { id: string | null; appUrl?: string | null }, label = 'id'): string {
  return item.appUrl ? `${label} ${item.id}, appUrl ${item.appUrl}` : `${label} ${item.id}`
}

/** The same appUrl, after a url a line already shows. */
function linkAfter(appUrl: string | null | undefined): string {
  return appUrl ? ` (appUrl ${appUrl})` : ''
}

/**
 * What the widget is handed, for ANY media this server produces.
 *
 * ## ⭐⭐⭐ ONE BUILDER, BECAUSE "WHAT DOES THE WIDGET SHOW" IS ONE QUESTION
 *
 * The payload used to be derivable only from a `Generation`, so every tool that produced media by another
 * route had no way to render at all. `generate_audio` and `edit_audio` returned plain text, which is why
 * audio has been invisible in a chat for this entire feature. That was not a decision anybody made; it is
 * what happens when the only door into the widget is shaped like one caller.
 *
 * ⚠️ Everything past `outputId`, `contentType` and `urls` is OPTIONAL, because a caller that genuinely has
 * no model, prompt or aspect must be able to render rather than invent them. The widget already renders
 * nothing for a null chip.
 */
export interface MediaWidgetItem {
  url: string
  /** A still for a video, so a tile shows something before anyone presses play. */
  posterUrl?: string | null
  /** The reference a person copies and the API accepts: `<outputId>` or `<outputId>-<n>`, one-based. */
  name: string
  contentType: 'image' | 'video' | 'audio'
  /** `"W:H"`. Null for audio, and null when nothing measured it. */
  displayAspect?: string | null
  /**
   * Where this thing lives IN THE PRODUCT.
   *
   * ⛔ **NOT `studioUrl`, WHICH IS WHAT IT WAS CALLED AND WHAT MADE THE THINKING WRONG.** Naming a field
   * after one destination made "does an export belong in the studio detail view" sound like a question
   * worth answering; it is not, because an export belongs to the editor and canvas. Whoever builds the
   * payload knows where its media lives, so they supply the link and the widget just opens it.
   *
   * ⚠️ Optional. Absent means there is nowhere to go, and the Open button does not render.
   */
  openUrl?: string
  /**
   * The token the API accepts for this item: `<outputId>` or `<outputId>-<n>`, one-based.
   *
   * ## ⛔⛔ ITS ABSENCE IS WHAT HIDES ANIMATE, EDIT AND RECREATE
   *
   * Those verbs all end in a tool call that has to NAME this thing: `referenceImages` takes "a URL or a
   * previous output id". A project export has an exportId, which no generate tool resolves, so offering to
   * animate one produces a message the agent cannot act on and a person cannot tell was never going to
   * work. Download is always offered, because a file is always a file.
   *
   * ⚠️ This was already wrong for audio the moment it started rendering: Recreate emitted `model:` and
   * `prompt:` with nothing after them, from a payload that carries neither.
   */
  reference?: string
  /** Per-item chip, for a mixed set where the items do not share one model. */
  modelName?: string | null
  modelBrandColor?: string | null
  modelIconKey?: string | null
  /**
   * ⭐⭐⭐ **THE SMALL PICTURE, WHICH IS WHAT A TILE MUST PAINT.**
   *
   * The tile used to point `<img src>` at `url`, the master. Masters are 1.7 to 2.9 MB, so ten tiles is
   * about 25 MB over a browser's ~6 connections per origin: measured as five to ten minutes of Laurel
   * skeletons, with some tiles never arriving at all.
   *
   * ⛔⛔ **PAINTING ONLY. NEVER SAVED, NEVER DOWNLOADED.** A preview is 1600px at WebP quality 80. Handing
   * it to someone who asked to download their asset is a silent quality downgrade, so Download stays on
   * `url` and the detail view uses this only as its first paint before the master arrives.
   *
   * Null when no derivative exists, in which case the master is the only address there is.
   */
  previewUrl?: string | null
  /**
   * Which library this came from, so the widget knows whether Recreate applies.
   *
   * ⚠️ Only a CREATION was ever generated. Offering "generate this again" on an upload or a stock clip is
   * an action the agent cannot carry out, which is the same defect as offering Animate on an export.
   */
  source?: 'creations' | 'uploads' | 'stock' | null
  /**
   * ⛔⛔ THERE IS NO PER-ITEM `prompt` HERE, AND ITS ABSENCE IS DELIBERATE.
   *
   * It was, so Recreate could quote it. A prompt is the largest field on an item, and `show_media` carries
   * up to a hundred: measured, sixty items cost 165 KB of context with prompts embedded, against a tool
   * whose whole justification is that its cost does not grow with the count.
   *
   * ⭐ Recreate names the ITEM instead and lets the agent read its settings, which is the rule this file
   * already applies to urls: "the messages name an output id, not a url". A reference is 36 characters and
   * resolves to everything, including a prompt too long to have embedded safely anyway.
   *
   * ⚠️ `modelId` STAYS. It is about twenty characters, it does not grow, and it lets the message say which
   * model without a lookup. Its reader is the agent, which needs the token; the chip is the opposite case
   * and renders nothing rather than an id.
   */
  modelId?: string | null
}

/**
 * What the widget is handed, for ANY media this server produces.
 *
 * ## ⭐⭐⭐ A SET OF ITEMS, AND A GENERATION IS THE SPECIAL CASE WHERE THEY SHARE A SHAPE
 *
 * The payload used to BE a generation: one `outputId`, one `contentType`, one model chip, one prompt and
 * one aspect ratio shared by every tile. That shape is why nothing but a generation could render. Ten
 * library items from ten different generations do not fit it, and neither does an upload, an import or a
 * project export.
 *
 * ⭐ Generalizing to items costs nothing at the call site and removes the whole class: a generation is now
 * "items that happen to share a model, a prompt and a shape", which is a property of the data rather than
 * a mode anyone has to select. The widget derives its layout from that property.
 *
 * ⚠️ Everything shared is OPTIONAL, because a caller that genuinely has no model, prompt or aspect must be
 * able to render rather than invent them. The widget renders no chip for a null name.
 */
export interface MediaWidgetInput {
  /** The generation these items came from, when they came from one. Absent for a mixed set. */
  outputId?: string
  items: readonly MediaWidgetItem[]
  /** Shared chip, when every item shares it. */
  modelId?: string
  modelDisplayName?: string | null
  modelBrandColor?: string | null
  modelIconKey?: string | null
  prompt?: string | null
  /** Shared shape, when every item shares it. Its presence is what makes the layout a ROW. */
  displayAspect?: string | null
  /** Shared medium, when every item shares it. */
  contentType?: 'image' | 'video' | 'audio'
}

export function mediaWidgetData(input: MediaWidgetInput) {
  return {
    outputId: input.outputId ?? null,
    contentType: input.contentType ?? null,
    modelId: input.modelId ?? '',
    /**
     * ⛔⛔ **NULL WHEN THERE IS NOTHING TO NAME, AND THE WIDGET MUST RENDER NO CHIP.**
     *
     * This used to be `displayName ?? modelId`, fed by a catalog fetch with a `catch` that returned the id.
     * The id reads like a label, so a failed fetch showed as a chip flickering between kebab case and title
     * case rather than as a failure. The name now arrives on the row.
     */
    modelName: input.modelDisplayName ?? null,
    modelBrandColor: input.modelBrandColor ?? null,
    modelIconKey: input.modelIconKey ?? null,
    displayAspect: input.displayAspect ?? null,
    /** Verbatim. Some prompts are JSON-shaped because the person authored one; that object IS the prompt. */
    prompt: input.prompt ?? null,
    items: input.items.map((it) => ({
      url: it.url,
      posterUrl: it.posterUrl ?? null,
      name: it.name,
      contentType: it.contentType,
      displayAspect: it.displayAspect ?? null,
      openUrl: it.openUrl ?? null,
      reference: it.reference ?? null,
      modelName: it.modelName ?? null,
      modelBrandColor: it.modelBrandColor ?? null,
      modelIconKey: it.modelIconKey ?? null,
      previewUrl: it.previewUrl ?? null,
      source: it.source ?? null,
      modelId: it.modelId ?? null,
    })),
  }
}

/** The outputs that have a file, in slot order: what a card or a list can show. */
function landedOutputs(gen: { outputs?: GenerationOutput[] }): Array<GenerationOutput & { url: string }> {
  return (gen.outputs ?? []).filter((o): o is GenerationOutput & { url: string } => typeof o.url === 'string' && o.url.length > 0)
}

/** One line per output: its media id and file (and link), or its status when it produced nothing. */
function outputLines(gen: { outputs?: GenerationOutput[] }): string[] {
  return (gen.outputs ?? []).map((o) => (o.url ? `${o.mediaId}: ${o.url}${linkAfter(o.appUrl)}` : `${o.mediaId}: ${o.status}`))
}

/** A generation's widget payload. A thin adapter over {@link mediaWidgetData}, not a second builder. */
export function generationWidgetData(
  gen: Generation,
  posterUrls: readonly (string | null)[] = [],
) {
  // Each LANDED output, named by its own media reference and carrying its own links (7.44). Nothing is paired by
  // index, so a failed output can no longer shift the name or link of the outputs after it.
  const landed = landedOutputs(gen)
  return mediaWidgetData({
    outputId: gen.outputId,
    contentType: gen.contentType,
    modelId: gen.modelId,
    modelDisplayName: gen.modelDisplayName,
    modelBrandColor: gen.modelBrandColor,
    modelIconKey: gen.modelIconKey,
    /**
     * ⭐ SHARED, which is what makes a generation render as a ROW. Every variation of one generation has
     * the same shape by construction, so the widget lays them out side by side for comparison rather than
     * as a mixed grid.
     */
    displayAspect: gen.displayAspect,
    prompt: gen.prompt,
    items: landed.map((o, i) => ({
      url: o.url,
      posterUrl: posterUrls[i] ?? null,
      name: o.mediaId,
      contentType: gen.contentType,
      displayAspect: gen.displayAspect ?? null,
      // ⭐ THE SERVER'S LINK for this output. The app owns its own URLs; this module composed them once and they
      // drifted into a second format.
      openUrl: o.appUrl,
      // Every generation output is referenceable by its media id, which is what makes Animate and Edit meaningful.
      reference: o.mediaId,
      // This output's own preview, minted by the server; null where none exists, and the tile paints the master.
      previewUrl: o.previewUrl ?? null,
      // A generation is, by definition, something that was generated.
      source: 'creations' as const,
      modelId: gen.modelId,
    })),
  })
}

export function completedResult(
  gen: Generation,
  attachments: GeneratedAttachment[] = [],
  posterUrls: readonly (string | null)[] = [],
): CallToolResult {
  const landed = landedOutputs(gen)
  const noun = landed.length === 1 ? gen.contentType : `${gen.contentType}s`
  /**
   * ⭐⭐ **ONE TEXT LIST, AND NO `resource_link` BLOCKS. THREE REPRESENTATIONS OF ONE URL WAS TWO TOO MANY.**
   *
   * This went through both extremes before landing here. Listing the urls in prose AND attaching a link per
   * output printed every url twice. Suppressing the prose left the links alone, and a host renders those as
   * `name: uri` with NO SEPARATOR BETWEEN THEM, so url 1 ended flush against filename 2 and anything
   * splitting on whitespace read a corrupted token. Measured at all three boundaries of a four-image batch.
   *
   * ⛔ THE SEPARATOR WAS NEVER OURS TO ADD. Our text block ends with a newline; the run-together is the host
   * concatenating sibling blocks, and no content we emit can put a break between two of them.
   *
   * ⭐ So the fallback is the thing we fully control: one newline-delimited list. The widget is the surface
   * that renders, and this is what a host without app support (or a model reading the transcript) gets. It
   * costs less than the links did and it cannot be run together by anybody.
   */
  /**
   * ⭐ **THE ID IS AN ACCEPTABLE FALLBACK HERE AND NOWHERE ELSE.** This block's reader is the model, for
   * whom `gpt-image-2` is a true and directly useful token. The widget's chip has a human reader, for whom
   * the same string is an unexplained failure wearing a label's clothes, so there it renders as nothing.
   */
  const header = `Done. ${landed.length} ${noun} from ${gen.modelDisplayName ?? gen.modelId} (outputId ${gen.outputId}):`
  // Each output by its media id, the name to pass back, so no reader numbers anything; one that produced nothing is
  // listed by its status, so the others keep their own numbers.
  const lines = [header, ...outputLines(gen)]
  const madeFrom = describeReferences(gen.references)
  if (madeFrom.length > 0) lines.push('Made from:', ...madeFrom.map((r) => `  ${r}`))
  const p = gen.placement
  if (p) {
    if (p.projectType === 'canvas') {
      lines.push(
        `Placed as a canvas layer (id ${p.layerId ?? p.itemId ?? 'resolved'}) on slide ${p.slideId ?? 'resolved'}. Use that layer id to chain further ops (animate, reposition, reorder, set as background).`,
      )
    } else {
      lines.push(
        `Placed on the timeline (clip id ${p.itemId ?? 'resolved'}). Use that clip id to chain further ops.`,
      )
    }
    if (p.warnings?.length) lines.push(`Placement notes: ${p.warnings.join('; ')}`)
  }
  const cost = chargeLine(gen.charge)
  if (cost) lines.push(cost)

  // ⚠️ A TRAILING NEWLINE, because a host concatenates blocks without inserting one. Without it the last
  // url ran straight into the next block's rendering, producing `...MBCo_Kkcfe3bafb-...-1.png: https://...`
  // and a token that anything splitting on whitespace would read as part of the filename.
  const content: CallToolResult['content'] = [{ type: 'text', text: lines.join('\n') + '\n' }]
  for (const a of attachments) {
    if (a.kind === 'bytes') {
      content.push({ type: a.type, data: a.data, mimeType: a.mimeType })
    } else {
      // A `resource_link` names the bytes without carrying them. The uri is a capability url, so it does not
      // expire and appended query parameters cannot invalidate it.
      content.push({ type: 'resource_link', uri: a.uri, name: a.name, mimeType: a.mimeType })
    }
  }
  /**
   * ⭐⭐⭐ **THE `_meta` KEY IS WHAT MAKES A WIDGET APPEAR.** Without it the host has an HTML resource it was
   * never told to mount, and the result renders as blocks alone. With it, a host that supports MCP Apps
   * shows the widget and a host that does not ignores the key entirely.
   *
   * ⚠️ Emitted ALONGSIDE the blocks, never instead of them. Two mechanisms, one of which is better where it
   * exists: ChatGPT and Claude get the widget, anything else still gets an image it can draw.
   */
  return {
    content,
    isError: false,
    structuredContent: { ...generationWidgetData(gen, posterUrls), ...chargeData(gen.charge) },
    _meta: WIDGET_META,
  }
}

/** Suggested seconds to wait before re-polling a job, by content type. */
export function pollAfterSecondsFor(contentType: string): number {
  return contentType === 'image' ? 5 : 15
}

/**
 * How to call `get_generation_status`, written as the call itself.
 *
 * ⚠️ THE ARGUMENT IS `outputIds` AND IT IS AN ARRAY, ALWAYS, even for one job. Every handoff here used to
 * say "call get_generation_status with this outputId", which names a parameter that does not exist: an agent
 * following the sentence literally sends `{ outputId }` and the schema rejects it. Naming the shape in prose
 * is what drifted, so these messages now print the call instead, and every site shares this one function.
 */
export function getStatusCall(outputIds: readonly string[]): string {
  return `get_generation_status { outputIds: [${outputIds.map((id) => `"${id}"`).join(', ')}] }`
}

/** What a still-running generation already knows about the shape of its own result. */
export interface PendingShape {
  contentType: 'image' | 'video' | 'audio'
  modelId: string
  /** `"W:H"` as requested. Absent for audio and for `auto`/`adaptive`. */
  displayAspect?: string | null
  /** How many outputs were asked for, so the widget draws that many placeholders. */
  expected?: number
  /**
   * ⭐⭐⭐ **EVERYTHING THE REQUEST ALREADY KNEW, SO THE CARD IS NOT BLANK WHILE IT WAITS.**
   *
   * The prompt, the model and the shape are all decided at SUBMIT. The card used to show none of them
   * until the generation FINISHED and the completed row carried its own provenance, so the whole loading
   * period, which is the part a person actually watches, displayed placeholders and nothing else.
   *
   * ⛔ `modelName` IS RESOLVED, NEVER THE ID. `gpt-image-2.5-flare` reads enough like a label that
   * printing one turns a lookup failure into a cosmetic bug nobody can diagnose, which is exactly how the
   * chip once came to flicker between kebab case and title case. Null renders no chip.
   */
  prompt?: string | null
  modelName?: string | null
  modelBrandColor?: string | null
  modelIconKey?: string | null
}

/**
 * A slow job that did not finish within the smart-wait window.
 *
 * ## ⭐⭐⭐ THIS IS WHERE THE SKELETONS COME FROM, AND WHY IT IS THE ONLY PLACE THEY COULD
 *
 * A generation returns one of two ways: it finished inside the smart wait, in which case there is nothing
 * to show a spinner for, or it did not, and until now that produced ONE SENTENCE of prose asking the agent
 * to poll. Every video takes that path. So the person who waited longest got the least: a paragraph, while
 * the same job in the studio shows placeholder cards filling in.
 *
 * ⛔ **THE FIX IS NOT TO MAKE `generate_*` RETURN EARLY.** That would hand every host the pending path,
 * including hosts with no MCP Apps support, which would lose the inline image they get today. The pending
 * path already exists and already reaches exactly the people who are waiting.
 *
 * ⚠️ **THE TEXT STAYS, WORD FOR WORD.** It is what a host without app support renders, and it is what the
 * AGENT reads to know it must poll. The widget is added ALONGSIDE it, not instead of it: an agent that
 * stopped polling because the prose was replaced by a payload it cannot see would leave the generation
 * unclaimed.
 *
 * ⚠️ No model NAME here, and that is deliberate. Resolving one would mean a second network call from
 * inside a `catch`, which is the exact shape that produced a chip flickering between kebab case and title
 * case. The widget polls `get_generation_status`, and the name arrives with the first response.
 */
export function pendingResult(
  outputId: string,
  pollAfterSeconds = 15,
  shape?: PendingShape,
): CallToolResult {
  /**
   * ⚠️ THE REASSURANCE MUST MATCH THE MEDIUM. This said "This is normal for video" on every pending result,
   * including image jobs, where it reads as the server describing something other than what was asked for.
   * `shape` is present precisely when we know which medium it is.
   */
  const normal = shape?.contentType === 'image' ? '' : ' This is normal for video.'
  const prose = `Still rendering (outputId ${outputId}).${normal} Call ${getStatusCall([outputId])} in ~${pollAfterSeconds}s [poll_after_seconds: ${pollAfterSeconds}] to get the final URLs.`
  if (!shape) return text(prose)
  return {
    content: [{ type: 'text', text: prose }],
    structuredContent: {
      outputId,
      status: 'processing',
      contentType: shape.contentType,
      modelId: shape.modelId,
      // ⭐ Carried from the REQUEST, so the chip and the prompt are on the card from the first frame
      // rather than appearing only once the generation finishes. Null still means render nothing.
      modelName: shape.modelName ?? null,
      modelBrandColor: shape.modelBrandColor ?? null,
      modelIconKey: shape.modelIconKey ?? null,
      displayAspect: shape.displayAspect ?? null,
      prompt: shape.prompt ?? null,
      /** At least one, or the widget renders a grid with nothing in it and looks broken rather than busy. */
      expected: Math.max(1, shape.expected ?? 1),
      pollAfterSeconds,
      items: [],
    },
    _meta: WIDGET_META,
  }
}

/** Synchronous audio result (already complete on submit). */
/**
 * Synchronous audio: already complete when the call returns.
 *
 * ## ⛔⛔⛔ THIS RENDERED NOTHING FOR THE ENTIRE LIFE OF THE WIDGET
 *
 * Audio has a first-class MCP block AND the widget plays it, and neither reached anyone, because this
 * builder returned plain text and `generate_audio` was never added to the hand-maintained list of tools
 * that declare a widget. Nobody decided audio should be invisible; it is what an allowlist does to
 * anything nobody remembered to add.
 *
 * ⚠️ No model name, brand or aspect here: a synchronous result carries none of them, and inventing them
 * would be worse than a chip that renders nothing. Audio has no shape, so `displayAspect` is genuinely
 * null rather than unknown.
 */
export function audioResult(result: GenerateResult | EditAudioResult): CallToolResult {
  const landed = landedOutputs(result)
  const header = `Done. Audio generated (outputId ${result.outputId}):`
  const prose = [header, ...outputLines(result), chargeLine(result.charge)]
    .filter((l): l is string => !!l)
    .join('\n')
  if (!landed.length) return text(prose)
  return {
    content: [{ type: 'text', text: prose }],
    structuredContent: {
      ...chargeData(result.charge),
      ...mediaWidgetData({
        outputId: result.outputId,
        contentType: 'audio',
        // The model travels on the completed audio response, so the card names it like any other generation.
        modelId: result.modelId,
        modelDisplayName: result.modelDisplayName,
        modelBrandColor: result.modelBrandColor,
        modelIconKey: result.modelIconKey,
        items: landed.map((o) => ({
          url: o.url,
          name: o.mediaId,
          contentType: 'audio' as const,
          // Audio has no shape, so there is nothing for a tile to take.
          displayAspect: null,
          openUrl: o.appUrl,
          reference: o.mediaId,
        })),
      }),
    },
    _meta: WIDGET_META,
  }
}

/**
 * In-place clip enhancement: ONE JOB PER SOURCE, so the agent gets every outputId.
 *
 * Reporting only the first would let an agent see one recording finish and call the whole edit done, while the
 * other recordings were still running. The applied-automatically note matters too: unlike every other async
 * tool here, the caller does NOT place the result, so without saying so an agent would reasonably try to.
 */
export function enhanceClipsResult(result: EditAudioResult): CallToolResult {
  const jobs = result.jobs ?? []
  if (jobs.length === 0) {
    return text(result.note ?? 'Nothing to enhance: no audible clips in that selection.')
  }
  const lines = jobs.map(
    (j, i) =>
      `${i + 1}. outputId ${j.outputId} covers ${j.clipIds.length} clip${j.clipIds.length === 1 ? '' : 's'}` +
      ` from one source (${j.windows} window${j.windows === 1 ? '' : 's'})` +
      (chargeLine(j.charge) ? `. ${chargeLine(j.charge)}` : ''),
  )
  const poll = `Poll with ${getStatusCall(jobs.map((j) => j.outputId))}`
  const header =
    jobs.length === 1
      ? `Enhancing 1 source. ${poll}:`
      : `Enhancing ${jobs.length} sources as separate jobs, because a noise profile is estimated per recording. ${poll} (EVERY id, in one call):`
  const footer = [
    'The enhanced audio is applied to the clips automatically when each job lands, so no placement call is needed.',
    result.silencedClipsExcluded
      ? `${result.silencedClipsExcluded} silenced clip${result.silencedClipsExcluded === 1 ? ' was' : 's were'} skipped.`
      : null,
  ].filter(Boolean) as string[]
  return text([header, ...lines, ...footer].join('\n'))
}

/** Result of a get_cost preflight: the estimate, with nothing generated or charged. */
export function costResult(est: CostEstimate): CallToolResult {
  const what = est.modelId ?? est.contentType ?? 'this generation'
  const credits = `${est.creditsEstimate} credit${est.creditsEstimate === 1 ? '' : 's'}`
  return text(`Estimated cost: ${credits} for ${what}. Nothing ran and nothing was charged.`)
}

/**
 * One generation's status. Used directly for a single id, and per-row by the batch form below.
 *
 * ⭐ A STILL-RUNNING GENERATION REPORTS THE URLS IT ALREADY HAS. `outputUrls` fills in slot by slot,
 * so a 4-image batch can have three finished assets while `status` is still 'processing'. Reporting
 * only "still processing" threw those away and made every caller block on the SLOWEST slot, even
 * though the finished ones are already visible in the app's own grid. The caller can start reviewing
 * immediately and re-poll only for the remainder.
 *
 * ⚠️ THE PARTIAL LIST IS NOT A FINAL ONE, so it never uses `completedResult`'s "Done." header. A
 * caller that stopped at a partial result believing it was complete would silently lose images,
 * which is the failure this is meant to prevent, not cause.
 */
export function generationStatusResult(
  gen: Generation,
  attachments: GeneratedAttachment[] = [],
): CallToolResult {
  /**
   * ⛔⛔ **THIS DROPPED THE ATTACHMENTS AND THEREFORE RENDERED NOTHING.** It called `completedResult(gen)`
   * with no second argument, so POLLING returned text alone even after the generate handlers started
   * attaching blocks. That is the path EVERY async generation takes, which is every video, so the common
   * case stayed blank while the synchronous one worked.
   *
   * ⭐ Found by the `verify:inline` harness in its first run, minutes after it existed. The unit tests could
   * not see it: they call `completedResult` directly and never go through here.
   */
  if (gen.status === 'completed') {
    const res = completedResult(gen, attachments)
    /**
     * ⛔⛔⛔ **`_meta` IS WHAT MOUNTS A WIDGET. `structuredContent` IS JUST DATA, AND DELETING IT BROKE THE
     * ONE THING THAT MAKES A GENERATION CARD FINISH.**
     *
     * This tool must not DECLARE the widget: `generate_*` already returns one that polls itself, and a
     * second card for the same generation is the duplicate we removed. That is a statement about `_meta`.
     *
     * Deleting `structuredContent` as well looked harmless, and was not. The widget polls by calling this
     * tool through `callServerTool` and reading the payload OUT of the result; that call is answered to the
     * WIDGET, never rendered by the host, so there was never a second card to prevent. With the payload
     * gone the poll read `undefined` on every tick and the card sat on its skeletons until the twenty
     * minute deadline, while the studio showed the images finished. Reported 2026-09-21 as a widget that
     * "never resolves"; the images had been ready for over a minute.
     *
     * ⭐ The completeness guard already draws the line in the right place: it excludes any builder that
     * deletes `_meta`, which is exactly the distinction between "shows a card" and "answers with data".
     */
    delete (res as { _meta?: unknown })._meta
    return res
  }
  if (gen.status === 'failed') {
    return text(`Generation ${gen.outputId} failed: ${gen.error ?? 'unknown error'}`, true)
  }
  // Terminal and not a failure. Without this branch it read "still abandoned, call again", a poll that never ends.
  if (gen.status === 'abandoned') {
    if (gen.alreadyExisted) return importedMediaResult(importedMediaFrom(gen, null))
    return text(`Generation ${gen.outputId} was set aside and produced nothing of its own. It will not change.`)
  }
  const secs = pollAfterSecondsFor(gen.contentType)
  const poll = `Call get_generation_status again in ~${secs}s [poll_after_seconds: ${secs}]`
  /**
   * ⭐⭐⭐ **THE OUTPUTS THAT HAVE LANDED, WHICH IS WHAT LETS A CARD FILL IN ONE TILE AT A TIME.**
   *
   * Each output carries its file as soon as it is stored, so a running generation answers with the part it has
   * and a tile resolves alone, while the studio beside it does the same.
   */
  const landed = landedOutputs(gen)
  /**
   * ⛔ THE EMPTY CHECK MOVED BELOW `landed`, AND THAT IS THE WHOLE POINT. It used to test `outputUrls`,
   * which is EMPTY for the entire life of a running job, so this function returned prose on every poll
   * and the partial payload below was unreachable. Nothing is known only when NEITHER source has a url.
   */
  if (landed.length === 0) {
    return text(`Generation ${gen.outputId} is still ${gen.status}. ${poll}.`)
  }
  const noun = landed.length === 1 ? gen.contentType : `${gen.contentType}s`
  const prose = [
    `Partial. ${landed.length} ${noun} ready from ${gen.modelId} (outputId ${gen.outputId}), more still ${gen.status}:`,
    ...landed.map((o) => `${o.mediaId}: ${o.url}`),
    `NOT the full set. ${poll} for the rest.`,
  ].join('\n')
  /**
   * ⭐⭐⭐ **A PARTIAL ANSWER CARRIES THE PART IT HAS, SO A TILE CAN RESOLVE ALONE.**
   *
   * This returned prose only, so the widget's poll learned nothing until the LAST variation landed and then
   * swapped all of them at once. The studio has always filled each card the moment its own image exists,
   * and the card in a chat sat on three skeletons while two of the three were visibly done next to it.
   *
   * ⚠️ `status` STAYS `processing`, which is what keeps the poll running and keeps the remaining skeletons
   * on screen. `expected` is what says how many are still coming; without it the widget would render two
   * tiles and look finished.
   *
   * ⛔ NO `_meta` HERE EITHER. Same rule as the completed branch: this answers the widget's own question and
   * must not mount a second card.
   */
  return {
    content: [{ type: 'text', text: prose }],
    structuredContent: {
      // Built from the LANDED outputs, which is all a running job has.
      ...generationWidgetData(gen),
      ...chargeData(gen.charge),
      status: 'processing',
      /**
       * ⚠️ NO `expected` HERE, DELIBERATELY. The widget was told how many were asked for when the job started,
       * and anything put here would be a count of what has landed wearing the name of a total. The widget was told the real number by `pendingResult` when the job started and keeps it
       * across polls, which is the one place that actually knows.
       */
      pollAfterSeconds: secs,
    },
  }
}

/** One or more generations (snapshot or post-wait). Falls through to the single form for one id. */
export function generationBatchResult(
  gens: Generation[],
  attachmentsByOutputId: Record<string, GeneratedAttachment[]> = {},
): CallToolResult {
  // ⚠️ ONLY THE SINGLE FORM ATTACHES. A batch status covering ten generations would embed ten sets of
  // bytes into one result, which is the context blow-up the link design was originally protecting against.
  // The single form is what a caller polling one generation hits, and that is the case worth rendering.
  if (gens.length === 1)
    return generationStatusResult(gens[0]!, attachmentsByOutputId[gens[0]!.outputId] ?? [])
  const rows = gens.map((gen) => {
    if (gen.status === 'completed') {
      const landed = landedOutputs(gen)
      return `- ${gen.outputId}: completed | ${landed.map((o) => `${o.mediaId} ${o.url}`).join(', ') || '(no urls)'}`
    }
    if (gen.status === 'failed') {
      return `- ${gen.outputId}: failed | ${gen.error ?? 'unknown error'}`
    }
    const secs = pollAfterSecondsFor(gen.contentType)
    // Same rule as the single form: surface the slots that already landed rather than making the
    // caller block on the slowest one. The count says the set is incomplete, so a row can never be
    // mistaken for a finished generation.
    const ready = landedOutputs(gen)
    if (ready.length > 0) {
      return `- ${gen.outputId}: ${gen.status}, ${ready.length} ready so far | ${ready.map((o) => `${o.mediaId} ${o.url}`).join(', ')} [poll_after_seconds: ${secs}]`
    }
    return `- ${gen.outputId}: ${gen.status} [poll_after_seconds: ${secs}]`
  })
  return text([`${gens.length} generation(s):`, ...rows].join('\n'))
}

/** A finished transcription: header line plus the transcript body. */
export function transcriptResult(t: Transcription): CallToolResult {
  const lang = t.language ? ` (${t.language})` : ''
  const header = `Transcript${lang}, ${t.wordCount} words (outputId ${t.outputId}):`
  return withCharge(text([header, '', t.transcript].join('\n')), t.charge)
}

/** Join the non-empty lines (drops null/empty entries). */
function lines(parts: Array<string | null | undefined>): string {
  return parts.filter((p): p is string => !!p).join('\n')
}

/**
 * The last line of every paged listing when a next page exists: the cursor to pass, in one wording for every tool.
 * Nothing on the last page, so an agent is told more exists exactly when it does.
 */
export function moreLine(nextCursor: string | null | undefined): string | null {
  return nextCursor ? `More: pass cursor "${nextCursor}".` : null
}

/** Free text cut for a listing line: a prompt, a file name, a summary. */
function clipped(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}...` : value
}

/** How much of a prompt or a file name a listing line shows. */
const LISTING_TEXT_MAX = 80

/** List of avatars, each with the fields an agent needs to drive lip-sync. */
export function avatarListResult({ avatars, nextCursor }: AvatarListResult): CallToolResult {
  if (!avatars.length) {
    return text('No avatars found. Create one in the ContentHero app first.')
  }
  const rows = avatars.map(
    (a) =>
      `- ${a.name} (${idOf(a)})${a.isDefault ? ' [default]' : ''} | image: ${a.imageUrl ?? 'none'} | voice: ${a.defaultVoiceId ?? 'none'}`,
  )
  return text(lines([`${avatars.length} avatar(s):`, ...rows, moreLine(nextCursor)]))
}

/** One avatar's full detail, including its looks. */
export function avatarResult(a: Avatar): CallToolResult {
  const traits = [a.gender, a.age, a.ethnicity].filter(Boolean).join(', ')
  return text(
    lines([
      `${a.name} (${idOf(a)})${a.isDefault ? ' [default]' : ''}`,
      `image (base look, use as imageUrl for generate_lip_sync): ${a.imageUrl ?? 'none'}`,
      `default voice (use as voiceId): ${a.defaultVoiceId ?? 'none'}`,
      a.description ? `description: ${a.description}` : null,
      traits ? `traits: ${traits}` : null,
      a.niche.length ? `niche: ${a.niche.join(', ')}` : null,
      a.looks.length ? `looks (${a.looks.length}):` : 'looks: none',
      ...a.looks.map(
        (l) =>
          `  - ${l.name ?? l.lookType ?? 'look'} (${idOf(l)})${l.isDefault ? ' [default]' : ''}${l.isFavorited ? ' [favorite]' : ''}${l.isArchived ? ' [archived]' : ''}: ${l.imageUrl ?? 'none'}`,
      ),
    ]),
  )
}

/**
 * A just-created avatar, which is NOT READY.
 *
 * ⚠️ THE POINT OF A SEPARATE FORMATTER IS THE WAIT. `avatarResult` describes a finished avatar, and
 * using it here would show an avatar with `image: none` and no looks, which reads as "created, and
 * empty" rather than "created, and still generating". A model that reads it that way goes on to
 * generate a look into an avatar whose own first look is still in flight, or reports success to the
 * user for something they cannot yet see.
 *
 * Says the poll call explicitly, the same way `pendingResult` does for a generation.
 */
export function avatarPendingResult(created: CreateAvatarResult): CallToolResult {
  const a = created.avatar
  return text(
    lines([
      `Created "${a.name}" (${idOf(a)}).`,
      '',
      `⚠️ NOT READY YET: status is ${created.status}. The avatar has no image until its first look`,
      'finishes generating, which is also when its default look and profile photo are set.',
      `Poll with: get_avatar { "avatarId": "${a.id}" } until status is "completed" (usually 1-4 minutes).`,
      '',
      'Credits are charged when that look completes, not now, so a failed generation is not charged.',
      chargeLine(created.charge),
    ]),
  )
}

/** List of saved voices. */
export function voiceListResult({ voices, nextCursor }: VoiceListResult): CallToolResult {
  if (!voices.length) return text('No saved voices found.')
  const rows = voices.map(
    (v) =>
      `- ${v.name ?? '(unnamed)'} (${idOf({ id: v.voiceId, appUrl: v.appUrl }, 'voiceId')})${v.isFavorited ? ' [favorite]' : ''}${v.previewUrl ? ` | preview: ${v.previewUrl}` : ''}`,
  )
  return text(lines([`${voices.length} voice(s):`, ...rows, moreLine(nextCursor)]))
}

/** One voice's full detail. */
export function voiceResult(v: Voice): CallToolResult {
  const traits = [v.gender, v.age, v.accent, v.language].filter(Boolean).join(', ')
  return text(
    lines([
      `${v.name ?? '(unnamed)'} (${idOf({ id: v.voiceId, appUrl: v.appUrl }, 'voiceId')})${v.isFavorited ? ' [favorite]' : ''}`,
      v.provider ? `provider: ${v.provider}` : null,
      traits ? `traits: ${traits}` : null,
      v.description ? `description: ${v.description}` : null,
      v.useCase ? `use case: ${v.useCase}` : null,
      v.previewUrl ? `preview: ${v.previewUrl}` : null,
    ]),
  )
}

/** List of brand kits. */
export function brandKitListResult({ brandKits: kits, nextCursor }: BrandKitListResult): CallToolResult {
  if (!kits.length) return text('No brand kits found. Create one in the ContentHero app first.')
  const rows = kits.map(
    (k) =>
      `- ${k.name} (${idOf(k)})${k.isDefault ? ' [default]' : ''}`,
  )
  return text(lines([`${kits.length} brand kit(s):`, ...rows, moreLine(nextCursor)]))
}

/**
 * One brand kit in full. The kit is deeply structured (visual identity, voice,
 * curated sections, linked accounts, knowledge), so return a short header plus
 * the whole object as JSON: faithful and complete, and an agent reads it cleanly.
 */
/**
 * A linked account as an AI needs it: who it is, never how to draw it. `avatarUrl` is a long signed image link an
 * app renders and a model cannot use, and `accountType` repeats the list the account is already in. A kit linked to
 * 68 inspiration accounts made the full read about 60 KB, most of it avatar links (measured 2026-09-26). The API and
 * the SDK still return both fields, for apps that draw the accounts.
 */
function accountForModel(a: BrandKitAccount): Omit<BrandKitAccount, 'avatarUrl' | 'accountType'> {
  return { id: a.id, platform: a.platform, name: a.name, handle: a.handle, followerCount: a.followerCount }
}

export function brandKitResult(kit: BrandKit, started?: BrandImportOutcome): CallToolResult {
  const header = `Brand kit "${kit.name}"${kit.isDefault ? ' [default]' : ''} (${idOf(kit)}):`
  // Stated in words, not just left in the JSON, because the caller has to know the kit it just got back is
  // still FILLING IN. Without this line an agent reads an almost-empty kit and concludes the import failed.
  const note = started ? importNote(started) : null
  const forModel = {
    ...kit,
    brandAccounts: kit.brandAccounts.map(accountForModel),
    inspirationAccounts: kit.inspirationAccounts.map(accountForModel),
  }
  return text([header, ...(note ? ['', note] : []), '', JSON.stringify(forModel, null, 2)].join('\n'))
}

function importNote(started: BrandImportOutcome): string {
  if (started.error) {
    return `The kit was created, but its import could not be started: ${started.error}. Retry with update_brand_kit and extract:true.`
  }
  if (!started.extract && !started.synthesis) {
    return 'Nothing to import: the kit has no website and no own YouTube or Instagram account. Add one, then pass extract:true.'
  }
  if (started.extract?.status === 'unconfigured' || started.synthesis?.status === 'unconfigured') {
    return 'Import is NOT CONFIGURED on this deployment, so nothing was queued.'
  }
  const state = (o: { status: string }) => (o.status === 'deduped' ? 'was ALREADY RUNNING' : 'STARTED')
  const parts: string[] = []
  if (started.extract) parts.push(`Visual extraction (logos, colors, fonts) from the first website ${state(started.extract)}.`)
  if (started.synthesis) {
    parts.push(
      `The analysis that writes the empty sections ${state(started.synthesis)}; it waits for new accounts' posts and transcripts, so it can take several minutes.`,
    )
  }
  parts.push('Poll extractionStatus and analysisStatus with get_brand_kit.')
  return parts.join(' ')
}

/**
 * A kit's summary: every section, one line each plus its outline, no bodies. Compact on purpose: this is the read
 * an agent makes first to decide what to load, so it should cost little.
 */
export function brandKitSummaryResult(kit: BrandKitSummaryRead): CallToolResult {
  const lines = [`Brand kit "${kit.name}" (${idOf(kit)}), ${kit.sections.length} section(s):`]
  for (const s of kit.sections) {
    lines.push(
      '',
      `[${s.tab}] ${s.sectionName} | key ${s.key}${s.role ? ` | role ${s.role}` : ''} | v${s.version} | ${s.charCount ? `${s.charCount} chars` : 'empty'}`,
    )
    if (s.outline.length) lines.push(`  covers: ${s.outline.join(' / ')}`)
  }
  return text(lines.join('\n'))
}

/**
 * The sections a filtered read asked for, each as its own Markdown document under a one-line header, and its
 * history when asked. Text rather than JSON: a body is Markdown, and JSON would escape every line break in it.
 */
export function brandKitSectionsResult(read: BrandKitSectionsRead): CallToolResult {
  if (!read.sections.length) return text(`No sections in brand kit "${read.name}" match that filter.`)
  const lines = [`${read.sections.length} section(s) from brand kit "${read.name}" (${idOf(read)}):`]
  for (const s of read.sections) {
    lines.push(
      '',
      `=== [${s.tab}] ${s.sectionName} | key ${s.key}${s.role ? ` | role ${s.role}` : ''} | v${s.version} (pass as expectedVersion) ===`,
      '',
      s.body || '(empty)',
    )
    for (const r of s.revisions ?? []) {
      lines.push('', `--- v${r.version}, ${r.bodySource}, ${r.createdAt} ---`, '', r.body || '(empty)')
    }
  }
  return text(lines.join('\n'))
}

/** A brand kit that was just archived. */
export function brandKnowledgeListResult(result: BrandKnowledgeListResult): CallToolResult {
  if (!result.items.length) {
    return text('No knowledge items in this brand kit yet. Add one with add_brand_knowledge.')
  }
  const more = result.nextCursor ? ` (showing ${result.items.length} of ${result.total})` : ''
  const rows = result.items.map(
    (k) => `- ${k.title ?? '(untitled)'} [${k.sourceType ?? 'unknown'}] (${idOf(k)})`,
  )
  return text(lines([`${result.total} knowledge item(s)${more}:`, ...rows, moreLine(result.nextCursor)]))
}

export function brandKnowledgeDetailResult(item: BrandKnowledgeDetail): CallToolResult {
  return text(
    [
      `${item.title ?? '(untitled)'} [${item.sourceType ?? 'unknown'}] (${idOf(item)})`,
      item.sourceUrl ? `Source: ${item.sourceUrl}` : null,
      '',
      item.content ?? '(no stored body; use search_brand_knowledge for the full depth)',
    ]
      .filter((l) => l !== null)
      .join('\n'),
  )
}

export function brandKnowledgeSearchResult(matches: BrandKnowledgeMatch[]): CallToolResult {
  if (!matches.length) {
    return text('No matching knowledge found. Try a broader query or a lower threshold.')
  }
  const blocks = matches.map((m, i) => {
    const score = m.similarity.toFixed(3)
    const header = `[${i + 1}] ${m.title ?? '(untitled)'} (item ${m.knowledgeId ?? '?'}, score ${score})`
    return `${header}\n${m.content}`
  })
  return text([`${matches.length} match(es):`, ...blocks].join('\n\n'))
}

/** A removed knowledge item: only its id survives, and it no longer has a page, so no appUrl. */
export function brandKnowledgeRemovedResult(r: { id: string }): CallToolResult {
  return text(`Knowledge item removed (id ${r.id}).`)
}

export function brandKnowledgeItemResult(item: BrandKnowledgeItem, verb = 'Added', charge?: Charge): CallToolResult {
  return withCharge(text(`${verb} knowledge item: "${item.title ?? '(untitled)'}" [${item.sourceType ?? 'unknown'}] (${idOf(item)}).`), charge)
}

/** The confirmation of a favorite or archive: the media item by its media id, anything else by type and id. */
export function statusActionResult(
  action: 'Favorited' | 'Unfavorited' | 'Archived' | 'Unarchived',
  target: { mediaId?: string; assetType?: string; id?: string },
): CallToolResult {
  const what = target.mediaId ? `media ${target.mediaId}` : `${target.assetType ?? 'asset'} ${target.id}`
  return text(`${action} ${what}.`)
}

/**
 * An item's link in a listing: its small copy, marked as one, when the listing was asked for small copies and the
 * library keeps one (8.5); otherwise the file itself.
 */
function listingLink(item: { url: string | null; smallUrl?: string | null }): string {
  if (item.smallUrl) return ` | small copy: ${item.smallUrl}`
  return item.url ? ` | ${item.url}` : ''
}

/** A page of the library's files, one row per file, in the order asked for. */
export function mediaListResult(page: MediaListResult): CallToolResult {
  const items = page.media
  if (!items.length) return text('No media found.')
  const rows = items.map((m) => {
    // A studio generation lists as one row per output, each named by its own media id; say when it has siblings.
    const varTag = m.generationSize > 1 ? ` | one of ${m.generationSize} outputs` : ''
    const favTag = m.isFavorited ? ' [favorite]' : ''
    const promptStr = m.prompt ? ` | ${clipped(m.prompt, LISTING_TEXT_MAX)}` : ''
    const kindTag =
      m.kind === 'board'
        ? ` | board${m.boardType ? `:${m.boardType}` : ''}`
        : m.kind && m.kind !== 'creation'
          ? ` | ${m.kind}`
          : ''
    const nameStr = m.fileName ? ` | ${clipped(m.fileName, LISTING_TEXT_MAX)}` : ''
    const durStr = m.durationSeconds != null ? ` | ${Math.round(m.durationSeconds)}s` : ''
    const sizeStr = m.sizeBytes != null ? ` | ${describeFileSize(m.sizeBytes)}` : ''
    // The asset id is what get_project reports as a clip's sourceId: printed so an agent can match a clip to the
    // library item it was cut from. A field the text does not print is invisible to the agent that fetched it.
    const assetStr = m.assetId ? ` | asset ${m.assetId}` : ''
    // Every item is a single variation carrying its resolved url; surface it inline so the agent can
    // reference the media directly (e.g. add it to a timeline) without a get call.
    const urlStr = listingLink(m)
    return `- [${m.type}] ${m.model ?? ''} (${idOf({ id: m.mediaId, appUrl: m.appUrl }, 'media')})${varTag}${favTag}${kindTag}${nameStr}${durStr}${sizeStr}${assetStr} | ${m.source}${promptStr}${urlStr}`
  })
  return text(lines([`${items.length} item(s):`, ...rows, moreLine(page.nextCursor)]))
}

/** A page of semantic library-search matches: assets ranked by relevance, with matched scene timestamps for video. */
export function mediaSearchResult(page: SearchMediaPage): CallToolResult {
  const results = page.results
  if (!results.length) return text('No matching media found.')
  const rows = results.map((r) => {
    const rel = ` | ${Math.round(r.relevance * 100)}%`
    const kindTag = r.kind ? `[${r.kind}]` : '[media]'
    const summaryStr = r.summary ? ` | ${clipped(r.summary, 90)}` : ''
    const scenesStr = r.scenes.length
      ? ` | scenes: ${r.scenes.map((s) => `${(s.startMs / 1000).toFixed(1)}-${(s.endMs / 1000).toFixed(1)}s`).join(', ')}`
      : ''
    const urlStr = listingLink(r)
    return `- ${kindTag} (${idOf({ id: r.mediaId, appUrl: r.appUrl }, 'media')})${rel}${summaryStr}${scenesStr}${urlStr}`
  })
  return text(lines([`${results.length} match(es) (most relevant first):`, ...rows, moreLine(page.nextCursor)]))
}

/** The user's folders (their own + the built-in derived folders). */
export function folderListResult(data: FolderListResult): CallToolResult {
  const own = data.folders.map((f) => `- ${f.name} [${f.type}] (${idOf(f)})${f.parentId ? ` | in ${f.parentId}` : ''}`)
  const derived = data.derived.map((d) => `- ${d.name} (key ${d.key})`)
  return text([
    own.length ? `Your folders (${own.length}):` : 'You have no folders yet.',
    ...own,
    // The next page of the account's own folders; the built-in ones are the same on every page.
    ...(data.nextCursor ? [moreLine(data.nextCursor) as string] : []),
    '',
    'Built-in folders:',
    ...derived,
  ].join('\n'))
}

/** A page of one folder's contents (media items + entities). */
export function folderContentsResult({ folder, items, nextCursor }: FolderContents): CallToolResult {
  const header = folder ? `"${folder.name}" - ${items.length} item(s):` : `${items.length} item(s):`
  if (!items.length) return text(`${header}\n(empty)`)
  const rows = items.map((i) => {
    if (i.type === 'media') {
      const rel = i.relevance != null ? ` | ${Math.round(i.relevance * 100)}%` : ''
      const fav = i.isFavorited ? ' [favorite]' : ''
      const summ = i.summary ? ` | ${clipped(i.summary, 80)}` : ''
      return `- [${i.kind ?? 'media'}] (${idOf({ id: i.mediaId, appUrl: i.appUrl }, 'media')})${rel}${fav}${summ}${listingLink(i)}`
    }
    return `- [${i.type}] ${i.name} (${idOf(i)})${i.subtype ? ` | ${i.subtype}` : ''}`
  })
  return text(lines([header, ...rows, moreLine(nextCursor)]))
}

/** One resolved batch item's metadata line (no image; that is added separately). */
function batchItemLine(it: ResolvedMediaBatchItem, index: number, hasImage: boolean): string {
  const label = `[${index + 1}]`
  if (!it.ok) {
    const ref = it.mediaId ?? ('url' in it.input ? it.input.url : JSON.stringify(it.input))
    return `${label} ERROR (${ref}): ${it.error ?? 'could not resolve'}`
  }
  const idPart = it.mediaId ? `${it.type ?? 'media'} ${it.mediaId}` : `${it.type ?? 'media'} (url)`
  const others = it.otherMediaIds.length > 0 ? ` | other outputs: ${it.otherMediaIds.join(', ')}` : ''
  const model = it.model ? ` from ${it.model}` : ''
  const prompt = it.prompt ? `\n    prompt: ${it.prompt}` : ''
  // Explain the absence of an image so the model does not assume it failed.
  let note = ''
  if (!hasImage) {
    if (it.type === 'audio') note = '\n    (audio: no visual; use the url)'
    else if (it.type === 'video' && !it.keyframeError) note = '\n    (video: no still available for this view; use the url)'
    else if (it.type === 'transcript') note = '\n    (transcript: text only)'
  }
  // MEASURED GEOMETRY, when the spine has it. Without these numbers a caller cannot compute an asset's true
  // aspect (so it stretches it on placement) and cannot align to the VISIBLE artwork of a padded logo at all.
  // `content` is the artwork's bounds inside the file; when it is smaller than the file, say so explicitly,
  // because that difference is the whole reason to read it.
  let geom = ''
  if (it.geometry) {
    const { width, height, content } = it.geometry
    geom = `\n    dimensions: ${width}x${height}`
    if (content) {
      const trimmed = content.width < width || content.height < height
      geom += trimmed
        ? ` | artwork: ${content.width}x${content.height} at (${content.x}, ${content.y}) -- the rest is transparent margin, so place and align by THIS box, not the file`
        : ' | artwork fills the frame'
    }
  }
  // MEASURED DURATION, for anything time-based. Reported for AUDIO too, which is the point: audio has no
  // dimensions, so it carried no measured facts at all, and `edit_audio` requires a durationSeconds to price
  // the job. The only way to call it correctly was to download the file and probe it.
  const dur = it.durationSeconds != null ? `\n    duration: ${it.durationSeconds.toFixed(2)}s` : ''
  // THE ZOOM (7.50): what was cut, and how its pixels map back to the file, so a point can be placed on the source.
  const zoom = it.crop
    ? `\n    zoom: ${it.crop.region.width}x${it.crop.region.height} at (${it.crop.region.x}, ${it.crop.region.y}) in the file's pixels, shown at ${it.crop.width}x${it.crop.height} (${it.crop.pixelsPerSourcePixel} px per file px)`
    : it.cropError
      ? `\n    zoom not shown: ${it.cropError}`
      : ''
  // A failure says what failed. Reported as "no still available" until 2026-10-06, which read as expected behavior.
  const keyframes = it.keyframeError ? `\n    keyframes not shown: ${it.keyframeError}` : ''
  // What it was made FROM, labeled as Studio labels it, so "make another like this" can pass the same inputs back.
  const refs = describeReferences(it.references)
  const madeFrom = refs.length > 0 ? `\n    made from:${refs.map((r) => `\n      ${r}`).join('')}` : ''
  return `${label} ${idPart}${model}${others}\n    ${it.url}${geom}${dur}${zoom}${keyframes}${prompt}${madeFrom}${note}`
}

/**
 * A vision-enabled media batch (get_media). Returns a text summary + one metadata
 * line per item, and, for each image item whose bytes were fetched, an IMAGE
 * content block so the calling model can SEE it. Images arrive as a parallel
 * array (fetched + base64-encoded by the caller, image items only; null for
 * video/audio/errors). This just assembles the result. See get-context §9.5.
 */
/**
 * Turn resolved media into tiles.
 *
 * ## ⭐⭐⭐ THE BYTES ARE FOR THE AGENT, THE URLS ARE FOR THE PERSON, AND ONE CALL DOES BOTH
 *
 * The image blocks above are the agent's vision and they cost context, which is why they run through one
 * shared budget. The widget renders from URLS, which cost nothing. So a call can attach as many pixels as
 * the budget allows AND display every item, and the two limits do not fight: more items means fewer
 * inlined images, never a card that shows less than was asked for.
 *
 * ⭐ **THE CHIP IS PER ITEM AND COMES FROM THE REGISTRY.** `model` here is a RAW ID and is never shown as
 * one: `gpt-image-2` reads like a label, and substituting it is the exact defect that made the generation
 * chip flicker between kebab case and title case. The API now resolves a display name alongside it, so a
 * mixed set can label each tile with the model that actually made it, and a tile the registry cannot name
 * renders its media and no label.
 *
 * ⚠️ Transcripts are skipped: the widget has no element for text, and a tile that renders nothing is worse
 * than an item the summary already describes in words.
 */
function mediaBatchItems(result: MediaBatchResult): MediaWidgetItem[] {
  const items: MediaWidgetItem[] = []
  for (const it of result.items) {
    if (!it.ok || !it.url) continue
    if (it.type !== 'image' && it.type !== 'video' && it.type !== 'audio') continue
    const g = it.geometry
    items.push({
      url: it.url,
      // A video's still, so a tile shows something before anyone presses play.
      posterUrl: it.type === 'video' ? it.imageUrl : null,
      // The reference the API takes, formatted by the server (`a1B2c3D4`, or `a1B2c3D4-2` for one output of
      // several). It used to be built here, and output 1 of several came out with no suffix (7.44).
      name: it.mediaId ?? it.url,
      // ⚠️ Only a mediaId is referenceable. A raw url resolved here is not a library item the API can name.
      reference: it.mediaId ?? undefined,
      contentType: it.type,
      // MEASURED, from the storage spine. Null when nothing measured it, which the tile handles.
      displayAspect: g ? aspectLabel(g.width, g.height) : null,
      // The server's link. Absent for a raw url that is not one of the account's items.
      openUrl: it.appUrl,
      // The small picture for the tile. The master stays on `url` for download.
      previewUrl: it.previewUrl ?? null,
      source: it.source ?? null,
      /**
       * ⭐ PER ITEM, WHICH IS WHAT MAKES RECREATE WORK FOR A MIXED SET. These were only ever read from the
       * payload's SHARED fields, which are null the moment two items disagree, so a library set offered no
       * Recreate at all even though every item knew its own model and prompt.
       */
      modelId: it.model ?? null,
      /**
       * ⭐ THE PER-ITEM CHIP, WHICH IS WHAT A MIXED SET NEEDS. The payload's SHARED model fields are null
       * the moment two items disagree, so a library set spanning four models showed no chip at all even
       * though every item knew its own.
       *
       * ⛔ NO `?? it.model` FALLBACK. A null name means the registry could not name it, and the id reads
       * enough like a label that printing one hides the failure rather than showing it.
       */
      modelName: it.modelName ?? null,
      modelBrandColor: it.modelBrandColor ?? null,
      modelIconKey: it.modelIconKey ?? null,
    })
  }
  return items
}

/**
 * One inlined image, or the reason there is none.
 *
 * ⭐⭐⭐ **THE REASON TRAVELS WITH THE SLOT, BECAUSE A COUNT IS NOT A DIAGNOSIS.** "0 image(s) attached" was
 * true for a week across two unrelated defects and could not distinguish either from a network blip.
 */
export interface InlinedImageSlot {
  image: { data: string; mimeType: string } | null
  skipped?: string
  /** Machine-readable cause, so advice about the CALL is said once rather than once per item. */
  reason?: string
}

/**
 * Images that arrive ALREADY ENCODED (data urls), admitted against what is left of the result's inline allowance.
 *
 * In order, and contiguous: once one does not fit, the rest are counted, never a scattered subset, so "the first N
 * attached" is always a true reading. The one rule for in-hand bytes: get_media keyframes and get_context renders.
 * A fetched image goes through `inlineImagesWithinBudget` in server.ts instead, which spends the same allowance.
 */
export function admitWithinBudget<T extends { data: string }>(
  images: readonly T[],
  budget: number,
): { admitted: T[]; dropped: number; remaining: number } {
  let remaining = budget
  const admitted: T[] = []
  let dropped = 0
  for (const image of images) {
    if (dropped > 0 || image.data.length > remaining) {
      dropped++
      continue
    }
    remaining -= image.data.length
    admitted.push(image)
  }
  return { admitted, dropped, remaining }
}

export function mediaBatchResult(
  result: MediaBatchResult,
  images: InlinedImageSlot[],
  /**
   * What is left of the result's inline allowance after `images`. Keyframes arrive already encoded, so they were
   * added with no size check at all: 24 frames at 640px is about 2 MB against a 1 MB ceiling for the whole result.
   * They now spend the same budget, in order, and the ones that do not fit are counted rather than dropped silently.
   */
  keyframeBudget: number,
): CallToolResult {
  const { items } = result
  const okCount = items.filter((i) => i.ok).length
  const keyframes = items.flatMap((it, item) =>
    (it.keyframes ?? []).flatMap((kf) => {
      const parsed = parseDataUrl(kf.dataUrl)
      return parsed ? [{ ...parsed, item }] : []
    }),
  )
  const spent = admitWithinBudget(keyframes, keyframeBudget)
  const keyframesDropped = spent.dropped
  const admitted = items.map((_, item) =>
    spent.admitted.filter((kf) => kf.item === item).map(({ data, mimeType }) => ({ data, mimeType })),
  )
  const keyframeCount = admitted.reduce((n, a) => n + a.length, 0)
  const shownImages = images.filter((s) => s?.image).length + keyframeCount
  /**
   * ⚠️ REPORTED ONCE PER DISTINCT CAUSE, not once per item. Eight items failing the same way is one fact,
   * and printing it eight times buries the item lines that carry the urls.
   */
  const reasons = [...new Set(images.map((s) => s?.skipped).filter((r): r is string => !!r))]
  /**
   * ⭐ ADVICE ABOUT THE CALL, SAID ONCE. Three items crowded out of one budget is ONE fact with three
   * measurements, and repeating the remedy beside each of them buries the item lines that carry the urls.
   */
  const crowdedOut = images.some((s) => s?.reason === 'budget-spent')
  const summary =
    `Found ${okCount} of ${items.length} item(s); showing ${shownImages} image(s) below` +
    (keyframeCount > 0 ? ` (including ${keyframeCount} video keyframe(s))` : '') +
    '.' +
    (reasons.length > 0 ? ` Not shown: ${reasons.join('; ')}.` : '') +
    (crowdedOut ? ' Ask for fewer items per call to see the rest.' : '') +
    (keyframesDropped > 0
      ? ` ${keyframesDropped} keyframe(s) not shown: too large for this reply. Ask for fewer frames or a narrower fromSec/toSec.`
      : '') +
    `\n\n` +
    items
      .map((it, i) => batchItemLine(it, i, Boolean(images[i]?.image) || (admitted[i]?.length ?? 0) > 0))
      .join('\n')
  const content: CallToolResult['content'] = [{ type: 'text', text: summary }]
  items.forEach((it, i) => {
    const img = images[i]?.image
    if (img) {
      content.push({ type: 'text', text: `Image for item [${i + 1}]:` })
      content.push({ type: 'image', data: img.data, mimeType: img.mimeType })
    }
    const keyframes = admitted[i] ?? []
    const total = it.keyframes?.length ?? 0
    if (keyframes.length > 0) {
      const of = keyframes.length < total ? ` of ${total}` : ''
      content.push({ type: 'text', text: `${keyframes.length}${of} keyframe(s) for item [${i + 1}] (raw footage, in order):` })
      for (const kf of keyframes) content.push({ type: 'image', data: kf.data, mimeType: kf.mimeType })
    }
  })
  /**
   * ⭐ DISPLAY COSTS NOTHING EXTRA. The blocks above are the agent's vision and are budget-bounded; this is
   * urls, so every resolved item renders whether or not its pixels fit that budget.
   */
  /**
   * ⛔⛔⛔ **NO CARD FROM THIS TOOL, AND THE SPLIT IS WHY.**
   *
   * `get_media` used to display as well, on the reasoning that the agent is already looking so showing
   * the person costs nothing. The first real test of that rule refuted it: an agent fetched keyframes of
   * a video it had JUST generated, and the person got a second card showing the same video directly under
   * the first. Every inspection of already-shown media produced a duplicate.
   *
   * ⭐ `show_media` exists precisely so display has its own verb. With that in place, "the agent is
   * already looking" stops being an argument for a card and becomes an argument for none: looking and
   * showing are now two tools, and a tool that does both is the thing we split apart.
   *
   * ⚠️ NO `structuredContent` EITHER. Without `_meta` no host mounts anything, so a payload here would be
   * bytes on the wire that nothing can ever read, on the one tool whose entire constraint is its size.
   */
  return { content }
}

/**
 * The DISPLAY twin of `mediaBatchResult`: the same tiles, none of the bytes.
 *
 * ## ⭐⭐⭐ WHY THIS IS A SECOND TOOL AND NOT A FLAG
 *
 * `get_media` costs about 2 KB for twenty items and about 900 KB for four, depending on how many previews
 * fit the inline budget. An agent cannot reason about that before calling, and no description can state it
 * honestly. **A tool whose context cost is unpredictable is the real defect**, not the number of items it
 * accepts.
 *
 * Splitting makes each one honest. `get_media` costs bytes and is capped where the budget actually runs
 * out. This costs a couple of kilobytes no matter how many items it carries, because it never fetches
 * anything: the widget renders from urls, and a url costs the same whether it points at 60 KB or 3 MB.
 *
 * ⛔ **IT SHARES THE RESOLVER AND THE TILE BUILDER, DELIBERATELY.** The two tools differ in exactly one
 * thing, whether bytes are read. A second resolution path would be a second answer to "what is this item",
 * and the widget would start rendering two slightly different shapes depending on which verb was used.
 *
 * ⚠️ NO "0 image(s) attached" LINE. Saying it here would report the absence of something never promised,
 * which is how a working tool reads as a broken one.
 */
/**
 * One short line per shown item: what it is and how to name it again, and nothing else.
 *
 * ⚠️ THE PROMPT IS DELIBERATELY ABSENT. It is the single largest field on an item and the one this
 * audience does not read. An id is 36 characters and lets the agent ask for any of these in detail.
 */
function displayItemLine(it: ResolvedMediaBatchItem, i: number): string {
  const label = `[${i + 1}]`
  if (!it.ok) {
    const ref = it.mediaId ?? ('url' in it.input ? it.input.url : JSON.stringify(it.input))
    return `${label} ERROR (${ref}): ${it.error ?? 'could not resolve'}`
  }
  const name = it.mediaId ?? it.url ?? 'url'
  return `${label} ${it.type ?? 'media'} ${name}`
}

export function mediaDisplayResult(result: MediaBatchResult): CallToolResult {
  const { items } = result
  const okCount = items.filter((i) => i.ok).length
  const tiles = mediaBatchItems(result)
  const summary =
    `Showing ${okCount}/${items.length} media item(s) to the person.` +
    (okCount < items.length ? ' Items that could not be resolved are listed below.' : '') +
    '\n\n' +
    items.map((it, i) => displayItemLine(it, i)).join('\n')
  const content: CallToolResult['content'] = [{ type: 'text', text: summary }]
  if (tiles.length === 0) return { content }
  return {
    content,
    structuredContent: mediaWidgetData({ items: tiles }),
    _meta: WIDGET_META,
  }
}

/** One file's phase 1 outcome: its signed upload, or why none was created. */
export type MediaUploadOutcome = { fileName: string } & ({ upload: CreateMediaUploadResult } | { error: string })

/**
 * Phase 1 of an upload, for a batch: each file's signed URL and the headers its PUT must carry, then one
 * completion for all of them.
 *
 * ⭐ ONE CALL FOR THE BATCH, because each completion used to be its own tool call and each one mounted its own
 * card: twelve logos uploaded on 2026-10-05 put twelve cards in a row in the person's chat. Completing a batch
 * together is what lets the person see it as one card (`uploadedMediaBatchResult`).
 */
export function mediaUploadsResult(outcomes: MediaUploadOutcome[]): CallToolResult {
  const created = outcomes.flatMap((o) => ('upload' in o ? [o.upload] : []))
  const blocks = outcomes.flatMap((o, i) => {
    const label = `[${i + 1}] ${o.fileName}`
    if ('error' in o) return [`${label}: could not create its upload: ${o.error}`]
    const r = o.upload
    // The headers are listed EXPLICITLY rather than described, because this instruction is executed by an
    // agent and "with the file's Content-Type" was about to become wrong. On R2 the presigned URL signs the
    // owner in as `x-amz-meta-user_id`, and a PUT missing it is refused with SignatureDoesNotMatch (verified:
    // 403 with Content-Type alone, 200 with both). Listing them from the server's own answer means a change of
    // storage needs no change here.
    const headers = r.uploadHeaders ?? { 'Content-Type': 'the file MIME type' }
    return [
      `${label} (id ${r.outputId}), URL expires ${r.expiresAt}:`,
      `   ${r.uploadUrl}`,
      ...Object.entries(headers).map(([k, v]) => `     ${k}: ${v}`),
    ]
  })
  if (created.length === 0) return text(lines(['No upload was created.', ...blocks]), true)
  const ids = created.map((r) => r.outputId)
  return text(
    lines([
      `Created ${created.length === outcomes.length ? created.length : `${created.length} of ${outcomes.length}`} upload(s). Two steps remain:`,
      "1. PUT each file's bytes to its URL, sending EXACTLY the headers listed under it, unchanged:",
      ...blocks,
      `2. Call complete_media_upload once with outputIds ${JSON.stringify(ids)} to finalize them together.`,
      'Once complete, reference the media by its outputId in generations or post assets.',
    ]),
  )
}

/** One upload's phase 2 outcome: the media it became, or why it did not. */
export type UploadedMediaOutcome = { outputId: string } & ({ media: UploadedMedia } | { error: string })

/**
 * Media the person's own bytes just became, for a batch: one card for everything that landed.
 *
 * ## ⭐ AN UPLOAD IS NEW MEDIA IN THEIR LIBRARY, SO IT DISPLAYS
 *
 * The rule is that a tool returning newly created or newly acquired media shows it, and an upload is the
 * second. Confirmation is the value: a thumbnail says the right file landed, where a line of text says
 * only that something did.
 *
 * ⭐ ONE CARD FOR THE BATCH. A batch finalized together is one thing the person did, so it is one card, with a
 * tile per file, the shape `show_media` already draws. Each tile carries its own id, since the files share no
 * output.
 *
 * ⛔ A tile needs the file's `contentType`: guessing image from a url's extension is what renders a video as
 * a broken image, so a `document`, which has no element, stays text.
 *
 * ⚠️ Referenceable, unlike an export: `outputId` is exactly what `generate_*` accepts, which is what the
 * prose has always told the caller.
 */
export function uploadedMediaBatchResult(outcomes: UploadedMediaOutcome[]): CallToolResult {
  const done = outcomes.flatMap((o) => ('media' in o ? [o.media] : []))
  const prose = lines([
    `Media ready (${done.length === outcomes.length ? done.length : `${done.length} of ${outcomes.length}`}):`,
    ...outcomes.map((o, i) =>
      'media' in o
        ? `[${i + 1}] ${idOf({ id: o.media.outputId, appUrl: o.media.appUrl })}: ${o.media.url}`
        : `[${i + 1}] ${o.outputId}: could not finalize: ${o.error}`,
    ),
    done.length > 0 ? 'Reference each by outputId in generate_* or add_post_asset, or find it via list_media / get_media.' : null,
  ])
  if (done.length === 0) return text(prose, true)
  const tiles = done.flatMap((m) => {
    const tile = libraryItemTile(m.outputId, m.url, m.contentType, m.appUrl)
    return tile ? [tile] : []
  })
  if (tiles.length === 0) return text(prose)
  return { content: [{ type: 'text', text: prose }], structuredContent: mediaWidgetData({ items: tiles }), _meta: WIDGET_META }
}

/** The tile one new library item draws as, or null for a kind with no element (a document). */
function libraryItemTile(
  outputId: string,
  url: string,
  contentType: string | undefined,
  appUrl: string | null | undefined,
): MediaWidgetItem | null {
  const medium = contentType === 'image' || contentType === 'video' || contentType === 'audio' ? contentType : undefined
  if (!medium) return null
  return { url, name: outputId, contentType: medium, reference: outputId, openUrl: appUrl ?? undefined }
}

/**
 * The tail of a "here is one new library item" result (an import).
 *
 * ⚠️ Its tile comes from `libraryItemTile`, the one a batch of uploads draws too, so an imported file and an
 * uploaded one cannot render as two slightly different shapes.
 */
function renderableMedia(
  prose: string,
  outputId: string | null,
  url: string,
  contentType: string | undefined,
  appUrl: string | null | undefined,
): CallToolResult {
  const tile = outputId ? libraryItemTile(outputId, url, contentType, appUrl) : null
  if (!outputId || !tile) return text(prose)
  return {
    content: [{ type: 'text', text: prose }],
    structuredContent: mediaWidgetData({ outputId, contentType: tile.contentType, items: [tile] }),
    _meta: WIDGET_META,
  }
}

/**
 * The result of an import, which may have created nothing.
 *
 * ## Why a duplicate gets its own sentence rather than the same one
 *
 * An import of bytes the account already holds is a successful no-op. Reporting it as "Media ready" would
 * be a lie an agent then acts on: it would try to reference an `outputId` that is null, or import again on
 * the next run because nothing said it had already happened.
 *
 * The two duplicate cases differ in what the caller can DO next, so they read differently:
 *
 *   an existing library item -> there is an id to use, so give it
 *   no library item          -> the bytes are an export or a look; there is no id, so say what it IS
 *
 * Saying "already imported" without naming what it is would send someone hunting for a library item that
 * does not exist. That is the exact confusion this whole fix came from.
 */
export function importedMediaResult(r: ImportedMedia): CallToolResult {
  if (!r.alreadyExisted) {
    return renderableMedia(
      `Media ready (${idOf({ id: r.outputId, appUrl: r.appUrl })}): ${r.url}. Reference it by outputId in generate_* or add_post_asset, or find it via list_media / get_media.`,
      r.outputId,
      r.url,
      r.contentType,
      r.appUrl,
    )
  }
  if (r.outputId) {
    return text(
      `Already in your library (${idOf({ id: r.outputId, appUrl: r.appUrl })}): ${r.url}. Nothing was imported: these exact bytes are already there. Reference it by outputId as usual.`,
    )
  }
  const what = r.existing?.role ? `a ${r.existing.role}` : 'an existing file'
  return text(
    `You already have this file. Nothing was imported: these exact bytes are already in your account as ${what}` +
      `${r.existing?.objectName ? ` (${r.existing.objectName})` : ''}. ` +
      `It is not a library item, so there is no outputId to reference. Use its URL directly: ${r.url}`,
  )
}

/** import_media's answer when the import is still running at the end of the call. */
export function importPendingResult(outputId: string): CallToolResult {
  return text(`Import ${outputId} is still running. Check it with ${getStatusCall([outputId])}.`)
}

export function accountResult(b: Account): CallToolResult {
  const cap = b.spendCap
    ? `Monthly spend cap: ${b.spendCap.limit} credits, ${b.spendCap.remaining} left this month (resets ${b.spendCap.resetsAt.slice(0, 10)}).`
    : 'Monthly spend cap: none.'
  return text(
    lines([
      `Balance: ${b.balance} credits, ${b.available} available (${describeReserved(b.held)}).`,
      `Spent this month: ${b.spentThisMonth} credits.`,
      cap,
      `Tier: ${b.tier}. Auto top-up: ${b.autoTopupEnabled ? 'on' : 'off'}.`,
    ]),
  )
}

// -- Kling elements (Kling 3.0's reusable references) --------------------------

/** List of the account's saved Kling elements. */
export function klingElementListResult({ klingElements: items, nextCursor }: KlingElementListResult): CallToolResult {
  if (!items.length) {
    return text('No Kling elements. Create one with create_kling_element, then reference it in a Kling generation by klingElementId.')
  }
  const rows = items.map((e) => {
    const media = e.inputVideoUrl ? '1 video' : `${e.inputUrls.length} image(s)`
    return `- ${e.name} (${idOf(e)}) | ${e.category} | ${media}${e.description ? ` | ${e.description.slice(0, 60)}` : ''}`
  })
  return text(lines([`${items.length} Kling element(s):`, ...rows, moreLine(nextCursor)]))
}

/** Confirmation that a Kling element was deleted. */
export function klingElementDeletedResult(id: string): CallToolResult {
  return text(`Deleted Kling element ${id}.`)
}

/** One saved Kling element. */
export function klingElementResult(e: KlingElement, verb?: string): CallToolResult {
  if (verb) {
    return text(`${verb} Kling element "${e.name}" (${idOf(e)}, ${e.category}). Reference it in a Kling generation via generate_video's klingElements [{ klingElementId: "${e.id}" }] and @${e.name} in the prompt.`)
  }
  return text(
    lines([
      `${e.name} (${idOf(e)}) | ${e.category}`,
      e.description ? `description: ${e.description}` : null,
      e.inputVideoUrl ? `video: ${e.inputVideoUrl}` : `images (${e.inputUrls.length}): ${e.inputUrls.join(', ')}`,
      `Reference in a Kling prompt as @${e.name}; pass generate_video's klingElements [{ klingElementId: "${e.id}" }].`,
    ]),
  )
}

// -- templates (the editor's Elements) -----------------------------------------

/** A template's own size: a share of the canvas on each axis, or the whole frame. */
function templateBox(t: TemplateSummary): string {
  return t.coverage === 'partial' && t.widthFraction && t.heightFraction
    ? `${Math.round(t.widthFraction * 100)}% x ${Math.round(t.heightFraction * 100)}% of the canvas`
    : 'full frame'
}

/** One template in a line: what it is, whose, its version and its size. */
function templateLine(t: TemplateSummary): string {
  const whose = t.scope === 'system' ? 'ContentHero' : 'yours'
  return `${t.name} (id ${t.id}) | ${t.kind} | ${t.category} | ${whose} | version ${t.version} | ${templateBox(t)}${t.archivedAt ? ' | archived' : ''}`
}

/** A page of templates, and how to get the next. */
export function templateListResult(page: TemplateListResult): CallToolResult {
  if (!page.templates.length) return text('No templates match. Widen the search, or list another scope.')
  return text(
    lines([
      `${page.templates.length} template(s):`,
      ...page.templates.map((t) => `- ${templateLine(t)}`),
      moreLine(page.nextCursor),
      'Place one with an insert_template op in update_timeline or update_canvas; get_template reads its code and controls.',
    ]),
  )
}

/** One template whole, or a write's confirmation with what the checks warned about. */
export function templateResult(t: Template, verb?: string, warnings: string[] = []): CallToolResult {
  const warned = warnings.length ? ['Warnings (it was saved anyway):', ...warnings.map((w) => `- ${w}`)] : []
  if (verb) {
    return text(
      lines([
        `${verb} template "${t.name}" (id ${t.id}), version ${t.version}.`,
        ...warned,
        `Place it with { op: 'insert_template', templateId: "${t.id}" } in update_timeline or update_canvas.`,
      ]),
    )
  }
  return text(
    lines([
      templateLine(t),
      `${t.durationFrames} frames${t.resize === 'scale' ? ', keeps its proportions in any box' : ', lays out again in the box it is given'}`,
      t.description ? `description: ${t.description}` : null,
      t.tags?.length ? `tags: ${t.tags.join(', ')}` : null,
      t.sourceTemplateId ? `saved from template ${t.sourceTemplateId}, version ${t.sourceTemplateVersion}` : null,
      `props: ${JSON.stringify(t.props)}`,
      t.propsSchema ? `controls: ${JSON.stringify(t.propsSchema)}` : null,
      t.skeleton?.shape ? `shape: ${t.skeleton.shape}` : null,
      t.skeleton?.emoji ? `emoji: ${t.skeleton.emoji}` : null,
      t.thumbnailUrl ? `preview: ${t.thumbnailUrl}` : null,
      t.code ? `code:\n\`\`\`tsx\n${t.code}\n\`\`\`` : null,
    ]),
  )
}

/** Confirmation that a template was deleted. */
export function templateDeletedResult(id: string): CallToolResult {
  return text(`Deleted template ${id}. Clips placed from it keep everything.`)
}

// -- models (discovery catalog) -----------------------------------------------

/** Read a possibly-absent capability field from the loosely-typed bag. */
function cap(m: ModelInfo, key: string): any {
  return (m.capabilities as Record<string, unknown>)[key]
}

/** Human duration spec, e.g. "5s|10s", "4-12s", "8s", or null when not applicable. */
function durationSummary(d: any): string | null {
  if (!d || d.mode === 'none') return null
  if (d.mode === 'locked') return `${d.value}s`
  if (d.mode === 'discrete') return Array.isArray(d.options) ? `${d.options.join('s|')}s` : null
  if (d.mode === 'range') return `${d.min}-${d.max}s`
  return null
}

/** Compact, decision-relevant capability summary for the list view. */
function capabilitySummary(m: ModelInfo): string {
  const parts: string[] = []
  const inputs = cap(m, 'inputTypes')
  if (Array.isArray(inputs) && inputs.length) parts.push(`inputs:${inputs.join('+')}`)
  const dur = durationSummary(cap(m, 'duration'))
  if (dur) parts.push(`dur:${dur}`)
  const res = cap(m, 'resolution')?.supported
  if (Array.isArray(res) && res.length) parts.push(`res:${res.join('/')}`)
  const ar = cap(m, 'aspectRatio')?.supported
  if (Array.isArray(ar) && ar.length) parts.push(`ar:${ar.join('/')}`)
  if (cap(m, 'audio')?.supported) parts.push('audio')
  const refMax = Math.max(
    cap(m, 'maxImageRefs') ?? 0,
    cap(m, 'maxVideoRefs') ?? 0,
    cap(m, 'maxAudioRefs') ?? 0,
  )
  if (refMax > 0) parts.push(`refs:≤${refMax}`)
  return parts.join(' | ')
}

/** List of models in the discovery catalog. */
export function modelListResult(models: ModelInfo[]): CallToolResult {
  if (!models.length) return text('No models found.')
  const rows = models.map((m) => {
    const summary = capabilitySummary(m)
    const def = m.isDefault ? ' [default]' : ''
    return `- [${m.contentType}] ${m.modelId} (${m.displayName})${def} | ${m.kind}${summary ? ` | ${summary}` : ''}`
  })
  return text(
    [
      `${models.length} model(s). Call get_model(modelId) for the full request shape before generating:`,
      ...rows,
    ].join('\n'),
  )
}

/** One model's full request shape (the grounding view). */
export function modelResult(m: ModelInfo): CallToolResult {
  const res = cap(m, 'resolution')
  const ar = cap(m, 'aspectRatio')
  const dur = cap(m, 'duration')
  const gen = cap(m, 'generations')
  const audio = cap(m, 'audio')
  const features = cap(m, 'features') as Record<string, boolean> | undefined
  const enabledFeatures = features ? Object.keys(features).filter((k) => features[k]) : []
  const refLines = [
    cap(m, 'maxImageRefs') ? `image refs: up to ${cap(m, 'maxImageRefs')}` : null,
    cap(m, 'maxVideoRefs') ? `video refs: up to ${cap(m, 'maxVideoRefs')}` : null,
    cap(m, 'maxAudioRefs') ? `audio refs: up to ${cap(m, 'maxAudioRefs')}` : null,
  ].filter(Boolean) as string[]

  return text(
    lines([
      `${m.modelId} (${m.displayName})${m.isDefault ? ' [default]' : ''}`,
      `type: ${m.contentType} | operation: ${m.kind}`,
      m.description ? `description: ${m.description}` : null,
      m.tags.length ? `tags: ${m.tags.join(', ')}` : null,
      '',
      'Request shape:',
      `  prompt: ${cap(m, 'promptMode') ?? 'optional'}${cap(m, 'promptMaxChars') ? ` (max ${cap(m, 'promptMaxChars')} chars)` : ''}`,
      cap(m, 'promptGuide') ? `  writing the prompt: ${cap(m, 'promptGuide')}` : null,
      Array.isArray(cap(m, 'inputTypes')) && cap(m, 'inputTypes').length
        ? `  input types: ${cap(m, 'inputTypes').join(', ')}`
        : null,
      res?.supported?.length
        ? `  resolution: ${res.supported.join(', ')}${res.default ? ` (default ${res.default})` : ''}`
        : null,
      ar?.supported?.length
        ? `  aspect ratio: ${ar.supported.join(', ')}${ar.default ? ` (default ${ar.default})` : ''}`
        : null,
      durationSummary(dur) ? `  duration: ${durationSummary(dur)}${dur?.default ? ` (default ${dur.default}s)` : ''}` : null,
      audio?.supported ? `  audio: supported${audio.alwaysOn ? ' (always on)' : ''}` : null,
      cap(m, 'negativePrompt') ? '  negativePrompt: supported' : null,
      gen ? `  generations: ${gen.min}-${gen.max} (default ${gen.default})` : null,
      ...refLines.map((l) => `  ${l}`),
      enabledFeatures.length ? `  features: ${enabledFeatures.join(', ')}` : null,
      ...promptReferenceLines(m.promptReferences),
      ...(m.boardTypes?.length
        ? ['', 'Board types (generate_board boardType):', ...m.boardTypes.map((t) => `  ${t.boardType}: ${t.summary}`)]
        : []),
      '',
      "Build the request within this shape, preview cost with the matching generate tool's getCost option, then run it.",
    ]),
  )
}

export function platformListResult(platforms: PlatformSummary[]): CallToolResult {
  if (!platforms.length) return text('No publish platforms found.')
  const rows = platforms.map((p) => {
    const fmts = p.formats.map((f) => f.value).join(', ')
    return `- ${p.platform} (${p.name})${p.connected ? ' [connected]' : ''} | formats: ${fmts || 'post'}`
  })
  return text(
    [
      `${platforms.length} publish platform(s). Call get_schema (kind 'platform', with the platform and optionally a format) for the exact fields, options, and limits a post requires:`,
      ...rows,
    ].join('\n'),
  )
}

export function platformResult(p: PlatformSchema): CallToolResult {
  const fmtBlocks = p.formats.map((fmt) => {
    const fields = Object.keys(p.fieldTemplatesByFormat[fmt] ?? {})
    return `  ${fmt}: ${fields.length ? fields.join(', ') : '(no fields)'}`
  })
  const enumLines = Object.entries(p.enums).map(([k, vals]) => {
    const rendered = vals
      .map((v) => (v && typeof v === 'object' && 'id' in (v as Record<string, unknown>) ? String((v as Record<string, unknown>).id) : String(v)))
      .join(', ')
    return `  ${k}: ${rendered}`
  })
  const limitLines = p.characterLimits
    ? Object.entries(p.characterLimits).map(([k, n]) => `  ${k}: ${n}`)
    : []
  return text(
    lines([
      `${p.platform} (${p.name})`,
      `formats: ${p.formats.join(', ')}`,
      `posting modes: ${p.postingModes.join(', ')}`,
      '',
      'Fields by format (set these as platformSettings on a post in update_card):',
      ...fmtBlocks,
      enumLines.length ? '' : null,
      enumLines.length ? 'Allowed option values:' : null,
      ...enumLines,
      limitLines.length ? '' : null,
      limitLines.length ? 'Character limits:' : null,
      ...limitLines,
      '',
      'Fill platformSettings to this shape, then attach it as a post with update_card.',
    ]),
  )
}

/** Render the reference-addressing guidance (how to tag references in the prompt). */
function promptReferenceLines(pr: ModelInfo['promptReferences']): Array<string | null> {
  if (!pr || pr.scheme === 'none') return []
  const tokens = pr.inputs
    .filter((i) => i.token)
    .map((i) => `${i.token}${i.max > 1 ? ` (up to ${i.max})` : ''}`)
    .join(', ')
  return [
    '',
    `Referencing (${pr.scheme}${pr.honored ? ', bound' : ', positional'}):`,
    `  ${pr.instruction}`,
    tokens ? `  tokens: ${tokens}` : null,
  ]
}

// -- posts (content pipeline) -------------------------------------------------

/** One line summarizing a post. */
function cardLine(p: CardSummary): string {
  const where = p.platforms.length ? p.platforms.join('+') : (p.platform ?? 'general')
  const when = p.publishedAt
    ? ` | published ${p.publishedAt}`
    : p.scheduledAt
      ? ` | scheduled ${p.scheduledAt}`
      : ''
  // `[archived]` rather than a status. The list excludes archived cards unless asked for, so when one
  // appears here the agent asked for it and the flag confirms the filter did what it said.
  return `- ${p.title || '(untitled)'} (${idOf(p)})${p.isArchived ? ' [archived]' : ''} | ${where}${when}`
}

/** List of posts with pagination context. */
export function cardListResult(result: CardListResult): CallToolResult {
  /**
   * ⭐⭐⭐ NAME THE SCOPE, INCLUDING WHEN THE LIST IS EMPTY.
   *
   * This read covers ONE space and falls back to the default when none is named, so "No cards found" and
   * "9 card(s)" are both answers about a board the caller may not have meant. Measured 2026-09-14: a call
   * passing `space_id`, where the tool declares `spaceId`, had the key dropped, listed the default space,
   * and read as proof that the tool ignored its filters.
   *
   * ⚠️ THE EMPTY CASE IS THE ONE THAT MATTERS MOST. A wrong-scope list of cards at least looks unfamiliar;
   * a wrong-scope EMPTY list looks like the thing you asked for does not exist.
   */
  // A list across every space (spaceId 'all') has no one space, and says so.
  const where = result.space ? ` in ${result.space.name}` : ' in every space'
  if (!result.cards.length) return text(`No cards found${where}.`)
  const more = result.nextCursor ? ` (showing ${result.cards.length} of ${result.total})` : ''
  return text(lines([`${result.total} card(s)${where}${more}:`, ...result.cards.map(cardLine), moreLine(result.nextCursor)]))
}

/**
 * A single post summary line (create / update / schedule / archive results).
 *
 * ⚠️ THIS USED TO PRINT `p.status`, AND A CARD NO LONGER HAS ONE. The field was almost always `draft`
 * regardless of the card's real state, so it told the agent nothing while looking like it did. What it
 * prints now is what is true: where the card sits, when it publishes, and whether it is archived.
 *
 * ⭐ ARCHIVE IS SHOWN ONLY WHEN TRUE. A live card saying "not archived" is noise on every line, and
 * `spaceListResult` below already made this call for spaces.
 */
export function postSummaryResult(p: CardSummary, prefix = 'Post'): CallToolResult {
  const stage = p.stageId ? ` | stage ${p.stageId}` : ''
  // The schedule is surfaced here because scheduling is now part of update_card rather than its own tool.
  // Without it a caller who just set a publish time gets no confirmation of what time was actually stored.
  const scheduled = p.scheduledAt ? ` | Scheduled: ${p.scheduledAt}` : ''
  const archived = p.isArchived ? ' | ARCHIVED' : ''
  return text(`${prefix}: ${p.title || '(untitled)'} (${idOf(p)})${stage}${scheduled}${archived}`)
}

/** One card in full, with its posts and assets. */
export function cardResult(p: CardDetail): CallToolResult {
  return text(
    lines([
      `${p.title || '(untitled)'} (${idOf(p)}) | platform: ${p.platform ?? 'general'}`,
      p.stageId ? `stage: ${p.stageId}` : null,
      // Stated only when archived, and it says WHEN, because "archived" with no date is half a fact.
      p.archivedAt ? `archived: ${p.archivedAt}` : null,
      p.scheduledAt ? `scheduled: ${p.scheduledAt}` : null,
      p.publishedAt ? `published: ${p.publishedAt}` : null,
      p.publishUrl ? `publish url: ${p.publishUrl}` : null,
      p.notes ? `notes: ${p.notes}` : null,
      /**
       * ⭐⭐⭐ **PRINTED UNCONDITIONALLY, INCLUDING AT 0, BECAUSE IT IS AN INPUT TO THE NEXT CALL.**
       *
       * Every other line here is omitted when empty, which is right for a fact the agent merely reads.
       * This one is a TOKEN the agent has to hand back: `update_card` refuses a `notes` write that does
       * not carry the revision it read. Hiding it at 0 would make a never-edited card the single case
       * where the agent has nothing to send, and 0 is a real revision, not an absence.
       */
      `revision: ${p.revision} (pass as expectedRevision to write notes)`,
      p.tags?.length ? `tags: ${p.tags.join(', ')}` : null,
      `posts (${p.posts.length}):`,
      ...p.posts.map((d) => {
        const set = settingsKeys(d.platformSettings)
        return `  - ${d.platform} (${idOf(d)})${d.format ? ` ${d.format}` : ''} | ${d.status ?? 'draft'}${d.connectedAccountId ? ` | account ${d.connectedAccountId}` : ' | no connected account'}${set ? ` | settings: ${set}` : ''}`
      }),
      `assets (${p.assets.length}):`,
      ...p.assets.map((a) => {
        /**
         * ⭐ AN INSPIRATION ATTACHMENT'S `assetId` IS THE TRACKED-CONTENT ID, AND IT IS PRINTED BECAUSE IT
         * IS AN INPUT TO THE NEXT CALL, same rule as `revision` above. It is exactly what `get_content`
         * takes to return the full record and its transcript; without it the agent could see the
         * attachment but never follow it. The triage line (creator, score, views, availability) is
         * printed so ranking ten links costs zero extra calls.
         */
        const insp = a.inspiration
        const triage = insp
          ? [
              insp.creator ?? insp.handle,
              insp.outlierScore != null ? `${Number(insp.outlierScore).toFixed(1)}x` : null,
              insp.viewCount != null ? `${compactNum(insp.viewCount)} views` : null,
              insp.likeCount != null ? `${compactNum(insp.likeCount)} likes` : null,
              insp.durationSeconds != null ? `${insp.durationSeconds}s` : null,
              insp.publishedAt ? insp.publishedAt.slice(0, 10) : null,
              [insp.hasTranscript ? 'transcript' : null, insp.hasBreakdown ? 'breakdown' : null]
                .filter(Boolean)
                .join('+') || 'no transcript',
            ]
              .filter(Boolean)
              .map((v) => ` | ${v}`)
              .join('')
          : ''
        // A linked project prints its id for the same reason: it is what get_project takes. It has no url, so none
        // is printed.
        const ref = a.contentId
          ? ` | content ${a.contentId} (pass to get_content)`
          : a.projectId
            ? ` | project ${a.projectId} (pass to get_project)`
            : ''
        const head = [a.displayName, a.projectId ? null : (a.assetUrl ?? '(no url)')].filter(Boolean).join(' | ')
        return `  - [${a.assetType ?? '?'}] ${head || '(untitled)'}${triage}${ref} (${idOf(a)})`
      }),
    ]),
  )
}

/** List of stages (the agent resolves a stage from here before placing a post). */
/**
 * The account's spaces.
 *
 * The card count is stated on every row because "which board has work on it" is the question an agent
 * asks next, and making it call get_space per row to find out is the N+1 the API already avoids.
 */
export function spaceListResult({ spaces, nextCursor }: SpaceListResult): CallToolResult {
  if (!spaces.length) return text('No spaces found.')
  const rows = spaces.map((s) => {
    const bits = [idOf(s), `${s.cardCount ?? 0} card(s)`]
    if (s.isFavorite) bits.push('favorite')
    if (s.archivedAt) bits.push('ARCHIVED')
    return `- ${s.name} (${bits.join(', ')})`
  })
  return text(lines([`${spaces.length} space(s):`, ...rows, moreLine(nextCursor)]))
}

/** A deleted space. */
export function spaceDeletedResult(id: string): CallToolResult {
  return text(`Deleted space ${id}. Its stages went with it; the space had to be empty of cards.`)
}

/** One space. */
export function spaceResult(s: Space): CallToolResult {
  const lines = [
    `${s.name} (${idOf(s)})`,
    `Cards: ${s.cardCount ?? 0}`,
    `Favorite: ${s.isFavorite ? 'yes' : 'no'}`,
    s.archivedAt ? `Archived: ${s.archivedAt}` : 'Archived: no',
    s.coverUrl ? `Cover: ${s.coverUrl}` : 'Cover: none',
    `Updated: ${s.updatedAt}`,
  ]
  return text(lines.join('\n'))
}

export function stageListResult(result: StageListResult): CallToolResult {
  /**
   * ⭐⭐⭐ NAME THE SCOPE, EMPTY CASE INCLUDED, matching `cardListResult` word for word.
   *
   * Stages are per-space and this read falls back to the default space when none is named, so a list of
   * unfamiliar column names and "No stages found." are both answers about a board the caller may not have
   * meant. The old signature took a bare `Stage[]` and had nothing to say it with.
   */
  const where = result.space ? ` in ${result.space.name}` : ''
  if (!result.stages.length) return text(`No stages found${where}.`)
  const rows = result.stages.map((s) => `- ${s.name} (${idOf(s)}${s.slug ? `, slug ${s.slug}` : ''})`)
  return text(lines([`${result.stages.length} stage(s)${where} (in order):`, ...rows, moreLine(result.nextCursor)]))
}

/** One created or updated stage. No position: the board's order is the order `list_stages` returns. */
export function stageResult(s: Stage): CallToolResult {
  const lines = [
    `Stage ${s.name} (${idOf(s)})`,
    s.slug ? `Slug: ${s.slug}` : null,
    s.color ? `Color: ${s.color}` : null,
  ].filter(Boolean) as string[]
  return text(lines.join('\n'))
}

/** A deleted stage, and the board that is left. */
export function stageDeletedResult(id: string, movedCards: number, stages: Stage[]): CallToolResult {
  const moved =
    movedCards > 0
      ? `${movedCards} ${movedCards === 1 ? 'card' : 'cards'} moved to the target stage.`
      : 'It held no cards.'
  const rows = stages.map((s) => `- ${s.name} (${idOf(s)})`)
  return text([`Deleted stage ${id}. ${moved}`, '', `${stages.length} stage(s) remaining:`, ...rows].join('\n'))
}

/** The non-empty keys of a post's platformSettings, for a compact summary. */
function settingsKeys(settings: Record<string, unknown> | null | undefined): string | null {
  if (!settings) return null
  const keys = Object.keys(settings).filter((k) => {
    const v = settings[k]
    if (v == null) return false
    if (Array.isArray(v)) return v.length > 0
    if (typeof v === 'string') return v.length > 0
    return true
  })
  return keys.length ? keys.join(', ') : null
}

/** A created or updated post. */
export function postResult(d: Post): CallToolResult {
  const set = settingsKeys(d.platformSettings)
  return text(
    `Post: ${d.platform} (${idOf(d)})${d.format ? ` ${d.format}` : ''} | ${d.status ?? 'draft'}${d.connectedAccountId ? ` | account ${d.connectedAccountId}` : ' | no connected account (set one before publishing)'}${set ? ` | settings: ${set}` : ' | no settings (set platformSettings to make it publishable)'}.`,
  )
}

/** An attached asset. */
export function assetResult(a: CardAsset): CallToolResult {
  return text(`Asset attached: [${a.assetType ?? '?'}] ${a.assetUrl ?? '(no url)'} (${idOf(a)}).`)
}

/** A post's assets in their (new) order. */
export function assetOrderResult(assets: CardAsset[]): CallToolResult {
  if (!assets.length) return text('No assets on this post.')
  return text(
    [
      `Assets reordered (${assets.length}):`,
      ...assets.map((a, i) => `  ${i + 1}. [${a.assetType ?? '?'}] ${a.assetUrl ?? '(no url)'} (${idOf(a)})`),
    ].join('\n'),
  )
}

/** Confirmation of a detached asset. */
export function assetRemovedResult(r: { id: string }): CallToolResult {
  return text(`Asset removed (${idOf(r)}).`)
}

/** Confirmation of a detached post. */
export function postRemovedResult(r: { id: string }): CallToolResult {
  return text(`Post removed (${idOf(r)}).`)
}

/** The account's tags. */
export function tagListResult({ tags, nextCursor }: TagListResult): CallToolResult {
  if (!tags.length) return text('No tags yet. Create one with create_tag.')
  return text(lines([`${tags.length} tag(s):`, ...tags.map((t) => `- ${t.name} (${idOf(t)})`), moreLine(nextCursor)]))
}

/** A created or renamed tag. */
export function tagResult(t: Tag, verb = 'Tag'): CallToolResult {
  return text(`${verb}: ${t.name} (${idOf(t)}).`)
}

/** Confirmation of a deleted tag. */
export function tagDeletedResult(r: { id: string }): CallToolResult {
  return text(`Tag deleted (${idOf(r)}). It was removed from all posts.`)
}

/** The result of publishing a card's posts (one outcome per post). */
export function publishResult(r: PublishResult): CallToolResult {
  if (!r.results.length) {
    return text('Nothing to publish: this card has no posts. Add one with update_card first.', true)
  }
  const rows = r.results.map((d) =>
    d.success
      ? `- ${d.platform}: published${d.url ? ` | ${d.url}` : ''}`
      : `- ${d.platform}: FAILED | ${d.error ?? 'unknown error'}`,
  )
  const header = `Published ${r.publishedCount}/${r.results.length} post(s)${r.failedCount ? `, ${r.failedCount} failed` : ''}:`
  return text([header, ...rows].join('\n'), r.publishedCount === 0)
}

// -- inspiration / research ---------------------------------------------------

/** Compact integer formatting (1.2M, 45.3K) for engagement counts. */
function compactNum(n: number | null): string {
  if (n == null) return '?'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

/** One line summarizing a tracked account. */
function accountLine(a: TrackedAccount): string {
  const handle = a.handle ? `@${a.handle}` : (a.name ?? '(unnamed)')
  // The kind is on every line because the list is MIXED by default: without it a reader cannot tell the
  // owner's own profile from a competitor they watch, and those mean opposite things.
  const kind = a.accountType === 'brand' ? ' [yours]' : a.accountType === 'inspiration' ? ' [watching]' : ''
  return `- ${handle} (${idOf(a)})${kind} | ${a.platform ?? '?'} | ${compactNum(a.followerCount)} followers`
}

/** List of tracked accounts, either kind. */
export function trackedAccountListResult({ trackedAccounts: accounts, nextCursor }: TrackedAccountListResult): CallToolResult {
  if (!accounts.length) return text('No tracked account(s) found. Add one in the ContentHero app first.')
  return text(lines([`${accounts.length} tracked account(s):`, ...accounts.map(accountLine), moreLine(nextCursor)]))
}

/** One line summarizing an outlier / content item. */
function outlierLine(o: ContentSummary): string {
  const score = o.outlierScore != null ? `${o.outlierScore.toFixed(1)}x` : 'n/a'
  const creator = o.sourceCreator || (o.accountHandle ? `@${o.accountHandle}` : '')
  // One list spans the owner's posts and the creators they watch, so each line has to say which it is.
  const own = o.isOwn ? ' [yours]' : ''
  return `- [${score}] ${o.title ?? '(untitled)'}${own}${creator ? ` | ${creator}` : ''} | ${compactNum(o.viewCount)} views (${idOf(o)})`
}

/** A page of tracked content, in the order it was asked for. */
export function outlierListResult(result: ContentListResult): CallToolResult {
  if (!result.content.length) {
    return text('No content found. Track some creators in the ContentHero app, or widen the filters.')
  }
  const more = result.nextCursor ? ` (showing ${result.content.length} of ${result.total})` : ''
  return text(lines([`${result.total} post(s)${more}:`, ...result.content.map(outlierLine), moreLine(result.nextCursor)]))
}

/**
 * One tracked account with its performance.
 *
 * Merged from two formatters that printed the same account from the same table and differed only in how
 * much they showed: the inspiration one omitted totals, averages and recent content for no reason other
 * than which function you happened to call.
 */
export function trackedAccountDetailResult(d: TrackedAccountDetail): CallToolResult {
  const a = d.account
  const handle = a.handle ? `@${a.handle}` : (a.name ?? '(unnamed)')
  const kind = a.accountType === 'brand' ? ' [yours]' : a.accountType === 'inspiration' ? ' [watching]' : ''
  const avgEng = d.averages.engagementRate != null ? `${(d.averages.engagementRate * 100).toFixed(1)}%` : 'n/a'
  const avgScore = d.averages.outlierScore != null ? `${d.averages.outlierScore.toFixed(2)}x` : 'n/a'
  return text(
    lines([
      `${handle} (${idOf(a)})${kind} | ${a.platform ?? '?'} | ${compactNum(a.followerCount)} followers`,
      `content tracked: ${d.contentCount}`,
      `totals: ${compactNum(d.totals.views)} views, ${compactNum(d.totals.likes)} likes, ${compactNum(d.totals.comments)} comments`,
      `averages: ${compactNum(d.averages.views)} views/post, ${avgEng} engagement, ${avgScore} outlier score`,
      d.topContent.length ? 'top content by outlier score:' : 'top content: none yet',
      ...d.topContent.map(outlierLine),
      d.recentContent.length ? 'most recent:' : null,
      ...d.recentContent.map(outlierLine),
    ]),
  )
}

/** The transcript block, at whatever grain was asked for. */
function transcriptLines(t: NonNullable<ContentDetail['transcript']>): string[] {
  // The status is printed even when there is text, because 'failed' and 'absent' are the difference between
  // "there is nothing to read" and "ask again later", and a reader cannot infer that from an empty body.
  const head = `transcript [${t.status}]${t.language ? ` (${t.language})` : ''}${t.windowed ? ' (windowed)' : ''}:`
  if (t.segments) {
    if (!t.segments.length) {
      return [head, t.windowed ? '  (no segments in that window)' : '  (none stored)']
    }
    return [head, ...t.segments.map((sg) => `  [${(sg.startMs / 1000).toFixed(1)}s] ${sg.text}`)]
  }
  return [head, t.text ? t.text : '  (none stored)']
}

/** One tracked post in full, with its transcript when it was asked for. */
export function inspirationContentResult(c: ContentDetail, frames: InlinedImageSlot[] = []): CallToolResult {
  const stats = `${compactNum(c.viewCount)} views, ${compactNum(c.likeCount)} likes, ${compactNum(c.commentCount)} comments`
  const score = c.outlierScore != null ? `${c.outlierScore.toFixed(1)}x outlier` : null
  const body = text(
    lines([
      `${c.title ?? '(untitled)'} (${idOf(c)})${c.isOwn ? ' [yours]' : ''}`,
      `${c.platform ?? '?'} ${c.contentType ?? ''} | ${c.sourceCreator ?? c.accountHandle ?? ''}`.trim(),
      `${stats}${score ? ` | ${score}` : ''}`,
      c.url ? `url: ${c.url}` : null,
      c.publishedAt ? `published: ${c.publishedAt}` : null,
      c.hashtags.length ? `hashtags: ${c.hashtags.join(' ')}` : null,
      c.description ? `description: ${c.description}` : null,
      ...(c.transcript ? transcriptLines(c.transcript) : []),
      ...analysisLines(c.analysis),
      ...scenesLines(c.scenes, frames),
    ]),
  )
  // Each shown frame follows its label, so the picture and the scene it belongs to cannot be mismatched.
  const detail = c.scenes?.status === 'complete' ? c.scenes.detail : undefined
  frames.forEach((slot, i) => {
    const scene = detail?.scenes[i]
    if (!slot?.image || !scene) return
    body.content.push({ type: 'text', text: `scene ${scene.index + 1} frame (${seconds(scene.startMs)} to ${seconds(scene.endMs)}):` })
    body.content.push({ type: 'image', data: slot.image.data, mimeType: slot.image.mimeType })
  })
  return body
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`
}

/**
 * The scenes availability line, always, and the scene map when it was asked for. A frame that was shown says so; one
 * that did not fit this result is given as its link, with the reason, so nothing is silently missing.
 */
function scenesLines(scenes: ContentDetail['scenes'], frames: InlinedImageSlot[]): Array<string | null> {
  if (!scenes) return []
  if (scenes.status === 'running') return ['scenes: running (call analyze_content with kind scenes again for the result)']
  if (scenes.status === 'failed') return [`scenes: failed (${scenes.error}); analyze_content with kind scenes tries them again`]
  if (scenes.status === 'unavailable') return [`scenes: unavailable (${scenes.reason})`]
  if (scenes.status !== 'complete') return ['scenes: absent (analyze_content with kind scenes prepares them)']
  const detail = scenes.detail
  if (!detail) return [`scenes: complete (${scenes.sceneCount}; pass scenes='map' or 'frames' to read them)`]
  const out: Array<string | null> = [
    `scenes: complete (${scenes.sceneCount}${detail.windowed ? `, ${detail.scenes.length} in this window` : ''})`,
    detail.summary ? `scenes.summary: ${detail.summary}` : null,
    detail.timedTranscript ? null : 'scenes.said: this post has no timed transcript, so what is said in each scene is unknown',
  ]
  detail.scenes.forEach((sc, i) => {
    const slot = frames[i]
    const frame = slot?.image
      ? 'frame: shown below'
      : sc.frameUrl
        ? `frame: ${sc.frameUrl}${slot?.skipped ? ` (not shown: ${slot.skipped})` : ''}`
        : 'frame: none'
    const said = sc.said === null ? null : `said: ${sc.said ? JSON.stringify(sc.said) : '(nothing)'}`
    out.push(`scene ${sc.index + 1} [${seconds(sc.startMs)} to ${seconds(sc.endMs)}] ${sc.description}${said ? ` | ${said}` : ''} | ${frame}`)
  })
  return out
}

/**
 * The Break It Down availability line, always, and the requested sections when present. The section
 * names are printed because they are the vocabulary `analysisSections` accepts; hiding them would
 * make the surgical pull undiscoverable.
 */
function analysisLines(analysis: ContentDetail['analysis']): Array<string | null> {
  if (analysis?.status === 'running') return ['analysis: running (call analyze_content again for the result)']
  if (analysis?.status === 'failed') {
    return [`analysis: failed (${analysis.error ?? 'no reason recorded'}); analyze_content tries it again`]
  }
  if (!analysis || analysis.status !== 'complete') {
    return ['analysis: absent (analyze_content creates one)']
  }
  const provenance = [analysis.model, analysis.analyzedAt?.slice(0, 10)].filter(Boolean).join(', ')
  const head = `analysis: complete${provenance ? ` (${provenance})` : ''}${
    analysis.sections?.length ? ` | sections: ${analysis.sections.join(', ')}` : ''
  }`
  const body = analysis.data
    ? Object.entries(analysis.data).map(
        ([section, value]) => `analysis.${section}:\n${JSON.stringify(value, null, 1)}`,
      )
    : []
  return [head, ...body]
}

/** analyze_content's price check: nothing ran and nothing was charged. */
export function analysisCostResult(est: CostEstimate, kind: ContentAnalysisKind = 'breakdown'): CallToolResult {
  const credits = `${est.creditsEstimate} credit${est.creditsEstimate === 1 ? '' : 's'}`
  if (kind === 'scenes') {
    return text(
      est.creditsEstimate === 0
        ? 'This post already has its scenes: viewing them costs 0 credits. Nothing ran and nothing was charged.'
        : `Preparing this post's scenes costs ${credits} (priced per started minute of video). Nothing ran and nothing was charged.`,
    )
  }
  return text(
    est.creditsEstimate === 0
      ? 'This post already has an analysis: viewing it costs 0 credits. Nothing ran and nothing was charged.'
      : `Analyzing this post costs ${credits}. Nothing ran and nothing was charged.`,
  )
}

/** analyze_content's answer for kind scenes: ready (and how to read them), or still being prepared. */
export function contentScenesResult(r: ContentScenesResult): CallToolResult {
  const running = r.scenes.status === 'running'
  const body = running
    ? "scenes: pending, still being prepared (call analyze_content again for the result)"
    : r.scenes.status === 'complete'
      ? `${r.scenes.sceneCount} scene${r.scenes.sceneCount === 1 ? '' : 's'} ready. Read them with get_content scenes='map', or scenes='frames' to see them.`
      : `scenes: ${r.scenes.status}`
  return {
    content: [{ type: 'text', text: lines([`Scenes for post ${r.contentId}`, body, chargeLine(r.charge)]) }],
    structuredContent: { contentId: r.contentId, status: running ? 'pending' : r.scenes.status, ...chargeData(r.charge) },
  }
}

/** analyze_content's answer: the post's analysis with every section, or that it is still running. */
export function contentAnalysisResult(r: ContentAnalysisResult): CallToolResult {
  // "pending" is the word the tool's description uses for a run still going.
  const body =
    r.analysis.status === 'running'
      ? ['analysis: pending, still running (call analyze_content again for the result)']
      : analysisLines(r.analysis)
  return {
    content: [{ type: 'text', text: lines([`Break It Down for post ${r.contentId}`, ...body, chargeLine(r.charge)]) }],
    structuredContent: {
      contentId: r.contentId,
      status: r.analysis.status === 'running' ? 'pending' : r.analysis.status,
      ...chargeData(r.charge),
    },
  }
}

/** One line summarizing a connected account (a publish target). */
function connectedAccountLine(a: ConnectedAccount): string {
  const handle = a.accountHandle ? `@${a.accountHandle}` : (a.accountName ?? '(unnamed)')
  const status = a.connectionStatus ? ` | ${a.connectionStatus}` : ''
  return `- ${handle} (${idOf(a)}) | ${a.platform ?? '?'}${a.isDefault ? ' [default]' : ''}${status}`
}

/** List of connected accounts (publish targets). */
export function connectedAccountListResult({ connectedAccounts: accounts, nextCursor }: ConnectedAccountListResult): CallToolResult {
  if (!accounts.length) {
    return text('No connected accounts. Connect a social account in the ContentHero app to publish.')
  }
  return text(lines([`${accounts.length} connected account(s):`, ...accounts.map(connectedAccountLine), moreLine(nextCursor)]))
}

/** One connected account in detail, including its capabilities. */
export function connectedAccountResult(a: ConnectedAccount): CallToolResult {
  const handle = a.accountHandle ? `@${a.accountHandle}` : (a.accountName ?? '(unnamed)')
  const caps = a.capabilities ? Object.keys(a.capabilities).filter((k) => (a.capabilities as Record<string, unknown>)[k]) : []
  return text(
    lines([
      `${handle} (${idOf(a)}) | ${a.platform ?? '?'}${a.isDefault ? ' [default]' : ''}`,
      `status: ${a.connectionStatus ?? 'unknown'}${a.connectionType ? ` (${a.connectionType})` : ''}`,
      a.accountUrl ? `url: ${a.accountUrl}` : null,
      caps.length ? `capabilities: ${caps.join(', ')}` : null,
      a.lastValidatedAt ? `last validated: ${a.lastValidatedAt}` : null,
      `Use this id as connectedAccountId on a post in update_card to publish here.`,
    ]),
  )
}

/** Map any thrown error onto a readable isError result. */
export function errorResult(err: unknown): CallToolResult {
  // A limit (credits, the spend cap, storage, a plan limit): the message is written for the person, so it is relayed
  // as is, with the ways out in the order to offer them. Nothing ran and nothing was charged.
  if (err instanceof LimitError) return text(describeLimit(err), true)
  if (err instanceof RateLimitError) {
    const wait = err.retryAfter != null ? ` Retry in ${err.retryAfter}s.` : ''
    return text(`Rate limit exceeded.${wait || ' Wait a moment before retrying.'}`, true)
  }
  // Temporary, and nothing about the call or the key was wrong: say so, so the agent retries instead of reporting a
  // bad key (what a 401 during the 2026-10-04 database outage made agents do).
  if (err instanceof ServiceUnavailableError) {
    const wait = err.retryAfter != null ? ` Retry in ${err.retryAfter}s.` : ' Retry the same call in a few seconds.'
    return text(`${err.message}${wait}`, true)
  }
  if (err instanceof ContentHeroError || err instanceof Error) {
    return text(err.message, true)
  }
  return text('Unknown error', true)
}

// -- editor / canvas ops ------------------------------------------------------

/**
 * The outcome of an applyEditorOps batch, in the SDK's wording (the CLI prints the same). A partial failure is an error
 * result, so the agent self-corrects.
 */
export function editorOpsResult(r: ApplyEditorOpsResult): CallToolResult {
  return text(describeEditorOps(r), r.results.some((x) => !x.ok))
}

/**
 * EXPOSURE GUARD for ProjectDetail.
 *
 * The MCP answers in TEXT, so a field this formatter does not print is INVISIBLE to the calling agent even
 * though the SDK fetched it. That makes silent drift the default: the app can add a field, the SDK type can
 * carry it, every build and test stays green, and no agent can ever see it. `compositionSpace` sat in
 * exactly that state, and the cost was an agent sizing every layer 2.26x wrong with no error.
 *
 * `satisfies Record<keyof ProjectDetail, ...>` makes the omission a DECISION rather than an accident: add a
 * field to ProjectDetail and this stops compiling until someone classifies it. Omitting is fine; omitting
 * silently is not.
 */
const PROJECT_DETAIL_EXPOSURE = {
  // Rendered in the summary line or the JSON body below.
  id: 'rendered',
  title: 'rendered',
  type: 'rendered',
  kind: 'omitted: deprecated alias of type, same value',
  // Added when `surface` joined ProjectDetail (8aecfd0). It went unnoticed because `dist/` is gitignored
  // and this file typechecks against the BUILT SDK, so a stale dist hid the missing key until the next
  // rebuild. Same value as `kind`, which is the name it used to have.
  surface: 'omitted: deprecated alias of type, same value',
  orientation: 'rendered',
  width: 'rendered',
  height: 'rendered',
  revision: 'rendered',
  compositionSpace: 'rendered',
  fps: 'rendered',
  groups: 'rendered',
  state: 'rendered',
  scope: 'rendered',
  brandKitId: 'rendered',
  appUrl: 'rendered',
  shortId: 'omitted: the appUrl carries it, and every tool accepts either id',
  // Deliberately omitted, with the reason. Each of these is reachable through a dedicated tool, or is
  // list-view metadata that tells a single-project reader nothing it did not already know by fetching it.
  assetReferences: 'omitted: large payload; the composition state already names what is in use',
  thumbnailUrl: 'omitted: presentation metadata, not an editing input',
  coverSource: 'omitted: presentation metadata, not an editing input',
  coverFrame: 'omitted: presentation metadata, not an editing input',
  isArchived: 'omitted: lifecycle state, surfaced by list_projects',
  isFavorited: 'omitted: lifecycle state, surfaced by list_projects',
  archivedAt: 'omitted: lifecycle state, surfaced by list_projects',
  favoritedAt: 'omitted: lifecycle state, surfaced by list_projects',
  createdAt: 'omitted: list metadata',
  updatedAt: 'omitted: superseded by revision, which is the token that actually matters here',
  exportedCardId: 'omitted: publishing workflow, owned by the card tools',
  exportedUrl: 'omitted: publishing workflow, owned by the post tools',
  shareUrl: 'rendered',
  shareId: 'omitted: shareUrl carries it',
} satisfies Record<keyof ProjectDetail, string>
void PROJECT_DETAIL_EXPOSURE

/** A single project's full detail (read-before-write): metadata, type, revision, and the state JSON. */
export function projectDetailResult(p: ProjectDetail): CallToolResult {
  return text(
    `Project ${p.id}${linkAfter(p.appUrl)}: "${p.title}" (${p.type}, ${p.orientation} ${p.width}x${p.height}), revision ${p.revision}.\n` +
      `Pass this revision back as expectedRevision when you edit.\n` +
      // A windowed read is part of the document. Said in words, because a full read of one beat looks exactly like a
      // full read of a short timeline, and writing it back as the whole would drop everything outside the window.
      (p.scope ? `${describeScope(p.scope)}\n` : '') +
      // The output resolution above is NOT the coordinate space layer geometry uses. Stating both, adjacent
      // and labeled, is the point: an agent that read only "2168x1152" sized every layer 2.26x too large
      // and got no error for it, because an oversized box is valid input.
      (p.compositionSpace
        ? `Layer geometry is in composition space ${p.compositionSpace.width}x${p.compositionSpace.height} ` +
          `(center-relative px), NOT the ${p.width}x${p.height} output resolution. ` +
          `Use ${p.compositionSpace.width}x${p.compositionSpace.height} as layerWidth/layerHeight for a full-frame layer.\n`
        : '') +
      // The rate every frame number in the timeline counts at (7.39; approved text 8).
      (p.fps ? `Frame rate: ${p.fps} fps. Every frame number in its timeline counts at this rate.\n` : '') +
      // An agent asked to keep a design on-brand otherwise has no way to know WHICH kit this project is
      // linked to: it can list kits, but not resolve the association.
      (p.brandKitId ? `Brand kit: ${p.brandKitId} (read it with get_brand_kit).\n` : '') +
      (describeProjectShareLink(p.shareUrl) ? `${describeProjectShareLink(p.shareUrl)}\n` : '') +
      (p.groups?.length
        ? `Groups: ${p.groups
            .map((g) => `${g.name || `Group ${g.ordinal ?? '?'}`} [${g.id}] (${g.memberClipIds.length} clips)`)
            .join('; ')}\n` +
          `  Rename with update_group; bulk-edit a whole group with update_clips { groupId }.\n`
        : '') +
      `\n` +
      JSON.stringify(p.state, null, 2),
  )
}

/**
 * Live context (get_context). Returns a text summary + the discriminated context JSON, plus IMAGE content
 * block(s) so the calling model can actually SEE: the viewport `snapshot` (capture) when the user's screen was
 * requested, and/or the inline composed-output render (`context.rendered.dataUrl`) when `render` was requested.
 * The heavy render data URL is stripped from the JSON text (it rides only as the image block).
 */
export function liveContextResult(
  result: LiveContextResult,
  snapshot: { data: string; mimeType: string } | null | undefined,
  /**
   * The result's inline allowance (`MAX_INLINE_BASE64_CHARS` in server.ts). A range is up to 24 frames, about 2 MB
   * of base64 at the default size, against a 1 MB ceiling for the WHOLE result, so a long range failed the call at
   * the host. The screen capture and the frames now spend this, in that order, and what does not fit is named.
   */
  budget: number,
): CallToolResult {
  const { context, participant, participants } = result
  const rendered = context && isPlainRecord(context.rendered) ? context.rendered : null
  /**
   * ⭐ A RENDER IS SHOWN WITH OR WITHOUT A LIVE TAB. Render works from the saved project, and the API returns it
   * with `participant: null` when no one is viewing. This returned "No live context" whenever the participant was
   * null, so a render requested with a projectId and no open tab could never reach the agent, image or error.
   */
  if (!context || (!participant && !rendered)) {
    return text(
      'No live context: no one is currently viewing this in the open app (no session within the presence window). ' +
        'The user may not have the editor/studio/content open right now.',
    )
  }
  // Pull the inline render out as image block(s). A still carries `rendered.dataUrl` (one image); a filmstrip /
  // clip carries `rendered.frames[].dataUrl` (many). Keep the light `rendered` metadata in the JSON but drop the
  // bulky dataUrl(s) so the text summary stays readable.
  const renderImages: Array<{ data: string; mimeType: string; frame?: unknown }> = []
  let contextForJson: unknown = context
  if (rendered) {
    const still = parseDataUrl(rendered.dataUrl)
    const frames = Array.isArray(rendered.frames) ? (rendered.frames as Array<Record<string, unknown>>) : null
    if (still) renderImages.push(still)
    if (frames) {
      for (const f of frames) {
        const img = parseDataUrl(f.dataUrl)
        if (img) renderImages.push({ ...img, frame: f.frame })
      }
    }
    if (renderImages.length > 0) {
      // Strip the base64 payloads from the JSON but keep the frame timing (frame / atSec).
      const strippedFrames = frames
        ? frames.map((f) => {
            const { dataUrl: _drop, ...rest } = f
            return rest
          })
        : undefined
      contextForJson = {
        ...context,
        rendered: {
          ...rendered,
          ...(still ? { dataUrl: '[attached as an image below]' } : {}),
          ...(strippedFrames ? { frames: strippedFrames } : {}),
        },
      }
    }
  }

  // The screen capture first, because it is what `capture` asked for; then the render, in order.
  const screen = admitWithinBudget(snapshot ? [snapshot] : [], budget)
  const shown = admitWithinBudget(renderImages, screen.remaining)

  const lines: string[] = []
  if (participant) {
    const others = participants.length > 1 ? ` (${participants.length} live participants; showing the most recent)` : ''
    lines.push(`Live context on the ${String(context.surface)} surface${others}, updated ${participant.updatedAt}.`)
  } else {
    lines.push('No one is viewing this in the open app right now; the render is from the saved project.')
  }
  if (screen.admitted.length > 0) lines.push('An image of what the user is looking at (their screen) is attached below.')
  if (screen.dropped > 0) lines.push("The screen capture was not attached: it is over this result's size limit.")
  if (shown.admitted.length === 1) lines.push('A render of your work is attached below.')
  if (shown.admitted.length > 1) lines.push(`${shown.admitted.length} rendered frames are attached below, in order.`)
  if (shown.dropped > 0) {
    const notShown = renderImages.slice(shown.admitted.length).map((img) => img.frame).filter((f) => f !== undefined)
    lines.push(
      `${shown.dropped} rendered ${shown.dropped === 1 ? 'image was' : 'images were'} not attached` +
        (notShown.length > 0 ? ` (frames ${notShown.join(', ')})` : '') +
        ": over this result's size limit. Ask for fewer frames, a narrower range, a smaller width, or a region.",
    )
  }
  const failure = describeRenderFailure(rendered)
  if (failure) lines.push(failure)
  const warned = describeCodeWarnings(isPlainRecord(rendered) && Array.isArray(rendered.warnings) ? (rendered.warnings as CodeDiagnostic[]) : null)
  if (warned) lines.push(warned)

  const content: CallToolResult['content'] = [
    { type: 'text', text: `${lines.join('\n')}\n\n${JSON.stringify(contextForJson, null, 2)}` },
  ]
  for (const img of screen.admitted) content.push({ type: 'image', data: img.data, mimeType: img.mimeType })
  for (const img of shown.admitted) content.push({ type: 'image', data: img.data, mimeType: img.mimeType })
  return { content }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Parse a `data:<mime>;base64,<data>` URL into an image block's parts. Returns null on any non-data-URL. */
function parseDataUrl(dataUrl: unknown): { data: string; mimeType: string } | null {
  if (typeof dataUrl !== 'string') return null
  const m = /^data:([^;]+);base64,(.+)$/s.exec(dataUrl)
  const mimeType = m?.[1]
  const data = m?.[2]
  if (!mimeType || !data) return null
  return { mimeType, data }
}

/** A page of projects: one line per project (id, kind, title, state flags). */
export function projectListResult({ projects, nextCursor }: ProjectListResult): CallToolResult {
  if (projects.length === 0) return text('No projects found.')
  const rows = projects.map((p) => {
    const flags = [p.isArchived ? 'archived' : null, p.isFavorited ? 'favorited' : null].filter(Boolean).join(', ')
    return `- ${p.id}  [${p.type}]  "${p.title}"  ${p.orientation}${flags ? `  (${flags})` : ''}${linkAfter(p.appUrl)}`
  })
  return text(lines([`${projects.length} project(s):`, ...rows, moreLine(nextCursor)]))
}

/** A freshly created project: the id + kind to start editing against. */
export function projectCreatedResult(p: ProjectDetail, linkedCardId?: string): CallToolResult {
  return text(
    `Created ${p.type} project ${p.id}${linkAfter(p.appUrl)}: "${p.title}" (${p.orientation} ${p.width}x${p.height}), revision ${p.revision}.\n` +
      (linkedCardId ? `Linked to card ${linkedCardId}.\n` : '') +
      // The TOOL is still called update_timeline; `kind` is what says which one applies.
      `Use this id with update_${p.type === 'canvas' ? 'canvas' : 'timeline'} to add content.` +
      // A new editor already has its main track, empty: naming it is what keeps the first clips off an overlay.
      (mainTrackIdOf(p) ? `\nMain track: ${mainTrackIdOf(p)}. Add the first clips to it.` : ''),
  )
}

/** The editor project's main (primary) track id, from the full state the create returns; null for a canvas. */
function mainTrackIdOf(p: ProjectDetail): string | null {
  if (p.type === 'canvas') return null
  const tracks = (p.state as { tracks?: Array<{ id?: unknown; isPrimary?: unknown }> } | undefined)?.tracks
  const main = tracks?.find((t) => t.isPrimary === true)
  return typeof main?.id === 'string' ? main.id : null
}

/** Confirmation of a permanent delete. */
export function projectDeletedResult(projectId: string): CallToolResult {
  return text(`Permanently deleted project ${projectId}. This cannot be undone.`)
}

/** A project's summary after a change, or a new project made by a copy: what it is now. */
export function projectSummaryResult(p: ProjectSummary, verb: string): CallToolResult {
  const flags = [p.isArchived ? 'archived' : null, p.isFavorited ? 'favorited' : null].filter(Boolean).join(', ')
  return text(
    `${verb} ${p.type} project ${p.id}${linkAfter(p.appUrl)}: "${p.title}" (${p.orientation} ${p.width}x${p.height})` +
      `, cover ${p.coverSource}${p.coverFrame != null ? ` at frame ${p.coverFrame}` : ''}${flags ? ` (${flags})` : ''}.`,
  )
}

/** A video project's timeline settings, one per line. */
export function timelineSettingsResult(projectId: string, s: TimelineSettings): CallToolResult {
  const onOff = (b: boolean) => (b ? 'on' : 'off')
  const linked = Object.entries(s.linkedTracks).filter(([, on]) => on).map(([kind]) => kind)
  return text(
    lines([
      `Timeline settings for project ${projectId}:`,
      `- magneticTrack: ${onOff(s.magneticTrack)}`,
      `- snapping: ${onOff(s.snapping)}`,
      `- linkage: ${onOff(s.linkage)}`,
      `- linkedTracks: ${linked.length ? linked.join(', ') : 'none'}`,
      `- followPlayhead: ${onOff(s.followPlayhead)}`,
      `- skimming: ${onOff(s.skimming)}`,
      `- skipDisabledClips: ${onOff(s.skipDisabledClips)}`,
    ]),
  )
}

/** A page of a project's saved versions, newest first. */
export function projectVersionListResult(projectId: string, { versions, nextCursor }: ProjectVersionListResult): CallToolResult {
  if (!versions.length) return text(`Project ${projectId} has no saved versions.`)
  const rows = versions.map(
    (v) =>
      `- ${v.id} | ${v.createdAt}${v.label ? ` | "${v.label}"` : ''} | ${v.triggerReason}${v.authorName ? ` | by ${v.authorName}` : ''}${v.revision != null ? ` | revision ${v.revision}` : ''}`,
  )
  return text(lines([`${versions.length} version(s) of project ${projectId}, newest first:`, ...rows, moreLine(nextCursor)]))
}

/** A page of a project's exports, newest first: one row each, with its download and share page once finished. */
export function projectExportListResult(projectId: string, { exports, nextCursor }: ProjectExportListResult): CallToolResult {
  if (!exports.length) return text(`Project ${projectId} has no exports.`)
  const rows = exports.map((e) => {
    const done = e.status === 'completed'
    const kind = e.exportType ? ` | ${e.exportType}` : ''
    const files = done ? `${e.outputUrl ? ` | download: ${e.outputUrl}` : ''}${e.shareUrl ? ` | share page: ${e.shareUrl}` : ''}` : ` | ${e.status} (poll get_export)`
    return `- ${e.exportId}${linkAfter(e.appUrl)} | ${e.createdAt}${kind}${e.title ? ` | "${e.title}"` : ''}${files}`
  })
  return text(lines([`${exports.length} export(s) of project ${projectId}, newest first:`, ...rows, moreLine(nextCursor)]))
}

/** A version just saved. */
export function projectVersionSavedResult(projectId: string, v: SavedProjectVersion): CallToolResult {
  return text(`Saved version ${v.id}${v.label ? ` "${v.label}"` : ''} of project ${projectId}.`)
}

/** A version put back into its project. */
export function projectVersionRestoredResult(projectId: string, versionId: string, r: RestoredProjectVersion): CallToolResult {
  return text(
    `Restored version ${versionId} into project ${projectId}; it is at revision ${r.revision}. The state before the restore was saved as a version first.`,
  )
}

/** A version renamed (or its name cleared). */
export function projectVersionRenamedResult(v: { id: string; label: string | null }): CallToolResult {
  return text(v.label ? `Version ${v.id} is now "${v.label}".` : `Version ${v.id} has no name.`)
}

/** A version removed. */
export function projectVersionDeletedResult(versionId: string): CallToolResult {
  return text(`Deleted version ${versionId}.`)
}

/** An undo or a redo: the edit it reversed and the revision it made. */
export function undoResult(projectId: string, r: UndoResult): CallToolResult {
  return text(`${r.label} on project ${projectId}. The project is at revision ${r.revision}.`)
}

/** The canvas layer-type catalog (types + editable props) as readable text + the JSON. */
export function layerTypesResult(cat: LayerTypeCatalog): CallToolResult {
  const lines = cat.layerTypes.map((t) => `- ${t.type}: ${t.description} (props: ${t.props.map((p) => p.name).join(', ')}; supports: ${t.supports.join(', ')})`)
  const ops = cat.ops ? cat.ops.ops.map((o) => `- ${o.shape}  ${o.description}`) : []
  return text(
    `Canvas layer types (edit via update_canvas ops):\n${lines.join('\n')}\n\n` +
      (ops.length ? `update_canvas ops (${cat.ops!.description}):\n${ops.join('\n')}\n\n` : '') +
      `Shared prop groups: ${Object.keys(cat.sharedProps).join(', ')}.\n\n` +
      JSON.stringify(cat), // minified: a model reads it, and indentation was a third of its size
  )
}

/** A completed export -> the download URL; an in-flight one -> the exportId to poll. */
/**
 * Which formats the widget can actually draw.
 *
 * ⚠️ `pdf` and `pptx` have no element, and a multi-slide `png`/`jpg` export comes back as a ZIP rather than
 * an image. Rendering a tile for any of them would show a broken picture where the text already gives a
 * working download link, so they stay text.
 */
// The timeline's sound (7.67) plays in the widget, as a generated sound does; subtitles and transcripts stay text.
const EXPORT_MEDIUM: Record<string, 'image' | 'video' | 'audio'> = { mp4: 'video', png: 'image', jpg: 'image', mp3: 'audio', aac: 'audio', wav: 'audio' }

/**
 * An export, DISPLAYED. Separate from {@link exportJobResult} by name, not by a flag.
 *
 * ## ⛔⛔ ONLY THE TOOL THAT STARTED THE EXPORT KNOWS ITS FORMAT
 *
 * `get_export` polls by exportId alone, so it cannot know whether the file is an mp4 or a pptx and can
 * never render one. Leaving both paths inside one builder made the completeness guard read `get_export` as
 * a tool that emits a widget, which it does not, and an invariant that has to be argued with is not one.
 * Two names, each true on its own.
 */
export function completedExportResult(
  job: ExportJob,
  format: string,
): CallToolResult {
  const prose = withCodeWarnings(`Export ${job.exportId} completed.\nDownload: ${job.outputUrl}`, job.warnings)
  const medium = EXPORT_MEDIUM[format]
  if (job.status !== 'completed' || !job.outputUrl || !medium) return exportJobResult(job)
  {
    /**
     * ## ⛔⛔ AN EXPORT RENDERS, AND IT IS NOT REFERENCEABLE
     *
     * Someone waited for a render, so they should see it. But an `exportId` is not an `outputId`: no
     * generate tool resolves one, so Animate, Edit and Recreate would emit messages the agent cannot act
     * on. Omitting `reference` is what hides them, and Download, the verb that actually applies to a
     * rendered file, stays.
     *
     * ⚠️ NO `openUrl` EITHER. An export's home is a download. The job's `appUrl` lands on the project it came
     * from, which is a different destination with a different meaning, so it stays in the data, not on a tile.
     */
    return {
      content: [{ type: 'text', text: prose }],
      structuredContent: mediaWidgetData({
        contentType: medium,
        items: [{ url: job.outputUrl, name: job.exportId, contentType: medium }],
      }),
      _meta: WIDGET_META,
    }
  }
}

/** An export, REPORTED. No widget: a poll does not know the format, so it cannot draw the file. */
/** `appUrl` and `shortId` are optional here: a timed-out wait knows only the export's id and status. */
export function exportJobResult(job: Omit<ExportJob, 'appUrl' | 'shortId'> & { appUrl?: string; shortId?: string }): CallToolResult {
  if (job.status === 'completed') {
    const share = describeExportShareLink(job.shareUrl)
    return text(withCodeWarnings(`Export ${job.exportId}${linkAfter(job.appUrl)} completed.\nDownload: ${job.outputUrl}${share ? `\n${share}` : ''}`, job.warnings))
  }
  if (job.status === 'failed') {
    return text(withCodeWarnings(`Export ${job.exportId} failed: ${job.errorMessage ?? 'unknown error'}.`, job.warnings), true)
  }
  const pct = typeof job.progress === 'number' ? ` (${Math.round(job.progress * 100)}%)` : ''
  return text(
    withCodeWarnings(
      `Export ${job.exportId} is ${job.status}${pct}. Still rendering. Poll get_export with this exportId for the download URL.`,
      job.warnings,
    ),
  )
}

/** A project's live link after share_project, in the SDK's one wording. */
export function projectShareResult(share: ProjectShare): CallToolResult {
  return text(describeProjectShare(share))
}

/** Media shared as one link, in the SDK's one wording. */
export function mediaShareResult(share: MediaShare, asked: readonly string[]): CallToolResult {
  return text(describeMediaShare(share, asked))
}

/** The export-format catalog as readable text + JSON. */
export function exportFormatsResult(cat: ExportFormatCatalog): CallToolResult {
  const lines = cat.formats.map((f) => `- ${f.format} (${f.projectTypes.join('/')}${f.async ? ', async' : ''}): ${f.description}`)
  return text(
    `Export formats:\n${lines.join('\n')}\n\nResolutions (mp4): ${cat.resolutions.join(', ')}. Qualities: ${cat.qualities.join(', ')}.\n\n` +
      JSON.stringify(cat, null, 2),
  )
}

/**
 * The link contract as text: the grammar, then one line per noun and section with what it opens, its tabs, and what a
 * tab's item names. Text, not JSON, because an agent reads it to build links and the prose is a third of the size.
 */
/**
 * The code guide, as the document the app renders (`markdown`): the app builds it from the sandbox's
 * manifest and renders it once, so this prints it rather than rendering a second copy that could drift.
 */
export function codeGuideResult(g: CodeGuide): CallToolResult {
  return text(`${g.markdown.trimEnd()}\n\n(Guide version ${g.version}.)`)
}

/** The effect catalog: every effect by group, where it can go, and the elements code gives effects to. */
export function effectListResult(list: EffectList): CallToolResult {
  const groups = new Map<string, string[]>()
  for (const e of list.effects) {
    const where = e.onClips ? 'code and clips' : `code only; on a clip, ${e.gradedBy} does this`
    groups.set(e.group, [...(groups.get(e.group) ?? []), `- ${e.name} (${e.importPath}): ${e.description}. ${where}.`])
  }
  const lines = [...groups].flatMap(([group, rows]) => [`${group}:`, ...rows, ''])
  return text(
    [
      `${list.effects.length} effects. In code, they go on ${list.codeHosts.join(', ')}; on a video or image clip, in its effects.`,
      '',
      ...lines,
      "Read one with get_schema kind 'effect' and its name for its parameters.",
    ].join('\n'),
  )
}

/** One effect in full: its parameters with ranges and defaults, its working defaults, and what keyframes on a clip. */
export function effectResult(e: EffectDetail): CallToolResult {
  const params = Object.entries(e.params).map(([name, p]) => {
    const range = p.min !== undefined || p.max !== undefined ? ` ${p.min ?? ''}..${p.max ?? ''}` : ''
    const fallback = p.default !== undefined ? `, default ${JSON.stringify(p.default)}` : ''
    return `- ${name}: ${p.type}${range}${fallback}${p.description ? ` (${p.description})` : ''}`
  })
  return text(
    [
      `${e.name} (${e.group}): ${e.description}.`,
      `Import: ${e.importPath}. On clips: ${e.onClips ? 'yes' : `no, ${e.gradedBy} does this`}.`,
      '',
      'Parameters:',
      ...params,
      '',
      `Working defaults: ${JSON.stringify(e.defaults)}`,
      e.onClips ? `Keyframeable on a clip (effects.<id>.<param>): ${e.keyframeable.join(', ') || 'none'}` : '',
      e.documentation ? `Docs: ${e.documentation}` : '',
    ]
      .filter((line, i, all) => line !== '' || (all[i - 1] ?? '') !== '')
      .join('\n')
      .trimEnd(),
  )
}

export function linkFormatsResult(f: LinkFormats): CallToolResult {
  const items = (t?: Record<string, { id: string; values?: string[] }>) =>
    t && Object.keys(t).length
      ? `; items: ${Object.entries(t).map(([tab, it]) => `${tab}/{item} = ${it.values ? it.values.join('|') : it.id}`).join(', ')}`
      : ''
  const params = (p?: Record<string, { means: string; values?: string[]; value?: string }>) =>
    p && Object.keys(p).length
      ? `; params: ${Object.entries(p).map(([k, v]) => `?${k}=${v.values ? v.values.join('|') : `{${v.value}}`} (${v.means})`).join(', ')}`
      : ''
  const nouns = f.nouns.map(
    (n) => `- /${n.noun}/{id}: ${n.opens}. {id}: ${n.id}${n.tabs ? `; tabs: ${n.tabs.join('|')} (first is the bare address)` : ''}${items(n.tabItems)}${params(n.params)}`,
  )
  const sections = f.sections.map(
    (s) => `- /${s.section}: ${s.opens}; tabs: ${s.tabs.join('|')}${s.defaultTab ? ` (bare path shows ${s.defaultTab})` : ' (bare path shows the last-used tab, so spell the tab)'}${items(s.tabItems)}${params(s.params)}`,
  )
  return text(
    [`Links: ${f.grammar.join('  or  ')}`, `origin: ${f.origin}`, '', 'Nouns:', ...nouns, '', 'Sections:', ...sections].join('\n'),
  )
}

/** The editor timeline clip + track-type catalog as readable text + the JSON. */
export function editorTranscriptResult(r: TranscriptResult): CallToolResult {
  if (!r.mediaTranscribed) {
    return text(r.note ?? 'No transcript available for this project yet.')
  }
  // A readable, clip-by-clip transcript in timeline order: each line is one clip, marked [disabled] when it is
  // cut (excluded from the render) so the agent sees what is already removed. In word mode each line also
  // summarizes its word / silence / event counts. The full structured data (clipIds, timeline frames, word
  // timing, silences, audio events) follows as JSON for exact targeting via update_timeline.
  const lines = r.segments.map((s) => {
    const tag = s.disabled ? `[disabled${s.disabledReason ? `:${s.disabledReason}` : ''}]` : '[enabled]'
    const body = s.text ? s.text : '(no speech)'
    const extra =
      s.words || s.silences || s.audioEvents
        ? ` {${s.words?.length ?? 0} words, ${s.silences?.length ?? 0} silences, ${s.audioEvents?.length ?? 0} events}`
        : ''
    return `${tag} ${s.clipId}  ${s.sourceStartMs}-${s.sourceEndMs}ms (frames ${s.fromFrame}-${s.fromFrame + s.durationFrames}):${extra} ${body}`
  })
  const speakerLine = r.speakers && r.speakers.length > 0 ? `Speakers: ${r.speakers.join(', ')}.\n` : ''
  return text(
    `Transcript for ${r.projectId} (${r.segmentCount} clip segment(s), ${r.fps}fps, revision ${r.revision}). [disabled] = cut/excluded from the render, [enabled] = kept.\n` +
      `Cut non-destructively with update_timeline disable_ranges (source-media ranges) or set_disabled (whole clip); restore with set_disabled disabled:false. Word timing + timeline frames + silences + audio events are in the JSON when granularity 'word' was requested.\n` +
      speakerLine +
      `To edit safely against a concurrent change, pass revision ${r.revision} as expectedRevision; or omit expectedRevision to just apply to the current state.\n\n` +
      `${lines.join('\n')}\n\n` +
      JSON.stringify(r, null, 2),
  )
}

export function timelineTypesResult(cat: TimelineTypeCatalog): CallToolResult {
  const clips = cat.clipTypes.map((t) => `- ${t.type}: ${t.description} (props: ${t.props.map((p) => p.name).join(', ')})`)
  const tracks = cat.trackTypes.map((t) => `- ${t.trackType}: holds ${t.holds.join(', ')}`)
  const editOps = cat.editOps ? cat.editOps.ops.map((o) => `- ${o.shape}  ${o.description}`) : []
  return text(
    `Editor timeline clip types (edit via update_timeline ops):\n${clips.join('\n')}\n\nTrack types:\n${tracks.join('\n')}\n\n` +
      (editOps.length ? `update_timeline edit ops (${cat.editOps!.description}):\n${editOps.join('\n')}\n\n` : '') +
      `Shared prop groups: ${Object.keys(cat.sharedProps).join(', ')}.\n\n` +
      JSON.stringify(cat), // minified: a model reads it, and indentation was a third of its size
  )
}
