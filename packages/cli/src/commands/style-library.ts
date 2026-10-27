/**
 * `contenthero style-library` - shared code that projects pin and import.
 *   style-library list [--archived --search]         the account's style libraries
 *   style-library get <name> [--at-version n]           one, with its versions, or one version with its code
 *   style-library create <name> [--module ...]       create one, and publish its first version when modules are sent
 *   style-library update <name> [--module ...]       publish the next version, edit the description, or both
 *
 * There is no delete. Archive one with `contenthero archive style-library <id>`.
 * The words are the SDK's approved tool texts, the same on every surface.
 */

import { readFileSync } from 'node:fs'
import type { Command } from 'commander'
import {
  LIST_SORTS,
  optionFromContract,
  type ContractToolName,
  toolDescription,
  type SortOrder,
  type StyleLibrary,
  type StyleLibraryDetail,
  type StyleLibraryListResult,
  type StyleLibraryModuleEntry,
  type StyleLibraryPublishSources,
  type StyleLibrarySort,
  type StyleLibraryWithVersion,
} from '@contenthero/sdk'
import { makeClient } from '../context.js'
import { emit, table, keyValues, clip, withMore } from '../output.js'
import { collect, toInt, withPageFlags, withSortFlags } from '../args.js'
import { CliError, EXIT } from '../errors.js'

/** `name=path` as two parts; a usage error when either is missing. */
function pair(flag: string, value: string): [string, string] {
  const at = value.indexOf('=')
  if (at < 1 || at === value.length - 1) throw new CliError(`${flag} takes <name>=<file>, got "${value}".`, EXIT.USAGE)
  return [value.slice(0, at), value.slice(at + 1)]
}

/** The publish sources a create or an update sends, from its flags. Only the flags given. */
function sourcesFrom(opts: Record<string, unknown>): StyleLibraryPublishSources {
  const sources: StyleLibraryPublishSources = {}
  const modules: Record<string, StyleLibraryModuleEntry> = {}
  // Code is many lines, and a shell argument is no place for it: every module is read from a file.
  for (const value of (opts.module as string[] | undefined) ?? []) {
    const [name, file] = pair('--module', value)
    modules[name] = { code: readFileSync(file, 'utf8') }
  }
  for (const value of (opts.edits as string[] | undefined) ?? []) {
    const [name, file] = pair('--edits', value)
    modules[name] = { edits: JSON.parse(readFileSync(file, 'utf8')) as unknown }
  }
  for (const name of (opts.dropModule as string[] | undefined) ?? []) modules[name] = null
  if (Object.keys(modules).length) sources.modules = modules
  if (opts.notes !== undefined) sources.notes = opts.notes as string
  const projectModules = opts.projectModule as string[] | undefined
  if (opts.fromProject !== undefined) {
    if (!projectModules?.length) throw new CliError('--from-project goes with at least one --project-module.', EXIT.USAGE)
    sources.fromProject = {
      projectId: opts.fromProject as string,
      modules: projectModules,
      ...(opts.projectRevision !== undefined ? { revision: opts.projectRevision as number } : {}),
    }
  } else if (projectModules !== undefined || opts.projectRevision !== undefined) {
    throw new CliError('--project-module and --project-revision go with --from-project.', EXIT.USAGE)
  }
  return sources
}

/** The flags a create and an update share: what a publish is made of. */
function withPublishFlags(command: Command): Command {
  return command
    .option('--notes <text>', opt('create_style_library', 'notes'))
    .option('--module <name=file>', 'a module by name, its whole code read from a file; repeatable', collect)
    .option('--from-project <projectId>', opt('create_style_library', 'fromProject'))
    .option('--project-module <name>', 'a module of --from-project to publish; repeatable', collect)
    .option('--project-revision <n>', 'the revision of --from-project the modules are read at', toInt)
}

function row(l: StyleLibrary): Array<string | number> {
  return [l.name, l.id, l.latestVersion ?? '-', l.updatedAt, l.archivedAt ? 'archived' : '', clip(l.description ?? '', 40)]
}

function written(verb: string) {
  return (l: StyleLibrary) =>
    `${verb} style library "${l.name}" (${l.id}), ${l.latestVersion === null ? 'no version published' : `latest version ${l.latestVersion}`}.`
}

/** A flag's words, read from the agent contract's input of the tool it mirrors. */
const opt = (tool: ContractToolName, path: string): string => optionFromContract(tool, path).description

