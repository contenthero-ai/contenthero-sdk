/**
 * `contenthero schema <kind>` - read a vocabulary another command accepts. The CLI twin of the MCP's `get_schema`
 * (agreed 2026-09-28): one reference command replaced `platform list`, `platform get`, `project export-formats`,
 * `project layer-types` and `project timeline-types`.
 *
 *   schema commands [command...]                 the CLI's own command inputs as JSON, scoped to a path such as
 *                                                `generate image` (no API key needed: it reflects over the tree)
 *   schema platform [--platform p] [--format f]  the platforms you can publish to, or one platform's post shape
 *   schema timeline [--json-schema]              editor clip + track types, with copy-pasteable `example` skeletons
 *   schema layer [--json-schema]                 canvas layer types and their fields
 *   schema export                                export formats per project type
 *   schema link                                  the link contract: how to build any app address from a noun + id
 *   schema graphic                               the authoring guide for a graphic's code, as one document
 *
 * timeline, layer, export and graphic require editor:read.
 */

import type { Command, Option } from 'commander'
import { globalsOf, makeClient } from '../context.js'
import { emit, keyValues, table } from '../output.js'
import type { PlatformSummary, PlatformSchema } from '@contenthero/sdk'
import { CliError, EXIT } from '../errors.js'

interface ArgSchema {
  name: string
  required: boolean
  variadic: boolean
  description?: string
}
interface OptionSchema {
  flags: string
  description?: string
  required: boolean
  takesValue: boolean
  default?: unknown
}
interface CommandSchema {
  command: string
  description: string
  arguments: ArgSchema[]
  options: OptionSchema[]
}

/** Subcommands minus the auto-added `help`. */
function realSubcommands(cmd: Command): Command[] {
  return cmd.commands.filter((c) => c.name() !== 'help')
}

function describeOption(o: Option): OptionSchema {
  const schema: OptionSchema = {
    flags: o.flags,
    required: o.mandatory === true,
    takesValue: o.required === true || o.optional === true,
  }
  if (o.description) schema.description = o.description
  if (o.defaultValue !== undefined) schema.default = o.defaultValue
  return schema
}

function describe(cmd: Command, path: string): CommandSchema {
  const args = (cmd.registeredArguments ?? []).map((a): ArgSchema => {
    const schema: ArgSchema = { name: a.name(), required: a.required, variadic: a.variadic }
    if (a.description) schema.description = a.description
    return schema
  })
  return {
    command: path,
    description: cmd.description(),
    arguments: args,
    options: cmd.options.map(describeOption),
  }
}

/** Collect every leaf (action-bearing) command, with its full space-joined path. */
function collectLeaves(cmd: Command, prefix: string[]): CommandSchema[] {
  const out: CommandSchema[] = []
  for (const sub of realSubcommands(cmd)) {
    const path = [...prefix, sub.name()]
    if (realSubcommands(sub).length === 0) {
      out.push(describe(sub, path.join(' ')))
    } else {
      out.push(...collectLeaves(sub, path))
    }
  }
  return out
}

const KINDS = ['commands', 'platform', 'timeline', 'layer', 'export', 'link', 'graphic'] as const
type Kind = (typeof KINDS)[number]

