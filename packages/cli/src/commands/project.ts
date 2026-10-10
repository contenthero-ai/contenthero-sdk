/**
 * `contenthero project` - manage projects (canvas slides or editor timeline) and edit them via ops.
 *
 *   project list  [--filter <state>] [--type <t>] [--search <text>] [--sort <f>] [--order <o>]   (requires editor:read)
 *   project get   <projectId>                                            (requires editor:read)
 *   project create [--type <t>] [--title <t>] [--orientation <r>] [--width <n>] [--height <n>]
 *   project update <projectId> [--title] [--orientation] [--width] [--height] [--brand-kit] [--cover] [--cover-position]
 *                  [--fps] [--loudness] [--magnetic-track|--no-magnetic-track] [--linkage|--no-linkage] [--linked-tracks]
 *   project duplicate <projectId> [versionId]                            a copy, of a saved version when named (editor:write)
 *   project version list|create|restore|update|delete <projectId>        its version history (premium)
 *   project edit undo|redo <projectId> [--expected-revision <n>]         the editor's own undo and redo
 *   project delete <projectId> --yes                                     (permanent, requires editor:write)
 *   project import --source-type <pptx|canva> [--file-url <url>] [--design-id <id>] [--title <t>]
 *   project export <projectId> [--format mp4|png|jpg|pdf|pptx] [--resolution <r>] [--frame <n>] [--no-watermark] [--loudness <lufs|off>] [--wait]
 *   project export get <exportId>                                        one export: its file, state and details (requires editor:read)
 *   project export list <projectId> [--limit] [--cursor]                 its exports, newest first (requires editor:read)
 *   project transcript get <projectId> [--search] [--granularity] ...    its transcript (requires editor:read)
 *   project apply <projectId> --ops <json> | --ops-file <path> [--intent <text>] [--expected-revision <n>]
 *
 * Ops are the shared editor/canvas op vocabulary (the same the manual UI + in-app agent use). update_timeline
 * both CREATES and EDITS: CREATE ops (create_clip, insert_track, insert_prebuilt_track, add_transition) add
 * new clips/tracks/transitions; EDIT ops (move_clip, trim_clip, update_clip, delete_clip, remove_background,
 * disable_ranges, update_transition, remove_transition, ...) act on existing clips + transitions. CAPTION ops (add_captions,
 * update_captions, remove_captions) generate / restyle / remove transcript-driven captions.
 * Run `schema get timeline` (or `schema get layer`) first: each clip type carries a copy-pasteable `example`
 * clip skeleton and the catalog carries a `creation` section with the exact op shapes, so you know both what
 * to create and the item shape to pass. Then read `project get` for the current state + revision, and pass
 * that revision as --expected-revision for safe concurrent edits. All edits require the editor:write scope.
 */
