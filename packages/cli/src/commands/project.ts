/**
 * `contenthero project` - manage projects (canvas slides or editor timeline) and edit them via ops.
 *
 *   project list  [--filter <state>] [--type <t>] [--search <text>]      (requires editor:read)
 *   project get   <projectId>                                            (requires editor:read)
 *   project create [--type <t>] [--title <t>] [--orientation <r>] [--width <n>] [--height <n>]
 *   project delete <projectId> --yes                                     (permanent, requires editor:write)
 *   project import --source-type <pptx|canva> [--file-url <url>] [--design-id <id>] [--title <t>]
 *   project export <projectId> [--format mp4|png|jpg|pdf|pptx] [--resolution <r>] [--frame <n>] [--no-watermark] [--wait]
 *   project export-status <exportId>                                     (requires editor:read)
 *   project apply <projectId> --ops <json> | --ops-file <path> [--intent <text>] [--expected-revision <n>]
 *
 * Ops are the shared editor/canvas op vocabulary (the same the manual UI + in-app agent use). update_timeline
 * both CREATES and EDITS: CREATE ops (create_clip, insert_track, insert_prebuilt_track, add_transition) add
 * new clips/tracks/transitions; EDIT ops (move_clip, trim_clip, update_clip, delete_clip, remove_background,
 * disable_ranges, update_transition, remove_transition, ...) act on existing clips + transitions. CAPTION ops (add_captions,
 * update_captions, remove_captions) generate / restyle / remove transcript-driven captions.
 * Run `schema timeline` (or `schema layer`) first: each clip type carries a copy-pasteable `example`
 * clip skeleton and the catalog carries a `creation` section with the exact op shapes, so you know both what
 * to create and the item shape to pass. Then read `project get` for the current state + revision, and pass
 * that revision as --expected-revision for safe concurrent edits. All edits require the editor:write scope.
 */
import { readFileSync } from 'node:fs'
import { Option, type Command } from 'commander'
import { describeEditorOps, describeScope, withGraphicWarnings, type EditorOp, type ImportProjectSource } from '@contenthero/sdk'
import { makeClient } from '../context.js'
import { emit } from '../output.js'
import { CliError, EXIT } from '../errors.js'
import { toInt } from '../args.js'

