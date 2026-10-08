/**
 * `contenthero template` - the editor's Elements: reusable code, shapes and animated emoji.
 *   template list [--scope ...] [--kind ...]        ContentHero's and your own, without their code
 *   template get <id>                               one template, with its code and controls
 *   template create [--from-item <id> ...] ...      save one of your own
 *   template update <id> [--expected-version n]     change one of your own
 *   template delete <id>                            delete one of your own
 *
 * Place a template with an `insert_template` op (`project apply`), branded with the project's brand kit.
 */

import { readFileSync } from 'node:fs'
import type { Command } from 'commander'
import { makeClient } from '../context.js'
import { emit, table, keyValues, withMore } from '../output.js'
import { collect, toFloat, toInt, toJson, withPageFlags } from '../args.js'
import { CliError, EXIT } from '../errors.js'
import type { Template, TemplateFields, TemplateListResult, TemplateSummary, TemplateWriteResult } from '@contenthero/sdk'

const SCOPES = ['system', 'user', 'all'] as const
const KINDS = ['code', 'shape', 'emoji'] as const

/** A template's own size: a share of the canvas on each axis, or the whole frame. */
function box(t: TemplateSummary): string {
  return t.coverage === 'partial' && t.widthFraction && t.heightFraction
    ? `${Math.round(t.widthFraction * 100)}% x ${Math.round(t.heightFraction * 100)}%`
    : 'full frame'
}

function detail(t: Template): string {
  return [
    keyValues([
      ['Id', t.id],
      ['Name', t.name],
      ['Kind', t.kind],
      ['Category', t.category],
      ['Whose', t.scope === 'system' ? 'ContentHero' : 'yours'],
      ['Version', t.version],
      ['Size', box(t)],
      ['Frames', t.durationFrames],
      ...(t.archivedAt ? [['Archived', t.archivedAt] as [string, string]] : []),
      ...(t.sourceTemplateId ? [['Saved from', `${t.sourceTemplateId} (version ${t.sourceTemplateVersion})`] as [string, string]] : []),
      ['Props', JSON.stringify(t.props)],
    ]),
    ...(t.code ? ['', t.code] : []),
  ].join('\n')
}

function written(verb: string) {
  return (r: TemplateWriteResult) =>
    [`${verb} template "${r.template.name}" (${r.template.id}), version ${r.template.version}.`, ...r.warnings.map((w) => `warning: ${w}`)].join('\n')
}

/** The fields a create or an update sets, from its flags. Only the flags given. */
function fieldsFrom(opts: Record<string, unknown>): TemplateFields {
  const fields: TemplateFields = {}
  if (opts.name !== undefined) fields.name = opts.name as string
  if (opts.category !== undefined) fields.category = opts.category as string
  if (opts.description !== undefined) fields.description = opts.description as string
  if (opts.tag !== undefined) fields.tags = opts.tag as string[]
  // Its code, from a file: code is many lines, and a shell argument is no place for it.
  if (opts.code !== undefined) fields.code = readFileSync(opts.code === '-' ? 0 : (opts.code as string), 'utf8')
  if (opts.lottie !== undefined) {
    const recolor = ((opts.recolor as string[] | undefined) ?? []).map((pair) => {
      const [from, role] = pair.split('=')
      if (!from || !role) throw new CliError(`--recolor takes <hex>=<prop>, got "${pair}".`, EXIT.USAGE)
      return { from, role }
    })
    fields.lottie = { url: opts.lottie as string, ...(recolor.length ? { recolor } : {}) }
  } else if (opts.recolor !== undefined) {
    throw new CliError('--recolor goes with --lottie.', EXIT.USAGE)
  }
  if (opts.emoji !== undefined) fields.emoji = opts.emoji as string
  if (opts.shape !== undefined) fields.shape = opts.shape as string
  if (opts.props !== undefined) fields.props = opts.props as Record<string, unknown>
  if (opts.propsSchema !== undefined) fields.propsSchema = opts.propsSchema as Record<string, unknown>
  if (opts.durationFrames !== undefined) fields.durationFrames = opts.durationFrames as number
  if (opts.coverage !== undefined) fields.coverage = opts.coverage as 'full' | 'partial'
  if (opts.widthFraction !== undefined) fields.widthFraction = opts.widthFraction as number
  if (opts.heightFraction !== undefined) fields.heightFraction = opts.heightFraction as number
  if (opts.resize !== undefined) fields.resize = opts.resize as 'scale' | 'reflow'
  if (opts.aspect !== undefined) fields.aspect = opts.aspect as number
  return fields
}

