/**
 * `contenthero import` - bring something into ContentHero; what comes back follows what came in (the MCP's `import`).
 *
 *   import <url> [--content-type <mime>] [--name <name>]      a file (free) or a video page on a supported site (spends)
 *                                                            into the library
 *   import --content <id>                                    a tracked post's video into its shared analysis copy
 *                                                            (spends unless the copy exists or is being made)
 *   import --pptx <url> | --canva <id> [--title] [--card]    a deck into a new canvas project (free)
 *
 * Exactly one source per run. `--cost` prints what it would spend and runs nothing.
 */

import type { Command } from 'commander'
import {
  pendingJob,
  type ContentImportResult,
  type CostEstimate,
  type ImportStarted,
  type ImportedMedia,
  type ProjectDetail,
} from '@contenthero/sdk'
import { makeClient } from '../context.js'
import { DEFAULT_TIMEOUT_SEC } from '../generation.js'
import { costRows, emit, keyValues, linkRow, displayId, statusCommand } from '../output.js'
import { CliError, EXIT } from '../errors.js'
import { toInt } from '../args.js'

/** How often a post import asks again while its copy downloads. Asking again is free. */
const POST_POLL_MS = 5_000

/**
 * An import may have created NOTHING, so it cannot share `uploadedHuman`.
 *
 * ## Why this is not cosmetic
 *
 * Importing a url is idempotent: the same bytes twice give one library item, not two. Rendered through the
 * upload formatter, a duplicate printed `Output id:` followed by nothing, because `outputId` is null in that
 * case. That reads as a broken command rather than a deliberate no-op, which is worse than the behavior it
 * replaced.
 *
 * Three cases, because what the operator can DO next differs:
 *
 *   created            -> an id to reference
 *   duplicate, is a library item -> the EXISTING id, and a note that nothing was imported
 *   duplicate, is not  -> no id at all; the bytes are an export or a look, so say what they ARE
 *
 * The third is the case that caused the incident behind this work: an editor export still was imported and
 * became a row that owned no object. "Already imported" without naming what it is sends the operator hunting
 * for a library item that does not exist.
 *
 * ⚠️ `--json` is unaffected and still emits the full object. This is the HUMAN rendering only, so a script
 * reading `alreadyExisted` keeps working unchanged.
 */
export function importStartedHuman(m: Pick<ImportStarted, 'outputId' | 'status'> & { shortId?: string | null; appUrl?: string | null }): string {
  return keyValues([
    ['Output id', displayId({ id: m.outputId, shortId: m.shortId })],
    ...linkRow(m),
    ['Status', m.status],
    ['Next', statusCommand([{ id: m.outputId, shortId: m.shortId, kind: 'output' }])],
  ])
}

export function importedHuman(m: ImportedMedia): string {
  if (!m.alreadyExisted) {
    // Non-null whenever something was created; the fallback exists so a null can never render as a blank
    // value, which is the exact failure this function was written to remove.
    return keyValues([
      ['Output id', m.outputId ? displayId({ id: m.outputId, shortId: m.shortId }) : 'none'],
      ...linkRow(m),
      ['URL', m.url],
      ...costRows(m.charge),
    ])
  }
  if (m.outputId) {
    return keyValues([
      ['Status', 'Already in your library. Nothing was imported.'],
      ['Output id', displayId({ id: m.outputId, shortId: m.shortId })],
      ...linkRow(m),
      ['URL', m.url],
    ])
  }
  return keyValues([
    ['Status', 'You already have this file. Nothing was imported.'],
    ['Already stored as', m.existing?.role ?? 'an existing file'],
    ['Object', m.existing?.objectName ?? ''],
    // Stated rather than left blank: an absent id is the ANSWER here, not a missing value.
    ['Output id', 'none (not a library item, reference it by URL)'],
    ['URL', m.url],
  ])
}

/** Where a post's shared analysis copy stands, and how to follow it when it is still downloading. */
export function contentImportHuman(r: ContentImportResult): string {
  const copy = r.copy
  const status =
    copy.status === 'ready'
      ? "ready in the post's shared analysis copy, which the reading tools use. Nothing was added to your library."
      : copy.status === 'pending'
        ? "still downloading into the post's shared analysis copy"
        : copy.status === 'failed'
          ? `the download failed: ${copy.error}. Importing the post again tries once more.`
          : `this post has no video to import: ${copy.reason}`
  return keyValues([
    ['Post', displayId({ id: r.contentId, shortId: r.shortId })],
    ...linkRow(r),
    ['Video', status],
    ...costRows(r.charge),
    ...(copy.status === 'pending'
      ? [['Next', `contenthero import --content ${r.shortId || r.contentId} (free)`] as [string, string]]
      : []),
  ])
}

/** What an import would spend, by what it brings in. */
function importCostHuman(subject: 'url' | 'post' | 'project'): (e: CostEstimate) => string {
  return (e) => {
    const none = 'Nothing ran and nothing was charged.'
    if (subject === 'project') return `Importing into a new canvas project costs 0 credits. ${none}`
    if (e.creditsEstimate === 0) {
      return subject === 'post'
        ? `This post's copy already exists or is being made: importing it costs 0 credits. ${none}`
        : `Importing this address costs 0 credits: it is a file, which imports free. ${none}`
    }
    const what = subject === 'post' ? 'this post' : "this page's video"
    return `Importing ${what} costs at most ${e.creditsEstimate} credits: the most its download may move is held, and it is charged for what arrives. ${none}`
  }
}