import { readFileSync } from 'node:fs'
import { Option, type Command } from 'commander'
import {
  LIST_SORTS,
  describeEditorOps,
  describeExportShareLink,
  describeLoudness,
  describeProjectShareLink,
  describeScope,
  withCodeWarnings,
  withExportLoudness,
  type EditorOp,
  type Loudness,
  type ImportProjectSource,
  type ProjectCoverChoice,
  type ProjectListResult,
  type ProjectSort,
  type ProjectSummary,
  type ProjectVersionListResult,
  type ExportListResult,
  type SortOrder,
  type ProjectSettings,
  type ProjectWithSettings,
  type UndoResult,
  type UpdateProjectInput,
} from '@contenthero/sdk'
import { makeClient } from '../context.js'
import { emit, keyValues, table, withMore } from '../output.js'
import { CliError, EXIT } from '../errors.js'
import { isClear, toFloat, toInt, toJson, toLoudness, withPageFlags, withSortFlags } from '../args.js'

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

  withSortFlags(
    withPageFlags(
      project
        .command('list')
        .description('List projects, both editor + canvas (requires editor:read)')
        .option('--filter <state>', 'archived | favorited (omitted = active)')
        .option('--type <type>', 'editor | canvas (omitted = both)')
        .addOption(deprecatedTypeAlias())
        .option('--search <text>', 'case-insensitive title search'),
    ),
    LIST_SORTS.projects,
  )
    .action(async (opts: Record<string, unknown>, command: Command) => {
      const { client, ctx } = makeClient(command)
      const page = await client.listProjects({
        filter: opts.filter as 'archived' | 'favorited' | undefined,
        type: (opts.type ?? opts.surface) as 'editor' | 'canvas' | undefined,
        search: opts.search as string | undefined,
        sort: opts.sort as ProjectSort | undefined,
        order: opts.order as SortOrder | undefined,
        limit: opts.limit as number | undefined,
        cursor: opts.cursor as string | undefined,
      })
      emit(page, ctx, (p: ProjectListResult) =>
        p.projects.length === 0
          ? 'No projects found.'
          : withMore(p.projects.map((r) => `${r.id}  [${r.type}]  ${r.title}  ${r.orientation}`).join('\n'), p.nextCursor),
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
        (describeProjectShareLink(p.shareUrl) ? `\n${describeProjectShareLink(p.shareUrl)}` : '') +
        // Layer geometry is in composition space, NOT the output resolution (a 2168x1152 project has a
        // 960x510 layer space). Anyone about to write ops needs this number, and the human line previously
        // printed no dimensions at all, so there was nowhere to learn it short of reading app source.
        (p.compositionSpace
          ? `\nLayer geometry space: ${p.compositionSpace.width}x${p.compositionSpace.height} (center-relative px; output resolution is ${p.width}x${p.height})` +
            `\n  Full-frame layer: layerWidth ${p.compositionSpace.width}, layerHeight ${p.compositionSpace.height}`
          : '') +
        settingsText(p) +
        (p.groups?.length
          ? `\nGroups: ${p.groups
              .map((g) => `${g.name || `Group ${g.ordinal ?? '?'}`} [${g.id}] (${g.memberClipIds.length} clips)`)
              .join('; ')}` +
            `\n  Rename: project apply <id> --ops '[{"op":"update_group","groupId":"...","patch":{"name":"..."}}]'`
          : ''))
    })

  project
    .command('transcript')
    .description("A project's transcript")
    .command('get')
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
    .option('--fps <n>', 'frames per second for an editor project: 24, 25, 30, 50 or 60 (default: 30)', toInt)
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
        fps: opts.fps as 24 | 25 | 30 | 50 | 60 | undefined,
        brandKitId: opts.brandKit as string | undefined,
        cardId: opts.card as string | undefined,
      })
      emit(p, ctx, () =>
        `Created ${p.type} project ${p.id} "${p.title}" (${p.orientation}), revision ${p.revision}` +
        (opts.card ? `, linked to card ${opts.card}` : ''),
      )
    })

  project
    .command('update')
    .description("Change a project: its title, brand kit and cover, and its settings, which are the project's and shared by everyone who edits it: canvas size, and a video project's frame rate, loudness and editing settings (requires editor:write)")
    .argument('<projectId>', 'the project id')
    .option('--title <text>', 'a new title')
    .option('--orientation <ratio>', "an aspect from the editor's list, or custom; alone, it sets the size the editor gives that aspect")
    .option('--width <n>', 'a pixel width, given with --height', toInt)
    .option('--height <n>', 'a pixel height, given with --width', toInt)
    .option('--fps <n>', "a video project's frame rate; every frame number converts with it, so clips keep their timing", toInt)
    .option('--loudness <lufs|off>', "a video project's delivery loudness, a target in LUFS or off; every export follows it", toLoudness)
    .option('--magnetic-track', "turn a video project's magnetic main track on; it closes the main track's gaps")
    .option('--no-magnetic-track', "turn a video project's magnetic main track off")
    .option('--linkage', "turn a video project's linkage on: other tracks follow the main track's ripple and delete")
    .option('--no-linkage', "turn a video project's linkage off")
    .option('--linked-tracks <json>', 'which kinds of track linkage reaches, as JSON with media, audio and text booleans; a kind left out is left alone', toJson)
    .option('--brand-kit <id>', 'the brand kit to associate, or none to clear it')
    .option('--cover <choice>', 'the cover: auto (follows the composition), frame:<n> (a chosen frame or slide index), or media:<id> (a library image)', toCoverChoice)
    .option('--cover-position <x,y>', 'where the cover is framed, as percentages of its width and height, or none for the default framing')
    .action(async (projectId: string, opts: Record<string, unknown>, command: Command) => {
      const input: UpdateProjectInput = {}
      if (opts.title !== undefined) input.title = opts.title as string
      if (opts.orientation !== undefined) input.orientation = opts.orientation as string
      if (opts.width !== undefined) input.width = opts.width as number
      if (opts.height !== undefined) input.height = opts.height as number
      if (opts.brandKit !== undefined) input.brandKitId = isClear(opts.brandKit) ? null : (opts.brandKit as string)
      if (opts.cover !== undefined) input.cover = opts.cover as ProjectCoverChoice
      // Parsed here, not by commander: an option parser that returns null is read as no value.
      if (opts.coverPosition !== undefined) input.coverPosition = toCoverPosition(opts.coverPosition as string)
      if (opts.fps !== undefined) input.fps = opts.fps as UpdateProjectInput['fps']
      if (opts.loudness !== undefined) input.loudness = opts.loudness as Loudness
      if (typeof opts.magneticTrack === 'boolean') input.magneticTrack = opts.magneticTrack
      if (typeof opts.linkage === 'boolean') input.linkage = opts.linkage
      if (opts.linkedTracks !== undefined) input.linkedTracks = opts.linkedTracks as UpdateProjectInput['linkedTracks']
      if (Object.keys(input).length === 0) throw new CliError('Nothing to change: pass at least one field flag.', EXIT.USAGE)
      const { client, ctx } = makeClient(command)
      const p = await client.updateProject(projectId, input)
      emit(p, ctx, (r: ProjectWithSettings) => `Updated ${r.type} project ${r.id} "${r.title}" (${r.orientation} ${r.width}x${r.height})` + (r.fps ? `\nFrame rate: ${r.fps} fps` : '') + settingsText(r))
    })

  project
    .command('duplicate')
    .description('Copy a project: the same type, size, composition and brand kit, as it is now or from a saved version (requires editor:write)')
    .argument('<projectId>', 'the project id')
    /*
      ⚠️ A POSITIONAL, NOT `--version`. The root's `-v, --version` is a program option, and commander reads program
      options after a subcommand too, so `project duplicate p1 --version v1` printed the CLI version and copied nothing.
      The version id follows the project id, as it does in every `project version` command.
    */
    .argument('[versionId]', 'a saved version to copy from (from `project version list`); omit to copy the project as it is now')
    .action(async (projectId: string, versionId: string | undefined, _opts: Record<string, unknown>, command: Command) => {
      const { client, ctx } = makeClient(command)
      const p = await client.duplicateProject(projectId, versionId !== undefined ? { versionId } : {})
      emit(p, ctx, (r: ProjectSummary) =>
        versionId !== undefined
          ? `Created ${r.type} project ${r.id} "${r.title}" from version ${versionId} of ${projectId}`
          : `Created ${r.type} project ${r.id} "${r.title}", a copy of ${projectId}`,
      )
    })

  registerVersions(project)

  const edit = project.command('edit').description("The editor's own undo and redo")
  for (const direction of ['undo', 'redo'] as const) {
    const cmd = edit
      .command(direction)
      .description(
        direction === 'undo'
          ? "Reverse the project's most recent edit, the editor's own undo (requires editor:write)"
          : 'Re-apply the edit most recently undone, the editor\'s own redo (requires editor:write)',
      )
      .argument('<projectId>', 'the project id')
      .option('--expected-revision <n>', 'the revision you last saw; refused if the project has moved since', toInt)
    if (direction === 'undo') cmd.option('--revision <n>', 'a specific revision to reverse (default: the most recent edit)', toInt)
    cmd.action(async (projectId: string, opts: Record<string, unknown>, command: Command) => {
      const { client, ctx } = makeClient(command)
      const expectedRevision = opts.expectedRevision as number | undefined
      const r =
        direction === 'undo'
          ? await client.undo(projectId, { expectedRevision, revision: opts.revision as number | undefined })
          : await client.redo(projectId, { expectedRevision })
      emit(r, ctx, (d: UndoResult) => `${d.label}. The project is at revision ${d.revision}.`)
    })
  }

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

  const exportCommand = project
    .command('export')
    .description('Export a project to a file: video, stills, documents, and for an editor project its sound, subtitles and transcript (`contenthero schema get export` lists every format) (requires editor:write)')
    .argument('<projectId>', 'the project id')
    .option('--format <format>', 'a format `contenthero schema get export` lists (default mp4)')
    .option('--resolution <res>', 'output resolution for ANY format: 480p|720p|1080p|2k|4k. Defaults 720p for an editor mp4, the project native size for a still. 1080p+ is plan-gated')
    .option('--quality <q>', 'mp4 quality: low|recommended|high')
    .option('--frame <n>', 'editor still (png/jpg) only: timeline frame to render (default 0)', toInt)
    .option('--no-watermark', 'remove the watermark (plan-gated)')
    .option('--loudness <lufs|off>', "video and sound only: this export's loudness, a target in LUFS or off, in place of the project's own (default the project's)", toLoudness)
    .option('--max-chars-per-line <n>', 'subtitles only: longest line, 20 to 80 characters (default 42)', toInt)
    .option('--max-lines-per-card <n>', 'subtitles only: lines per card, 1 to 4 (default 2)', toInt)
    .option('--show-speakers', 'subtitles only: name who speaks, when there is more than one speaker')
    .option('--timecodes', 'transcripts only: start each paragraph with its timecode')
    .option('--wait', 'poll until the export finishes and print the URL')
    .option('--timeout <ms>', 'max wait when --wait (default 600000)', toInt)
    .action(async (projectId: string, opts: Record<string, unknown>, command: Command) => {
      const { client, ctx } = makeClient(command)
      const input = {
        format: opts.format as string | undefined,
        resolution: opts.resolution as string | undefined,
        quality: opts.quality as string | undefined,
        ...(opts.frame !== undefined ? { frame: opts.frame as number } : {}),
        ...(opts.maxCharsPerLine !== undefined ? { maxCharsPerLine: opts.maxCharsPerLine as number } : {}),
        ...(opts.maxLinesPerCard !== undefined ? { maxLinesPerCard: opts.maxLinesPerCard as number } : {}),
        ...(opts.showSpeakers ? { showSpeakers: true } : {}),
        ...(opts.timecodes ? { timecodes: true } : {}),
        // commander sets opts.watermark=false when --no-watermark is passed; leave undefined otherwise.
        ...(opts.watermark === false ? { watermark: false } : {}),
        ...(opts.loudness !== undefined ? { loudness: opts.loudness as Loudness } : {}),
      }
      const job = opts.wait
        ? await client.exportProjectAndWait(projectId, input, { timeoutMs: (opts.timeout as number | undefined) ?? 600000 })
        : await client.startExport(projectId, input)
      emit(job, ctx, () =>
        withCodeWarnings(
          job.status === 'completed'
            ? withExportLoudness(`Export ${job.exportId} completed: ${job.outputUrl}${describeExportShareLink(job.shareUrl) ? `\n${describeExportShareLink(job.shareUrl)}` : ''}`, job.loudness)
            : `Export ${job.exportId} is ${job.status}. Wait: contenthero status ${job.exportId} --kind export`,
          job.warnings,
        ),
      )
    })

  /*
    `project export <projectId>` runs the export, and `project export get` / `project export list` are its subcommands
    (get_export and list_exports). Commander dispatches to a subcommand when the first operand names one, and
    otherwise runs the export with it as the project id.
  */
  exportCommand
    .command('get')
    .description('Read one export by id: its file, state and details; wait for one with `contenthero status --kind export` (requires editor:read)')
    .argument('<exportId>', 'the export id')
    .action(async (exportId: string, _opts: Record<string, unknown>, command: Command) => {
      const { client, ctx } = makeClient(command)
      const job = await client.getExport(exportId)
      emit(job, ctx, () =>
        withCodeWarnings(
          job.status === 'completed' ? withExportLoudness(`completed: ${job.outputUrl}${describeExportShareLink(job.shareUrl) ? `\n${describeExportShareLink(job.shareUrl)}` : ''}`, job.loudness) : `${job.status}${typeof job.progress === 'number' ? ` (${Math.round(job.progress * 100)}%${job.stage ? `, ${job.stage}` : ''})` : ''}`,
          job.warnings,
        ),
      )
    })

  withPageFlags(
    exportCommand
      .command('list')
      .description("List a project's exports, newest first: finished ones with their download and share page, running ones with their status (requires editor:read)")
      .argument('<projectId>', 'the project id'),
  ).action(async (projectId: string, opts: Record<string, unknown>, command: Command) => {
    const { client, ctx } = makeClient(command)
    const page = await client.listExports(projectId, { limit: opts.limit as number | undefined, cursor: opts.cursor as string | undefined })
    emit(page, ctx, (p: ExportListResult) =>
      p.exports.length === 0
        ? 'No exports.'
        : withMore(
            table(
              ['ID', 'CREATED', 'TYPE', 'STATUS', 'TITLE', 'SHARE PAGE'],
              p.exports.map((e) => [e.exportId, e.createdAt, e.exportType ?? '', e.status, e.title ?? '', e.shareUrl ?? '']),
            ),
            p.nextCursor,
          ),
    )
  })

  project
    .command('apply')
    .description(
      'Apply a batch of ops to a project composition. Ops both CREATE (create_clip, insert_track, insert_prebuilt_track, add_transition) and EDIT (move_clip, trim_clip, update_clip, delete_clip, remove_background, disable_ranges, update_transition, remove_transition, ...) and KEYFRAME ops (add_keyframe, update_keyframe, remove_keyframe, apply_combo). One-shot cleanups: remove_silence, remove_filler_words, extract_audio. Templates: insert_template places one from `template list`, branded with the project\'s brand kit (see `schema get timeline` for shapes). Build each item from its type\'s `example`, read with `schema get timeline --name <type>` or `schema get layer --name <type>`; run `project get` first for the current revision and pass it as --expected-revision for safe concurrent edits. Requires editor:write.',
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

/** `--cover`: auto, frame:<n> or media:<id>. */
function toCoverChoice(value: string): ProjectCoverChoice {
  if (value === 'auto') return 'auto'
  const frame = /^frame:(\d+)$/.exec(value)
  if (frame) return { frame: Number(frame[1]) }
  const media = /^media:(.+)$/.exec(value)
  if (media) return { mediaId: media[1]! }
  throw new CliError(`Invalid --cover "${value}". Expected auto, frame:<n> or media:<id>.`, EXIT.USAGE)
}

/** `--cover-position`: x,y percentages, or a clear word for the default framing. */
function toCoverPosition(value: string): { x: number; y: number } | null {
  if (isClear(value)) return null
  const parts = value.split(',').map((p) => toFloat(p.trim()))
  if (parts.length !== 2) throw new CliError(`Invalid --cover-position "${value}". Expected x,y.`, EXIT.USAGE)
  return { x: parts[0]!, y: parts[1]! }
}

/**
 * A video project's delivery loudness and editing settings, a line each, as `project get` and `project update` print
 * them (the frame rate and size have their own). Empty for a canvas, which has none.
 */
function settingsText(p: ProjectSettings): string {
  const onOff = (b: boolean) => (b ? 'on' : 'off')
  return (
    (p.loudness !== undefined ? `\nDelivery loudness: ${describeLoudness(p.loudness)}` : '') +
    (p.magneticTrack !== undefined && p.linkage !== undefined && p.linkedTracks
      ? `\nEditing: magnetic main track ${onOff(p.magneticTrack)}, linkage ${onOff(p.linkage)}` +
        (p.linkage ? `, reaching ${Object.entries(p.linkedTracks).filter(([, on]) => on).map(([kind]) => kind).join(', ') || 'no'} tracks` : '')
      : '')
  )
}


function registerVersions(project: Command): void {
  const version = project.command('version').description("A project's version history (premium, as in the editor)")

  withPageFlags(
    version
      .command('list')
      .description("List a project's saved versions, newest first (requires editor:read)")
      .argument('<projectId>', 'the project id'),
  ).action(async (projectId: string, opts: Record<string, unknown>, command: Command) => {
    const { client, ctx } = makeClient(command)
    const page = await client.listProjectVersions(projectId, { limit: opts.limit as number | undefined, cursor: opts.cursor as string | undefined })
    emit(page, ctx, (p: ProjectVersionListResult) =>
      p.versions.length === 0
        ? 'No saved versions.'
        : withMore(
            table(
              ['ID', 'SAVED', 'LABEL', 'BY', 'REVISION'],
              p.versions.map((v) => [v.id, v.createdAt, v.label ?? '', v.authorName ?? '', v.revision ?? '']),
            ),
            p.nextCursor,
          ),
    )
  })

  version
    .command('create')
    .description("Save the project's current state as a new version (requires editor:write)")
    .argument('<projectId>', 'the project id')
    .option('--label <text>', 'a name for the version')
    .action(async (projectId: string, opts: Record<string, unknown>, command: Command) => {
      const { client, ctx } = makeClient(command)
      const v = await client.createProjectVersion(projectId, { label: opts.label as string | undefined })
      emit(v, ctx, () => `Saved version ${v.id}${v.label ? ` "${v.label}"` : ''}.`)
    })

  version
    .command('restore')
    .description('Put a version back into its project; the current state is saved as a version first. To make a new project from a version, use `project duplicate <projectId> <versionId>` (requires editor:write)')
    .argument('<projectId>', 'the project id')
    .argument('<versionId>', 'the version id (from `project version list`)')
    .action(async (projectId: string, versionId: string, _opts: Record<string, unknown>, command: Command) => {
      const { client, ctx } = makeClient(command)
      const r = await client.restoreProjectVersion(projectId, versionId)
      emit(r, ctx, () => `Restored version ${versionId}. The project is at revision ${r.revision}.`)
    })

  version
    .command('update')
    .description('Name a version; an empty label clears its name (requires editor:write)')
    .argument('<projectId>', 'the project id')
    .argument('<versionId>', 'the version id (from `project version list`)')
    .requiredOption('--label <label>', 'the new name; empty clears it')
    .action(async (projectId: string, versionId: string, opts: Record<string, unknown>, command: Command) => {
      const { client, ctx } = makeClient(command)
      const v = await client.updateProjectVersion(projectId, versionId, { label: opts.label as string })
      emit(v, ctx, () => (v.label ? `Version ${v.id} is now "${v.label}".` : `Version ${v.id} has no name.`))
    })

  version
    .command('delete')
    .description('Remove a version (requires editor:write)')
    .argument('<projectId>', 'the project id')
    .argument('<versionId>', 'the version id (from `project version list`)')
    .action(async (projectId: string, versionId: string, _opts: Record<string, unknown>, command: Command) => {
      const { client, ctx } = makeClient(command)
      await client.deleteProjectVersion(projectId, versionId)
      emit({ deleted: true, versionId }, ctx, () => `Deleted version ${versionId}.`)
    })
}
