/**
 * `contenthero schema [command...]` - dump the input schema of the CLI's commands
 * as JSON, so an agent can discover argument and option shapes without docs (our
 * analog to HeyGen's `--request-schema`). With no argument it dumps every leaf
 * command; with a path (e.g. `schema generate image`) it dumps just that subtree.
 *
 * Needs no API key: it reflects over the command tree, it does not call the API.
 */

import type { Command, Option } from 'commander'
import { globalsOf } from '../context.js'
import { emit } from '../output.js'
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

export function registerSchema(program: Command): void {
  program
    .command('schema')
    .description('Dump the input schema of the CLI commands as JSON (for agents)')
    .argument('[command...]', 'a command path to scope the dump, e.g. "generate image"')
    .action((parts: string[], _opts, command: Command) => {
      const target = parts.join(' ')
      const all = collectLeaves(program, [])
      const commands = target
        ? all.filter((c) => c.command === target || c.command.startsWith(target + ' '))
        : all
      if (target && commands.length === 0) {
        throw new CliError(`No command matches "${target}". Run \`contenthero schema\` for the full list.`, EXIT.USAGE)
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
    })
}