function projectImportedHuman(p: ProjectDetail, cardId: string | undefined): string {
  return `Imported ${p.type} project ${p.id} "${p.title}" (${p.orientation}), revision ${p.revision}` + (cardId ? `, linked to card ${cardId}` : '')
}

export function registerImport(program: Command): void {
  program
    .command('import')
    .description(
      'Bring something into ContentHero: a url (a file, free, or a video page on a supported site, which spends) into the library, a tracked post into its shared analysis copy (--content), or a deck into a new canvas project (--pptx, --canva). See --cost',
    )
    .argument('[url]', 'a public https address: a file, or a video page on a supported site')
    .option('--content <id>', "a tracked post: its video goes into the post's shared analysis copy, not your library")
    .option('--pptx <url>', 'a PowerPoint or Google Slides file address: imported into a new canvas project')
    .option('--canva <id>', "a Canva design id: imported into a new canvas project through the account's Canva connection")
    .option('--content-type <mime>', 'with a url: MIME type override (else taken from the response)')
    .option('--name <name>', 'with a url: file name override (used for the extension)')
    .option('--title <text>', 'with --pptx or --canva: the new project\'s title')
    .option('--card <id>', 'with --pptx or --canva: link the new project to this card in the same call (also needs planner:write)')
    .option('--cost', 'show what the import would spend instead of importing (nothing runs, nothing is charged)')
    .option('--no-wait', 'return at once instead of waiting for a url import or a post\'s copy')
    .option('--timeout <seconds>', 'how long to wait before handing back', toInt, DEFAULT_TIMEOUT_SEC)
    .action(async (url: string | undefined, opts: Record<string, unknown>, command: Command) => {
      const sources = [
        ['a url', url],
        ['--content', opts.content],
        ['--pptx', opts.pptx],
        ['--canva', opts.canva],
      ].filter(([, v]) => typeof v === 'string' && v !== '') as Array<[string, string]>
      if (sources.length === 0) throw new CliError('import needs exactly one source: a url, --content, --pptx or --canva.', EXIT.USAGE)
      if (sources.length > 1) throw new CliError(`import takes exactly one source per run; got ${sources.map(([n]) => n).join(' and ')}.`, EXIT.USAGE)
      const isUrl = url !== undefined && url !== ''
      const isProject = Boolean(opts.pptx || opts.canva)
      if (!isUrl && (opts.contentType !== undefined || opts.name !== undefined)) {
        throw new CliError('--content-type and --name go with a url only.', EXIT.USAGE)
      }
      if (!isProject && (opts.title !== undefined || opts.card !== undefined)) {
        throw new CliError('--title and --card go with --pptx or --canva only.', EXIT.USAGE)
      }
      const timeoutMs = ((opts.timeout as number | undefined) ?? DEFAULT_TIMEOUT_SEC) * 1000
      const { client, ctx } = makeClient(command)

      if (isProject) {
        if (opts.cost) {
          emit({ getCost: true, creditsEstimate: 0 }, ctx, importCostHuman('project'))
          return
        }
        const source = opts.pptx
          ? ({ type: 'pptx', fileUrl: opts.pptx as string } as const)
          : ({ type: 'canva', designId: opts.canva as string } as const)
        const cardId = opts.card as string | undefined
        const p = await client.importProject({ source, title: opts.title as string | undefined, cardId })
        emit(p, ctx, (d: ProjectDetail) => projectImportedHuman(d, cardId))
        return
      }

      if (opts.content) {
        const contentId = opts.content as string
        if (opts.cost) {
          emit(await client.estimateImportCost({ contentId }), ctx, importCostHuman('post'))
          return
        }
        // A post's copy has no job `status` reads: asking again is how it is followed, and it is free.
        let result = await client.importContent(contentId)
        const deadline = Date.now() + timeoutMs
        while (opts.wait !== false && result.copy.status === 'pending' && Date.now() + POST_POLL_MS <= deadline) {
          await new Promise((resolve) => setTimeout(resolve, POST_POLL_MS))
          result = await client.importContent(contentId)
        }
        emit(result, ctx, contentImportHuman)
        if (opts.wait !== false && result.copy.status === 'pending') process.exitCode = EXIT.TIMEOUT
        return
      }

      const target = url as string
      if (opts.cost) {
        emit(await client.estimateImportCost({ url: target }), ctx, importCostHuman('url'))
        return
      }
      const input = { url: target, contentType: opts.contentType as string | undefined, fileName: opts.name as string | undefined }
      if (opts.wait === false) {
        emit(await client.startImport(input), ctx, importStartedHuman)
        return
      }
      try {
        emit(await client.importMedia(input, { timeoutMs }), ctx, importedHuman)
      } catch (err) {
        // Accepted and still running (or the poll dropped): the import is not lost, so hand back its id and exit
        // TIMEOUT, never an error that invites running it again. A refused url is terminal and still throws.
        const pending = pendingJob(err)
        if (!pending) throw err
        emit({ ...pending, status: 'processing' as const }, ctx, importStartedHuman)
        process.exitCode = EXIT.TIMEOUT
      }
    })
}