/** `--surface`, the project type's name before cli 0.3.12, still accepted and hidden from help. `--type` wins. */
function deprecatedTypeAlias(): Option {
  return new Option('--surface <type>', 'deprecated alias for --type').choices(['editor', 'canvas']).hideHelp()
}

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
    .option('--type <type>', 'editor | canvas (omitted = both)')
    .addOption(deprecatedTypeAlias())
    .option('--search <text>', 'case-insensitive title search')
    .action(async (opts: Record<string, unknown>, command: Command) => {
      const { client, ctx } = makeClient(command)
      const projects = await client.listProjects({
        filter: opts.filter as 'archived' | 'favorited' | undefined,
        type: (opts.type ?? opts.surface) as 'editor' | 'canvas' | undefined,
        search: opts.search as string | undefined,
      })
      emit(projects, ctx, () =>
        projects.length === 0
          ? 'No projects found.'
          : projects.map((p) => `${p.id}  [${p.type}]  ${p.title}  ${p.orientation}`).join('\n'),
      )
    })

  project
    .command('get')
    .description("Read a project's composition + revision (summary by default; requires editor:read)")
    .argument('<projectId>', 'the project id')
    .option('--detail <detail>', "'summary' (default) or 'full' (the complete composition)")
    .option('--from <frame>', 'timeline only: start frame of a window (clips overlapping [from, to])')
    .option('--to <frame>', 'timeline only: end frame of the window')
    .option('--track <trackId>', 'timeline only: scope to one track by id')
    .option('--slide <slideId>', "canvas only: scope to one slide by id (applies to --detail full too)")
    // ⛔ No `--include-render-url` (retired 2026-10-04): a read must not render and save a cover. See a project with
    // `context --project <id> --render`.
    .action(async (projectId: string, opts: Record<string, unknown>, command: Command) => {
      const { client, ctx } = makeClient(command)
      const p = await client.getProject(projectId, {
        detail: opts.detail === 'full' ? 'full' : undefined,
        fromFrame: opts.from != null ? Number(opts.from) : undefined,
        toFrame: opts.to != null ? Number(opts.to) : undefined,
        trackId: typeof opts.track === 'string' ? opts.track : undefined,
        slideId: typeof opts.slide === 'string' ? opts.slide : undefined,
      })
      emit(p, ctx, () =>
        `Project ${p.id} "${p.title}" (${p.type}), revision ${p.revision}` +
        // A windowed read is part of the document; the same sentence the MCP's get_project gives.
        (p.scope ? `\n${describeScope(p.scope)}` : '') +
        // Layer geometry is in composition space, NOT the output resolution (a 2168x1152 project has a
        // 960x510 layer space). Anyone about to write ops needs this number, and the human line previously
        // printed no dimensions at all, so there was nowhere to learn it short of reading app source.
        (p.compositionSpace
          ? `\nLayer geometry space: ${p.compositionSpace.width}x${p.compositionSpace.height} (center-relative px; output resolution is ${p.width}x${p.height})` +
            `\n  Full-frame layer: layerWidth ${p.compositionSpace.width}, layerHeight ${p.compositionSpace.height}`
          : '') +
        (p.groups?.length
          ? `\nGroups: ${p.groups
              .map((g) => `${g.name || `Group ${g.ordinal ?? '?'}`} [${g.id}] (${g.memberClipIds.length} clips)`)
              .join('; ')}` +
            `\n  Rename: project apply <id> --ops '[{"op":"update_group","groupId":"...","patch":{"name":"..."}}]'`
          : ''))
    })

  project
    .command('transcript')
    .description("Read a project's transcript mapped to its timeline clips (requires editor:read)")
    .argument('<projectId>', 'the editor project id')
    .option('--search <text>', 'only clip segments whose text contains this substring')
    .option('--start <ms>', 'source-media start time in ms (with --end, filters to this window; word mode also clips words to it)', toInt)
    .option('--end <ms>', 'source-media end time in ms', toInt)
    .option('--granularity <level>', "'clip' (default) or 'word' (adds word timing + timeline frames + confidence + speaker, derived silences, audio events)")
    .option('--pace-threshold <ms>', 'word mode: minimum pause (ms) to report as a silence ("Pace"); defaults to the project setting, else 500', toInt)
    .option('--padding-start <ms>', 'word mode: breathing room (ms) kept after speech at a silence start edge (negative tightens)', toInt)
    .option('--padding-end <ms>', 'word mode: breathing room (ms) kept before speech at a silence end edge (negative tightens)', toInt)
    .action(async (projectId: string, opts: Record<string, unknown>, command: Command) => {
      const { client, ctx } = makeClient(command)
      const granularity = opts.granularity as string | undefined
      if (granularity && granularity !== 'clip' && granularity !== 'word') {
        throw new CliError("--granularity must be 'clip' or 'word'.", EXIT.USAGE)
      }
      const r = await client.getTranscript(projectId, {
        search: opts.search as string | undefined,
        startMs: opts.start as number | undefined,
        endMs: opts.end as number | undefined,
        granularity: granularity as 'clip' | 'word' | undefined,
        paceThresholdMs: opts.paceThreshold as number | undefined,
        paddingStartMs: opts.paddingStart as number | undefined,
        paddingEndMs: opts.paddingEnd as number | undefined,
      })
      emit(r, ctx, () =>
        r.mediaTranscribed
          ? `Transcript for ${r.projectId}: ${r.segmentCount} clip segment(s)${r.speakers && r.speakers.length ? `, speakers: ${r.speakers.join(', ')}` : ''}\n` +
            r.segments
              .map((s) => {
                const tag = s.disabled ? `[disabled${s.disabledReason ? `:${s.disabledReason}` : ''}]` : '[enabled]'
                const extra =
                  s.words || s.silences || s.audioEvents
                    ? ` {${s.words?.length ?? 0}w ${s.silences?.length ?? 0}sil ${s.audioEvents?.length ?? 0}ev}`
                    : ''
                return `${tag} ${s.clipId}${extra}: ${s.text || '(no speech)'}`
              })
              .join('\n')
          : (r.note ?? 'No transcript available yet.'),
      )
    })

  project
    .command('create')
    .description('Create a project (requires editor:write)')
    .option('--type <type>', "editor | canvas (default: editor)")
    .addOption(deprecatedTypeAlias())
    .option('--title <text>', "project title (default: Untitled)")
    .option('--orientation <ratio>', "e.g. 16:9, 9:16, 1:1 (default: 16:9)")
    .option('--width <n>', 'pixel width (default: from orientation)', toInt)
    .option('--height <n>', 'pixel height (default: from orientation)', toInt)
    .option('--brand-kit <id>', 'associate this brand kit with the project')
    .option('--card <id>', 'link the new project to this card in the same call (also needs planner:write)')
    .action(async (opts: Record<string, unknown>, command: Command) => {
      const { client, ctx } = makeClient(command)
      const p = await client.createProject({
        type: (opts.type ?? opts.surface) as 'editor' | 'canvas' | undefined,
        title: opts.title as string | undefined,
        orientation: opts.orientation as string | undefined,
        width: opts.width as number | undefined,
        height: opts.height as number | undefined,
        brandKitId: opts.brandKit as string | undefined,
        cardId: opts.card as string | undefined,
      })
      emit(p, ctx, () =>
        `Created ${p.type} project ${p.id} "${p.title}" (${p.orientation}), revision ${p.revision}` +
        (opts.card ? `, linked to card ${opts.card}` : ''),
      )
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
    .option('--card <id>', 'link the new project to this card in the same call (also needs planner:write)')
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
      const p = await client.importProject({ source, title: opts.title as string | undefined, cardId: opts.card as string | undefined })
      emit(p, ctx, () =>
        `Imported ${p.type} project ${p.id} "${p.title}" (${p.orientation}), revision ${p.revision}` +
        (opts.card ? `, linked to card ${opts.card}` : ''),
      )
    })

  project
    .command('export')
    .description('Export a project to a file (mp4/png/jpg both project types; pdf/pptx canvas) (requires editor:write)')
    .argument('<projectId>', 'the project id')
    .option('--format <format>', 'mp4 | png | jpg | pdf | pptx (default mp4)')
    .option('--resolution <res>', 'output resolution for ANY format: 480p|720p|1080p|2k|4k. Defaults 720p for an editor mp4, the project native size for a still. 1080p+ is plan-gated')
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
        withGraphicWarnings(
          job.status === 'completed'
            ? `Export ${job.exportId} completed: ${job.outputUrl}`
            : `Export ${job.exportId} is ${job.status}. Poll: contenthero project export-status ${job.exportId}`,
          job.warnings,
        ),
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
        withGraphicWarnings(
          job.status === 'completed' ? `completed: ${job.outputUrl}` : `${job.status}${typeof job.progress === 'number' ? ` (${Math.round(job.progress * 100)}%)` : ''}`,
          job.warnings,
        ),
      )
    })

  project
    .command('apply')
    .description(
      'Apply a batch of ops to a project composition. Ops both CREATE (create_clip, insert_track, insert_prebuilt_track, add_transition) and EDIT (move_clip, trim_clip, update_clip, delete_clip, remove_background, disable_ranges, update_transition, remove_transition, ...) and KEYFRAME ops (add_keyframe, update_keyframe, remove_keyframe, apply_combo). One-shot cleanups: remove_silence, remove_filler_words, extract_audio (see `schema timeline` for shapes). Build items from the `example` skeletons in `schema timeline` / `schema layer`; run `project get` first for the current revision and pass it as --expected-revision for safe concurrent edits. Requires editor:write.',
    )
    .argument('<projectId>', 'the project id')
    .option('--ops <json>', 'the ops as a JSON array string')
    .option('--ops-file <path>', 'read the ops JSON array from a file')
    .option('--intent <text>', 'a short description of the edit (for attribution)')
    .option('--expected-revision <n>', 'revision for optimistic concurrency (from `project get`)', toInt)
    // ⛔ No `--include-render-url` (retired 2026-10-04): an edit must not render and save a cover. See the result with
    // `context --project <id> --render`.
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
      emit(result, ctx, () => describeEditorOps(result))
      if (result.results.some((r) => !r.ok)) process.exitCode = EXIT.GENERAL
    })
}