export function registerSchema(program: Command): void {
  program
    .command('schema')
    .description('Read a vocabulary another command accepts: commands, platform, timeline, layer, export, link or graphic')
    .argument('<kind>', `which vocabulary: ${KINDS.join(', ')}`)
    .argument('[command...]', 'kind commands only: a command path to scope the dump, e.g. "generate image"')
    .option('--platform <platform>', 'kind platform only: the platform to read; omit to list every platform')
    .option('--format <format>', 'kind platform with --platform only: narrow to one format (e.g. reel, short, story)')
    .option('--json-schema', "kinds timeline and layer only: also return each type's full JSON Schema (large)")
    .action(async (kind: string, parts: string[], opts: { platform?: string; format?: string; jsonSchema?: boolean }, command: Command) => {
      if (!(KINDS as readonly string[]).includes(kind)) {
        throw new CliError(`Unknown kind "${kind}". Use one of: ${KINDS.join(', ')}.`, EXIT.USAGE)
      }
      const k = kind as Kind
      // A kind's inputs are refused, not ignored, exactly as the MCP's get_schema refuses them.
      if (k !== 'commands' && parts.length) throw new CliError(`kind ${k} takes no command path.`, EXIT.USAGE)
      if (k !== 'platform' && (opts.platform || opts.format)) {
        throw new CliError(`kind ${k} takes no --platform or --format; those belong to kind platform.`, EXIT.USAGE)
      }
      if (opts.format && !opts.platform) throw new CliError('--format narrows one platform: pass --platform with it.', EXIT.USAGE)
      if (opts.jsonSchema && k !== 'timeline' && k !== 'layer') {
        throw new CliError(`kind ${k} takes no --json-schema; it belongs to kinds timeline and layer.`, EXIT.USAGE)
      }
      if (k === 'commands') {
        const target = parts.join(' ')
        const all = collectLeaves(program, [])
        const commands = target
          ? all.filter((c) => c.command === target || c.command.startsWith(target + ' '))
          : all
        if (target && commands.length === 0) {
          throw new CliError(`No command matches "${target}". Run \`contenthero schema commands\` for the full list.`, EXIT.USAGE)
        }

        const globalOptions = program.options.map(describeOption)
        const data = { globalOptions, commands }
        const { json } = globalsOf(command)
        emit(data, { json }, (d: typeof data) =>
          d.commands
            .map((c) => {
              const argline = c.arguments.map((a) => (a.required ? `<${a.name}>` : `[${a.name}]`)).join(' ')
              const opts = c.options.map((o) => `    ${o.flags}${o.description ? `  - ${o.description}` : ''}`)
              return [`contenthero ${c.command}${argline ? ' ' + argline : ''}`, ...opts].join('\n')
            })
            .join('\n\n'),
        )
        return
      }
      const { client, ctx } = makeClient(command)
      if (k === 'platform' && !opts.platform) {
        const platforms = await client.listPlatforms()
        emit(platforms, ctx, (rows: PlatformSummary[]) =>
          table(
            ['PLATFORM', 'NAME', 'FORMATS', 'CONNECTED'],
            rows.map((p) => [
              p.platform,
              p.name,
              p.formats.map((f) => f.value).join(', '),
              p.connected ? 'yes' : 'no',
            ]),
          ),
        )
        return
      }
      if (k === 'platform') {
        const p = await client.getPlatform(opts.platform!, { format: opts.format })
        emit(p, ctx, (schema: PlatformSchema) => {
          const fieldRows = schema.formats.map(
            (fmt) =>
              [fmt, Object.keys(schema.fieldTemplatesByFormat[fmt] ?? {}).join(', ') || '(none)'] as [
                string,
                string,
              ],
          )
          const enumRows = Object.entries(schema.enums).map(
            ([k, vals]) =>
              [
                k,
                vals
                  .map((v) =>
                    v && typeof v === 'object' && 'id' in (v as Record<string, unknown>)
                      ? String((v as Record<string, unknown>).id)
                      : String(v),
                  )
                  .join(', '),
              ] as [string, string],
          )
          const limitRows = schema.characterLimits
            ? Object.entries(schema.characterLimits).map(([k, n]) => [k, String(n)] as [string, string])
            : []
          return keyValues([
            ['Platform', schema.platform],
            ['Name', schema.name],
            ['Formats', schema.formats.join(', ')],
            ['Posting modes', schema.postingModes.join(', ')],
            ...fieldRows.map(([fmt, fields]) => [`Fields (${fmt})`, fields] as [string, string]),
            ...enumRows.map(([k, vals]) => [`Options (${k})`, vals] as [string, string]),
            ...limitRows.map(([k, n]) => [`Limit (${k})`, n] as [string, string]),
          ])
        })
        return
      }
      if (k === 'timeline') {
        const cat = await client.getTimelineTypes({ jsonSchema: opts.jsonSchema })
        emit(cat, ctx, () => {
          const clips = cat.clipTypes.map((t) => `${t.type}: ${t.props.map((p) => p.name).join(', ')}`).join('\n')
          const tracks = cat.trackTypes.map((t) => `${t.trackType} holds ${t.holds.join(', ')}`).join('\n')
          const creation = cat.creation
            ? `\n\nCreate ops:\n${cat.creation.ops.map((o) => `${o.op}: ${o.shape}`).join('\n')}\n(each clip type carries an \`example\` skeleton; use --json to see them)`
            : ''
          return `Clips:\n${clips}\n\nTracks:\n${tracks}${creation}`
        })
        return
      }
      if (k === 'layer') {
        const cat = await client.getLayerTypes({ jsonSchema: opts.jsonSchema })
        emit(cat, ctx, () => cat.layerTypes.map((t) => `${t.type}: ${t.props.map((p) => p.name).join(', ')}`).join('\n'))
        return
      }
      if (k === 'graphic') {
        // The document the app renders, printed as is (the MCP prints the same one); --json gives the structured fields.
        const guide = await client.getGraphicGuide()
        emit(guide, ctx, () => guide.markdown.trimEnd())
        return
      }
      if (k === 'link') {
        const f = await client.getLinkFormats()
        emit(f, ctx, () =>
          [
            `${f.grammar.join('\n')}\norigin: ${f.origin}`,
            table(['NOUN', 'OPENS', 'TABS'], f.nouns.map((n) => [`/${n.noun}/{id}`, n.opens, n.tabs?.join('|') ?? ''])),
            table(['SECTION', 'OPENS', 'TABS'], f.sections.map((s) => [`/${s.section}`, s.opens, s.tabs.join('|')])),
          ].join('\n\n'),
        )
        return
      }
      const cat = await client.getExportFormats()
      emit(cat, ctx, () => cat.formats.map((f) => `${f.format} (${f.projectTypes.join('/')}): ${f.description}`).join('\n'))
    })
}