export function registerStyleLibrary(program: Command): void {
  const group = program.command('style-library').description('Style libraries: shared code that projects pin and import')

  withSortFlags(
    withPageFlags(
      group
        .command('list')
        .description(toolDescription('list_style_libraries'))
        .option('--archived', opt('list_style_libraries', 'archived'))
        .option('--search <text>', opt('list_style_libraries', 'search')),
    ),
    LIST_SORTS.styleLibraries,
  ).action(async (opts: Record<string, unknown>, command: Command) => {
    const { client, ctx } = makeClient(command)
    const page = await client.listStyleLibraries({
      archived: opts.archived ? true : undefined,
      search: opts.search as string | undefined,
      sort: opts.sort as StyleLibrarySort | undefined,
      order: opts.order as SortOrder | undefined,
      limit: opts.limit as number | undefined,
      cursor: opts.cursor as string | undefined,
    })
    emit(page, ctx, (p: StyleLibraryListResult) =>
      withMore(table(['NAME', 'ID', 'VERSION', 'UPDATED', 'FLAGS', 'DESCRIPTION'], p.styleLibraries.map(row)), p.nextCursor),
    )
  })

  withPageFlags(
    group
      .command('get')
      .description(toolDescription('get_style_library'))
      .argument('<name>', opt('get_style_library', 'name'))
      .option('--at-version <n>', opt('get_style_library', 'version'), toInt),
  ).action(async (name: string, opts: Record<string, unknown>, command: Command) => {
    const { client, ctx } = makeClient(command)
    const result =
      opts.atVersion === undefined
        ? await client.getStyleLibrary(name, { limit: opts.limit as number | undefined, cursor: opts.cursor as string | undefined })
        : await client.getStyleLibrary(name, { version: opts.atVersion as number })
    emit(result, ctx, (l: StyleLibraryDetail | StyleLibraryWithVersion) => {
      if ('versions' in l) {
        return withMore(
          [
            keyValues([
              ['Id', l.id],
              ['Name', l.name],
              ['Description', l.description ?? ''],
              ['Latest version', l.latestVersion ?? '-'],
              ['Updated', l.updatedAt],
              ...(l.archivedAt ? [['Archived', l.archivedAt] as [string, string]] : []),
            ]),
            '',
            table(
              ['VERSION', 'CREATED', 'NOTES', 'MODULES'],
              l.versions.map((v) => [v.version, v.createdAt, clip(v.notes ?? '', 60), v.modules.map((m) => m.name).join(', ')]),
            ),
            '',
            l.pinnedBy.length ? `Pinned by: ${l.pinnedBy.map((p) => `${p.title ?? p.projectId} (${p.projectId}, version ${p.version})`).join('; ')}` : 'Pinned by no project.',
          ].join('\n'),
          l.versionsNextCursor,
        )
      }
      return [
        `${l.name} (${l.id}), version ${l.version.version}${l.version.notes ? `: ${l.version.notes}` : ''}`,
        ...Object.entries(l.version.code).map(([module, code]) => `\nmodule ${module}:\n${code}`),
      ].join('\n')
    })
  })

  withPublishFlags(
    group
      .command('create')
      .description(toolDescription('create_style_library'))
      .argument('<name>', opt('get_style_library', 'name'))
      .option('--description <text>', opt('create_style_library', 'description')),
  ).action(async (name: string, opts: Record<string, unknown>, command: Command) => {
    const sources = sourcesFrom(opts)
    const { client, ctx } = makeClient(command)
    const created = await client.createStyleLibrary({
      name,
      ...(opts.description !== undefined ? { description: opts.description as string } : {}),
      ...sources,
    })
    emit(created, ctx, written('Created'))
  })

  withPublishFlags(
    group
      .command('update')
      .description(toolDescription('update_style_library'))
      .argument('<name>', opt('get_style_library', 'name'))
      .option('--description <text>', opt('create_style_library', 'description'))
      .option('--clear-description', 'remove the description')
      .option('--base-version <n>', opt('update_style_library', 'baseVersion'), toInt)
      .option('--edits <name=file>', "a module's edits against --base-version, read from a JSON file; repeatable", collect)
      .option('--drop-module <name>', 'a module to drop; repeatable', collect),
  ).action(async (name: string, opts: Record<string, unknown>, command: Command) => {
    if (opts.description !== undefined && opts.clearDescription) {
      throw new CliError('Give --description or --clear-description, not both.', EXIT.USAGE)
    }
    const sources = sourcesFrom(opts)
    const { client, ctx } = makeClient(command)
    const updated = await client.updateStyleLibrary(name, {
      ...(opts.clearDescription ? { description: null } : opts.description !== undefined ? { description: opts.description as string } : {}),
      ...(opts.baseVersion !== undefined ? { baseVersion: opts.baseVersion as number } : {}),
      ...sources,
    })
    emit(updated, ctx, written('Updated'))
  })
}
