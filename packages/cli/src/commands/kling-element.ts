/**
 * `contenthero kling-element` - the reusable Kling element library (Kling 3.0).
 *   kling-element list                              the account's saved Kling elements
 *   kling-element get <id>                          one Kling element
 *   kling-element create --name --description ...   create from images or a video
 *   kling-element update <id> [--name ...]          update metadata
 *   kling-element delete <id>                       remove
 *
 * A Kling element is a named group of images (a character, prop, location) referenced
 * in a Kling prompt as @name. Create one, then pass its id to `generate video --kling-element`.
 *
 * ⚠️ `element` was this command's name until 2026-10-04, when the word also named the editor's Elements panel
 * (templates). It answers for one release window as a HIDDEN alias: the same subcommands, registered by the
 * same function onto a second parent, so the two cannot drift. Delete that mount when the window closes.
 */

import type { Command } from 'commander'
import { makeClient } from '../context.js'
import { emit, table, keyValues, linkRow, displayId } from '../output.js'
import { collect } from '../args.js'
import { CliError, EXIT } from '../errors.js'
import type { KlingElement } from '@contenthero/sdk'

const CATEGORIES = ['auto', 'character', 'location', 'prop'] as const

function detail(e: KlingElement): string {
  return keyValues([
    ['Id', displayId(e)], ...linkRow(e),
    ['Name', e.name],
    ['Category', e.category],
    ...(e.description ? [['Description', e.description] as [string, string]] : []),
    ...(e.input_video_url
      ? [['Video', e.input_video_url] as [string, string]]
      : [['Images', String(e.input_urls.length)] as [string, string]]),
  ])
}

export function registerKlingElement(program: Command): void {
  addKlingElementCommands(program.command('kling-element').description('Your reusable Kling elements (Kling 3.0)'))
  addKlingElementCommands(program.command('element', { hidden: true }).description('deprecated alias for kling-element'))
}

function addKlingElementCommands(group: Command): void {
  group
    .command('list')
    .description('List your saved Kling elements')
    .action(async (_opts, command: Command) => {
      const { client, ctx } = makeClient(command)
      const klingElements = await client.listKlingElements()
      emit(klingElements, ctx, (rows: KlingElement[]) =>
        table(
          ['ID', 'NAME', 'CATEGORY', 'MEDIA'],
          rows.map((e) => [e.id, e.name, e.category, e.input_video_url ? '1 video' : `${e.input_urls.length} images`]),
        ),
      )
    })

  group
    .command('get')
    .description('Get one Kling element by id')
    .argument('<id>', 'Kling element id')
    .action(async (id: string, _opts, command: Command) => {
      const { client, ctx } = makeClient(command)
      emit(await client.getKlingElement(id), ctx, detail)
    })

  group
    .command('create')
    .description('Create a Kling element from 2-4 images (or 1 video)')
    .requiredOption('--name <name>', 'referenced in the prompt as @name')
    .requiredOption('--description <text>', 'what the Kling element represents')
    .option('--category <category>', 'auto | character | location | prop', 'auto')
    .option('--image <urlOrId>', 'image URL or output id; repeatable (2-4)', collect)
    .option('--video <urlOrId>', 'a single video URL or output id (alternative to images)')
    .action(
      async (
        opts: { name: string; description: string; category: string; image?: string[]; video?: string },
        command: Command,
      ) => {
        if (!CATEGORIES.includes(opts.category as (typeof CATEGORIES)[number])) {
          throw new CliError(`Invalid --category "${opts.category}". Expected one of: ${CATEGORIES.join(', ')}.`, EXIT.USAGE)
        }
        if (!opts.image?.length && !opts.video) {
          throw new CliError('Provide --image (2-4 times) or --video.', EXIT.USAGE)
        }
        const { client, ctx } = makeClient(command)
        const created = await client.createKlingElement({
          name: opts.name,
          description: opts.description,
          category: opts.category,
          images: opts.image,
          video: opts.video,
        })
        emit(created, ctx, detail)
      },
    )

  group
    .command('update')
    .description("Update a Kling element's name, description, or category")
    .argument('<id>', 'Kling element id')
    .option('--name <name>')
    .option('--description <text>')
    .option('--category <category>', 'auto | character | location | prop')
    .action(
      async (id: string, opts: { name?: string; description?: string; category?: string }, command: Command) => {
        if (opts.category && !CATEGORIES.includes(opts.category as (typeof CATEGORIES)[number])) {
          throw new CliError(`Invalid --category "${opts.category}". Expected one of: ${CATEGORIES.join(', ')}.`, EXIT.USAGE)
        }
        const { client, ctx } = makeClient(command)
        emit(await client.updateKlingElement(id, opts), ctx, detail)
      },
    )

  group
    .command('delete')
    .description('Delete a Kling element')
    .argument('<id>', 'Kling element id')
    .action(async (id: string, _opts, command: Command) => {
      const { client, ctx } = makeClient(command)
      emit(await client.deleteKlingElement(id), ctx, (r: { deleted: boolean; id: string }) => `Deleted Kling element ${r.id}.`)
    })
}
