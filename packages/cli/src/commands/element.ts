/**
 * `contenthero element` - the reusable reference-element library (Kling 3.0).
 *   element list                              the account's saved elements
 *   element get <id>                          one element
 *   element create --name --description ...   create from images or a video
 *   element update <id> [--name ...]          update metadata
 *   element delete <id>                       remove
 *
 * An element is a named group of images (a character, prop, location) referenced
 * in a Kling prompt as @name. Create one, then pass its id to `generate video`.
 */

import type { Command } from 'commander'
import { makeClient } from '../context.js'
import { emit, table, keyValues } from '../output.js'
import { collect } from '../args.js'
import { CliError, EXIT } from '../errors.js'
import type { Element } from '@contenthero/sdk'

const CATEGORIES = ['auto', 'character', 'location', 'prop'] as const

function detail(e: Element): string {
  return keyValues([
    ['Id', e.id],
    ['Name', e.name],
    ['Category', e.category],
    ...(e.description ? [['Description', e.description] as [string, string]] : []),
    ...(e.input_video_url
      ? [['Video', e.input_video_url] as [string, string]]
      : [['Images', String(e.input_urls.length)] as [string, string]]),
  ])
}

export function registerElement(program: Command): void {
  const element = program.command('element').description('Your reusable reference elements (Kling 3.0)')

  element
    .command('list')
    .description('List your saved reference elements')
    .action(async (_opts, command: Command) => {
      const { client, ctx } = makeClient(command)
      const elements = await client.listElements()
      emit(elements, ctx, (rows: Element[]) =>
        table(
          ['ID', 'NAME', 'CATEGORY', 'MEDIA'],
          rows.map((e) => [e.id, e.name, e.category, e.input_video_url ? '1 video' : `${e.input_urls.length} images`]),
        ),
      )
    })

  element
    .command('get')
    .description('Get one reference element by id')
    .argument('<id>', 'element id')
    .action(async (id: string, _opts, command: Command) => {
      const { client, ctx } = makeClient(command)
      emit(await client.getElement(id), ctx, detail)
    })

  element
    .command('create')
    .description('Create a reference element from 2-4 images (or 1 video)')
    .requiredOption('--name <name>', 'referenced in the prompt as @name')
    .requiredOption('--description <text>', 'what the element represents')
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
        const created = await client.createElement({
          name: opts.name,
          description: opts.description,
          category: opts.category,
          images: opts.image,
          video: opts.video,
        })
        emit(created, ctx, detail)
      },
    )

  element
    .command('update')
    .description("Update an element's name, description, or category")
    .argument('<id>', 'element id')
    .option('--name <name>')
    .option('--description <text>')
    .option('--category <category>', 'auto | character | location | prop')
    .action(
      async (id: string, opts: { name?: string; description?: string; category?: string }, command: Command) => {
        if (opts.category && !CATEGORIES.includes(opts.category as (typeof CATEGORIES)[number])) {
          throw new CliError(`Invalid --category "${opts.category}". Expected one of: ${CATEGORIES.join(', ')}.`, EXIT.USAGE)
        }
        const { client, ctx } = makeClient(command)
        emit(await client.updateElement(id, opts), ctx, detail)
      },
    )

  element
    .command('delete')
    .description('Delete a reference element')
    .argument('<id>', 'element id')
    .action(async (id: string, _opts, command: Command) => {
      const { client, ctx } = makeClient(command)
      emit(await client.deleteElement(id), ctx, (r: { deleted: boolean; id: string }) => `Deleted element ${r.id}.`)
    })
}
