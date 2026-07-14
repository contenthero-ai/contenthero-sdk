/**
 * `contenthero project` - manage projects (canvas slides or editor timeline) and edit them via ops.
 *
 *   project list  [--filter <state>] [--kind <kind>] [--search <text>]   (requires editor:read)
 *   project get   <projectId>                                            (requires editor:read)
 *   project create [--kind <kind>] [--title <t>] [--orientation <r>] [--width <n>] [--height <n>]
 *   project delete <projectId> --yes                                     (permanent, requires editor:write)
 *   project import --source-type <pptx|canva> [--file-url <url>] [--design-id <id>] [--title <t>]
 *   project export <projectId> [--format mp4|png|jpg|pdf|pptx] [--resolution <r>] [--frame <n>] [--no-watermark] [--wait]
 *   project export-status <exportId>                                     (requires editor:read)
 *   project export-formats                                               (requires editor:read)
 *   project layer-types                                                  (canvas types, requires editor:read)
 *   project timeline-types                                               (editor types, requires editor:read)
 *   project apply <projectId> --ops <json> | --ops-file <path> [--intent <text>] [--expected-revision <n>]
 *
 * Ops are the shared editor/canvas op vocabulary (the same the manual UI + in-app agent use). Read first
 * with `project get` to learn the current state + revision, then pass that revision as --expected-revision
 * for safe concurrent edits. All edits require the editor:write scope.
 */
import { readFileSync } from 'node:fs'
import type { Command } from 'commander'
import type { EditorOp, ImportProjectSource } from '@contenthero/sdk'
import { makeClient } from '../context.js'
import { emit } from '../output.js'
import { CliError, EXIT } from '../errors.js'
import { toInt } from '../args.js'

function parseOps(raw: string): EditorOp[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (e) {
    throw new CliError(
      `Invalid ops JSON: ${e instanceof Error ? e.message : 'parse error'}. Expected a JSON array of op objects.`,
      EXIT.USAGE,
    )
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new CliError('Ops must be a non-empty JSON array of op objects.', EXIT.USAGE)
  }
  return parsed as EditorOp[]
}

