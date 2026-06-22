/**
 * `contenthero model` - the discovery catalog.
 *   model list [--type image|video|audio]   models available to this key
 *   model get <id>                          one model's full request shape
 *
 * This is the source of truth for which model ids exist and what they accept;
 * use it instead of hardcoding ids/params when scripting generation.
 */

import type { Command } from 'commander'
import { makeClient } from '../context.js'
import { emit, keyValues, table } from '../output.js'
import { CliError, EXIT } from '../errors.js'
import type { ModelInfo } from '@contenthero/sdk'

const CONTENT_TYPES = ['image', 'video', 'audio'] as const
type ContentType = (typeof CONTENT_TYPES)[number]

/** Read a possibly-absent capability field from the loosely-typed bag. */
function cap(m: ModelInfo, key: string): any {
  return (m.capabilities as Record<string, unknown>)[key]
}

/** Human duration spec, e.g. "5s|10s", "4-12s", "8s", or '' when not applicable. */
function durationSummary(d: any): string {
  if (!d || d.mode === 'none') return ''
  if (d.mode === 'locked') return `${d.value}s`
  if (d.mode === 'discrete') return Array.isArray(d.options) ? `${d.options.join('s|')}s` : ''
  if (d.mode === 'range') return `${d.min}-${d.max}s`
  return ''
}

export function registerModel(program: Command): void {
  const model = program.command('model').description('Discover the models available to your key')

  model
    .command('list')
    .description('List the models available to this key (the discovery catalog)')
    .option('--type <type>', 'filter by content type: image, video, or audio')
    .action(async (opts: { type?: string }, command: Command) => {
      if (opts.type && !CONTENT_TYPES.includes(opts.type as ContentType)) {
        throw new CliError(
          `Invalid --type "${opts.type}". Expected one of: ${CONTENT_TYPES.join(', ')}.`,
          EXIT.USAGE,
        )
      }
      const { client, ctx } = makeClient(command)
      const models = await client.listModels({ contentType: opts.type as ContentType | undefined })
      emit(models, ctx, (rows: ModelInfo[]) =>
        table(
          ['MODEL', 'TYPE', 'KIND', 'NAME'],
          rows.map((m) => [m.modelId, m.contentType, m.kind, m.displayName]),
        ),
      )
    })

  model
    .command('get')
    .description("Get one model's full request shape (the parameters it accepts)")
    .argument('<id>', 'model id (from `model list`)')
    .action(async (id: string, _opts, command: Command) => {
      const { client, ctx } = makeClient(command)
      const m = await client.getModel(id)
      emit(m, ctx, (model: ModelInfo) => {
        const res = cap(model, 'resolution')
        const ar = cap(model, 'aspectRatio')
        const gen = cap(model, 'generations')
        const audio = cap(model, 'audio')
        const dur = durationSummary(cap(model, 'duration'))
        const inputs = cap(model, 'inputTypes')
        const features = cap(model, 'features') as Record<string, boolean> | undefined
        const enabledFeatures = features ? Object.keys(features).filter((k) => features[k]) : []
        const refMax = Math.max(
          cap(model, 'maxImageRefs') ?? 0,
          cap(model, 'maxVideoRefs') ?? 0,
          cap(model, 'maxAudioRefs') ?? 0,
        )
        return keyValues([
          ['Id', model.modelId],
          ['Name', model.displayName],
          ['Type', model.contentType],
          ['Operation', model.kind],
          ...(model.isDefault ? [['Default', 'yes'] as [string, string]] : []),
          ...(model.tags.length ? [['Tags', model.tags.join(', ')] as [string, string]] : []),
          ...(model.description ? [['Description', model.description] as [string, string]] : []),
          [
            'Prompt',
            `${cap(model, 'promptMode') ?? 'optional'}${cap(model, 'promptMaxChars') ? ` (max ${cap(model, 'promptMaxChars')} chars)` : ''}`,
          ],
          ...(Array.isArray(inputs) && inputs.length ? [['Inputs', inputs.join(', ')] as [string, string]] : []),
          ...(res?.supported?.length ? [['Resolution', res.supported.join(', ')] as [string, string]] : []),
          ...(ar?.supported?.length ? [['Aspect ratio', ar.supported.join(', ')] as [string, string]] : []),
          ...(dur ? [['Duration', dur] as [string, string]] : []),
          ...(audio?.supported ? [['Audio', audio.alwaysOn ? 'always on' : 'supported'] as [string, string]] : []),
          ...(cap(model, 'negativePrompt') ? [['Negative prompt', 'supported'] as [string, string]] : []),
          ...(refMax > 0 ? [['Max references', refMax] as [string, number]] : []),
          ...(gen ? [['Generations', `${gen.min}-${gen.max} (default ${gen.default})`] as [string, string]] : []),
          ...(enabledFeatures.length ? [['Features', enabledFeatures.join(', ')] as [string, string]] : []),
          ...(model.promptReferences && model.promptReferences.scheme !== 'none'
            ? [['Referencing', `${model.promptReferences.scheme} — ${model.promptReferences.instruction}`] as [string, string]]
            : []),
        ])
      })
    })
}
