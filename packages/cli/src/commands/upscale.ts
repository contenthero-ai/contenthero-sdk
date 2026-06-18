/**
 * `contenthero upscale <source>` - upscale an existing image or video.
 *
 * Whether the source is bucketed as an image or a video reference depends on the
 * model, so we resolve the model's content type from the discovery catalog first
 * (rather than asking the user to declare it). Video upscalers also price on the
 * source duration, so --duration is required for them.
 */

import type { Command } from 'commander'
import type { GenerateRequest } from '@contenthero/sdk'
import { makeClient } from '../context.js'
import { compact, runGeneration } from '../generation.js'
import { CliError, EXIT } from '../errors.js'
import { toFloat, toInt } from '../args.js'

const DEFAULT_TIMEOUT_SEC = 600

export function registerUpscale(program: Command): void {
  program
    .command('upscale')
    .description('Upscale an existing image or video to a higher resolution')
    .argument('<source>', 'source media (URL or output id) to upscale')
    .requiredOption('-m, --model <id>', 'upscale model id (see `contenthero model list`)')
    .requiredOption('--factor <factor>', 'upscale factor, e.g. 2x, 4x (model-dependent)')
    .option('--duration <seconds>', 'source video length in seconds (required for video upscalers)', toFloat)
    .option('--cost', 'estimate the credit cost instead of upscaling')
    .option('--no-wait', 'return the outputId immediately instead of waiting')
    .option('--timeout <seconds>', 'how long to wait before handing back the outputId', toInt, DEFAULT_TIMEOUT_SEC)
    .action(async (source: string, opts: Record<string, unknown>, command: Command) => {
      const { client, ctx } = makeClient(command)

      // Resolve the model so we bucket the source correctly and validate it is
      // actually an upscaler. listModels is the discovery source of truth.
      const modelId = opts.model as string
      const models = await client.listModels()
      const model = models.find((m) => m.modelId === modelId)
      if (!model) {
        throw new CliError(
          `Unknown model "${modelId}". See \`contenthero model list\`.`,
          EXIT.USAGE,
        )
      }
      if (model.kind !== 'upscale') {
        throw new CliError(
          `Model "${modelId}" is a ${model.kind} model, not an upscaler.`,
          EXIT.USAGE,
        )
      }

      const isVideo = model.contentType === 'video'
      if (isVideo && opts.duration == null) {
        throw new CliError('Video upscalers require --duration <seconds> for pricing.', EXIT.USAGE)
      }

      const request = compact<GenerateRequest>({
        contentType: isVideo ? 'video' : 'image',
        modelId,
        upscaleFactor: opts.factor as string,
        duration: isVideo ? (opts.duration as number) : undefined,
        references: isVideo ? { videos: [source] } : { images: [source] },
      })
      await runGeneration(client, ctx, request, {
        cost: opts.cost === true,
        wait: opts.wait !== false,
        timeoutSec: (opts.timeout as number) ?? DEFAULT_TIMEOUT_SEC,
      })
    })
}