export function registerProject(program: Command): void {
  const project = program
    .command('project')
    .description("Read + edit a project's composition (canvas or timeline) via ops")

  project
    .command('list')
    .description('List projects, both editor + canvas (requires editor:read)')
    .option('--filter <state>', 'archived | favorited (omitted = active)')
    .option('--kind <kind>', 'editor | canvas (omitted = both)')
    .option('--search <text>', 'case-insensitive title search')
    .action(async (opts: Record<string, unknown>, command: Command) => {
      const { client, ctx } = makeClient(command)
      const projects = await client.listProjects({
        filter: opts.filter as 'archived' | 'favorited' | undefined,
        kind: opts.kind as 'editor' | 'canvas' | undefined,
        search: opts.search as string | undefined,
      })
      emit(projects, ctx, () =>
        projects.length === 0
          ? 'No projects found.'
          : projects.map((p) => `${p.id}  [${p.kind}]  ${p.title}  ${p.orientation}`).join('\n'),
      )
    })

  project
    .command('get')
    .description("Read a project's full detail + revision (requires editor:read)")
    .argument('<projectId>', 'the project id')
    .action(async (projectId: string, _opts: Record<string, unknown>, command: Command) => {
      const { client, ctx } = makeClient(command)
      const p = await client.getProject(projectId)
      emit(p, ctx, () => `Project ${p.id} "${p.title}" (${p.kind}, ${p.surface}), revision ${p.revision}`)
    })

  project
    .command('create')
    .description('Create a project (requires editor:write)')
    .option('--kind <kind>', "editor | canvas (default: editor)")
    .option('--title <text>', "project title (default: Untitled)")
    .option('--orientation <ratio>', "e.g. 16:9, 9:16, 1:1 (default: 16:9)")
    .option('--width <n>', 'pixel width (default: from orientation)', toInt)
    .option('--height <n>', 'pixel height (default: from orientation)', toInt)
    .action(async (opts: Record<string, unknown>, command: Command) => {
      const { client, ctx } = makeClient(command)
      const p = await client.createProject({
        kind: opts.kind as 'editor' | 'canvas' | undefined,
        title: opts.title as string | undefined,
        orientation: opts.orientation as string | undefined,
        width: opts.width as number | undefined,
        height: opts.height as number | undefined,
      })
      emit(p, ctx, () => `Created ${p.kind} project ${p.id} "${p.title}" (${p.orientation}), revision ${p.revision}`)
    })

  project
    .command('delete')
    .description('PERMANENTLY delete a project, irreversible (requires editor:write)')
    .argument('<projectId>', 'the project id')
    .option('--yes', 'confirm the irreversible permanent delete')
    .action(async (projectId: string, opts: Record<string, unknown>, command: Command) => {
      if (!opts.yes) {
        throw new CliError(
          'Permanent delete is irreversible. Re-run with --yes to confirm, or archive the project instead to reversibly hide it.',
          EXIT.USAGE,
        )
      }
      const { client, ctx } = makeClient(command)
      await client.deleteProject(projectId)
      emit({ success: true, projectId }, ctx, () => `Permanently deleted project ${projectId}.`)
    })

  project
    .command('import')
    .description('Import a PPTX/Slides file URL or a Canva design into a new canvas project (requires editor:write)')
    .option('--source-type <type>', "pptx | canva")
    .option('--file-url <url>', "PPTX / slides file URL (when --source-type pptx)")
    .option('--design-id <id>', "Canva design id (when --source-type canva)")
    .option('--title <text>', "title for the created project")
    .action(async (opts: Record<string, unknown>, command: Command) => {
      const sourceType = opts.sourceType as string | undefined
      let source: ImportProjectSource
      if (sourceType === 'pptx') {
        if (!opts.fileUrl) throw new CliError('--file-url is required when --source-type is pptx.', EXIT.USAGE)
        source = { type: 'pptx', fileUrl: opts.fileUrl as string }
      } else if (sourceType === 'canva') {
        if (!opts.designId) throw new CliError('--design-id is required when --source-type is canva.', EXIT.USAGE)
        source = { type: 'canva', designId: opts.designId as string }
      } else {
        throw new CliError('--source-type must be pptx or canva.', EXIT.USAGE)
      }
      const { client, ctx } = makeClient(command)
      const p = await client.importProject({ source, title: opts.title as string | undefined })
      emit(p, ctx, () => `Imported ${p.kind} project ${p.id} "${p.title}" (${p.orientation}), revision ${p.revision}`)
    })

  project
    .command('export')
    .description('Export a project to a file (mp4/png/jpg both surfaces; pdf/pptx canvas) (requires editor:write)')
    .argument('<projectId>', 'the project id')
    .option('--format <format>', 'mp4 | png | jpg | pdf | pptx (default mp4)')
    .option('--resolution <res>', 'mp4 resolution: 480p|720p|1080p|2k|4k (default 720p)')
    .option('--quality <q>', 'mp4 quality: low|recommended|high')
    .option('--frame <n>', 'editor still (png/jpg) only: timeline frame to render (default 0)', toInt)
    .option('--no-watermark', 'remove the watermark (plan-gated)')
    .option('--wait', 'poll until the export finishes and print the URL')
    .option('--timeout <ms>', 'max wait when --wait (default 600000)', toInt)
    .action(async (projectId: string, opts: Record<string, unknown>, command: Command) => {
      const { client, ctx } = makeClient(command)
      const input = {
        format: opts.format as string | undefined,
        resolution: opts.resolution as string | undefined,
        quality: opts.quality as string | undefined,
        ...(opts.frame !== undefined ? { frame: opts.frame as number } : {}),
        // commander sets opts.watermark=false when --no-watermark is passed; leave undefined otherwise.
        ...(opts.watermark === false ? { watermark: false } : {}),
      }
      const job = opts.wait
        ? await client.exportProjectAndWait(projectId, input, { timeoutMs: (opts.timeout as number | undefined) ?? 600000 })
        : await client.startExport(projectId, input)
      emit(job, ctx, () =>
        job.status === 'completed'
          ? `Export ${job.exportId} completed: ${job.outputUrl}`
          : `Export ${job.exportId} is ${job.status}. Poll: contenthero project export-status ${job.exportId}`,
      )
    })

  project
    .command('export-status')
    .description('Poll an export job by id (requires editor:read)')
    .argument('<exportId>', 'the export id')
    .action(async (exportId: string, _opts: Record<string, unknown>, command: Command) => {
      const { client, ctx } = makeClient(command)
      const job = await client.getExport(exportId)
      emit(job, ctx, () =>
        job.status === 'completed' ? `completed: ${job.outputUrl}` : `${job.status}${typeof job.progress === 'number' ? ` (${Math.round(job.progress * 100)}%)` : ''}`,
      )
    })

  project
    .command('export-formats')
    .description('List available export formats (requires editor:read)')
    .action(async (_opts: Record<string, unknown>, command: Command) => {
      const { client, ctx } = makeClient(command)
      const cat = await client.getExportFormats()
      emit(cat, ctx, () => cat.formats.map((f) => `${f.format} (${f.surfaces.join('/')}): ${f.description}`).join('\n'))
    })

  project
    .command('layer-types')
    .description('List canvas layer types + editable props (requires editor:read)')
    .action(async (_opts: Record<string, unknown>, command: Command) => {
      const { client, ctx } = makeClient(command)
      const cat = await client.getLayerTypes()
      emit(cat, ctx, () => cat.layerTypes.map((t) => `${t.type}: ${t.props.map((p) => p.name).join(', ')}`).join('\n'))
    })

  project
    .command('timeline-types')
    .description('List editor timeline clip + track types (requires editor:read)')
    .action(async (_opts: Record<string, unknown>, command: Command) => {
      const { client, ctx } = makeClient(command)
      const cat = await client.getTimelineTypes()
      emit(cat, ctx, () => {
        const clips = cat.clipTypes.map((t) => `${t.type}: ${t.props.map((p) => p.name).join(', ')}`).join('\n')
        const tracks = cat.trackTypes.map((t) => `${t.trackType} holds ${t.holds.join(', ')}`).join('\n')
        return `Clips:\n${clips}\n\nTracks:\n${tracks}`
      })
    })

  project
    .command('apply')
    .description('Apply a batch of ops to a project composition (requires editor:write)')
    .argument('<projectId>', 'the project id')
    .option('--ops <json>', 'the ops as a JSON array string')
    .option('--ops-file <path>', 'read the ops JSON array from a file')
    .option('--intent <text>', 'a short description of the edit (for attribution)')
    .option('--expected-revision <n>', 'revision for optimistic concurrency (from `project get`)', toInt)
    .action(async (projectId: string, opts: Record<string, unknown>, command: Command) => {
      const raw = opts.opsFile ? readFileSync(opts.opsFile as string, 'utf8') : (opts.ops as string | undefined)
      if (!raw) throw new CliError('Provide --ops <json> or --ops-file <path>.', EXIT.USAGE)
      const ops = parseOps(raw)
      const { client, ctx } = makeClient(command)
      const result = await client.applyEditorOps({
        projectId,
        ops,
        userIntent: opts.intent as string | undefined,
        expectedRevision: opts.expectedRevision as number | undefined,
      })
      emit(result, ctx, () => {
        const ok = result.results.filter((r) => r.ok).length
        return `Applied ${ok}/${result.results.length} ${result.surface} op(s). New revision: ${result.revision}.`
      })
    })
}