/** The flags a create and an update share: a template's fields. */
function withFieldFlags(command: Command): Command {
  return command
    .option('--name <name>', 'its name in the Elements panel')
    .option('--category <category>', 'its category: one `template list` shows, or a new one')
    .option('--description <text>', 'what it is for')
    .option('--tag <tag>', 'a word it is found by; repeatable', collect)
    .option('--code <file>', "its code, read from a file ('-' for stdin)")
    .option('--lottie <url>', 'a Lottie file of ours')
    .option('--recolor <hex=prop>', 'a color in the Lottie file that a prop recolors; repeatable', collect)
    .option('--emoji <name>', "an animated emoji's name, as the animated emoji list names it")
    .option('--shape <name>', "a shape's name, as `schema layer` lists them")
    .option('--props <json>', 'its props as placed, as a JSON object', toJson)
    .option('--props-schema <json>', "each prop's control, as a JSON object (as `template get --json` shows them)", toJson)
    .option('--duration-frames <n>', 'how long it lasts when placed, in frames', toInt)
    .option('--coverage <coverage>', 'full (the whole frame) | partial (a box of --width-fraction by --height-fraction)')
    .option('--width-fraction <n>', "its default width, a fraction of the canvas's", toFloat)
    .option('--height-fraction <n>', "its default height, a fraction of the canvas's", toFloat)
    .option('--resize <resize>', 'scale (keeps its proportions) | reflow (lays out again in its box)')
    .option('--aspect <n>', 'its own width over height, for --resize scale', toFloat)
}

export function registerTemplate(program: Command): void {
  const group = program.command('template').description("Templates: the editor's Elements (code, shapes, animated emoji)")

  withPageFlags(
    group
      .command('list')
      .description("List ContentHero's templates and your own, without their code")
      .option('--scope <scope>', 'system | user | all (default all)')
      .option('--kind <kind>', 'code | shape | emoji')
      .option('--category <category>', 'only this category; repeatable', collect)
      .option('--search <text>', 'every word, in any order, in the name or the tags')
      .option('--archived', 'only archived templates, to restore one'),
  )
    .action(async (opts: { scope?: string; kind?: string; category?: string[]; search?: string; archived?: boolean; cursor?: string; limit?: number }, command: Command) => {
      if (opts.scope && !SCOPES.includes(opts.scope as (typeof SCOPES)[number])) {
        throw new CliError(`Invalid --scope "${opts.scope}". Expected one of: ${SCOPES.join(', ')}.`, EXIT.USAGE)
      }
      if (opts.kind && !KINDS.includes(opts.kind as (typeof KINDS)[number])) {
        throw new CliError(`Invalid --kind "${opts.kind}". Expected one of: ${KINDS.join(', ')}.`, EXIT.USAGE)
      }
      const { client, ctx } = makeClient(command)
      const page = await client.listTemplates({
        scope: opts.scope as (typeof SCOPES)[number] | undefined,
        kind: opts.kind as (typeof KINDS)[number] | undefined,
        category: opts.category,
        search: opts.search,
        archived: opts.archived ? 'only' : undefined,
        cursor: opts.cursor,
        limit: opts.limit,
      })
      emit(page, ctx, (p: TemplateListResult) =>
        withMore(
          table(
            ['ID', 'NAME', 'KIND', 'CATEGORY', 'WHOSE', 'VERSION', 'SIZE'],
            p.templates.map((t) => [t.id, t.name, t.kind, t.category, t.scope === 'system' ? 'ContentHero' : 'yours', t.version, box(t)]),
          ),
          p.nextCursor,
        ),
      )
    })

  group
    .command('get')
    .description('Get one template, with its code and controls')
    .argument('<id>', 'template id')
    .action(async (id: string, _opts, command: Command) => {
      const { client, ctx } = makeClient(command)
      emit(await client.getTemplate(id), ctx, detail)
    })

  withFieldFlags(
    group
      .command('create')
      .description('Save a template of your own: from a placed code clip, code layer or shape, as a copy of a template, or from its fields')
      .option('--from-item <itemId>', 'a code clip, code layer or shape placed on a project (with --from-project)')
      .option('--from-project <projectId>', 'the project --from-item is on')
      .option('--from-template <templateId>', 'a template to copy, keeping its lineage'),
  ).action(async (opts: Record<string, unknown>, command: Command) => {
    if ((opts.fromItem === undefined) !== (opts.fromProject === undefined)) {
      throw new CliError('--from-item and --from-project go together.', EXIT.USAGE)
    }
    if (opts.fromItem !== undefined && opts.fromTemplate !== undefined) {
      throw new CliError('Give one source: --from-item, --from-template, or the fields alone.', EXIT.USAGE)
    }
    const fields = fieldsFrom(opts)
    const { client, ctx } = makeClient(command)
    const result = await client.createTemplate(
      opts.fromItem !== undefined
        ? { ...fields, fromItem: { projectId: opts.fromProject as string, itemId: opts.fromItem as string } }
        : opts.fromTemplate !== undefined
          ? { ...fields, fromTemplateId: opts.fromTemplate as string }
          : fields,
    )
    emit(result, ctx, written('Saved'))
  })

  withFieldFlags(
    group
      .command('update')
      .description('Change one of your own templates: only the flags given')
      .argument('<id>', 'template id')
      .option('--expected-version <n>', 'the version you read; refused if it changed since', toInt),
  ).action(async (id: string, opts: Record<string, unknown>, command: Command) => {
    const { client, ctx } = makeClient(command)
    const result = await client.updateTemplate(id, fieldsFrom(opts), { expectedVersion: opts.expectedVersion as number | undefined })
    emit(result, ctx, written('Updated'))
  })

  group
    .command('delete')
    .description('Delete one of your own templates (clips placed from it keep everything)')
    .argument('<id>', 'template id')
    .action(async (id: string, _opts, command: Command) => {
      const { client, ctx } = makeClient(command)
      emit(await client.deleteTemplate(id), ctx, (r: { deleted: boolean; id: string }) => `Deleted template ${r.id}.`)
    })
}
