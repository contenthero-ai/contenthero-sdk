/**
 * The model's brand glyph, chosen by `icon_key` from the registry.
 *
 * ## ⛔ THE KEY COMES FROM THE DATABASE, NOT FROM THE MODEL ID
 *
 * `model_providers.icon_key` is a BRAND FAMILY (`openai`, `kling`, `bytedance`), not a model id, and it is
 * edited in the admin switchboard with no deploy. Nine ElevenLabs models share one key; eight Kling models
 * share another. Deriving the glyph from the id instead would need a new entry per model and would miss
 * every model added after the last publish, which is precisely what this package cannot ship a fix for
 * quickly.
 *
 * ⚠️ So an UNKNOWN key renders nothing rather than guessing. The chip still shows the model's name and its
 * brand color, both of which also come from the registry, so a new brand is degraded rather than broken.
 *
 * ## Why the Mono submodule and not the package root
 *
 * ⭐⭐ MEASURED: importing these 16 brands from `@lobehub/icons` costs **284,966 bytes** minified, because
 * the root component pulls the color, brand, avatar and combine variants along with it. Importing
 * `@lobehub/icons/es/<Brand>/components/Mono` costs **57,039 bytes**, five times less, and Mono is what we
 * actually want: a single-path glyph filled with `currentColor`, so one component serves both themes by
 * inheriting the pill's text color instead of hardcoding white.
 *
 * ⚠️ This bundle ships inside the published package as ONE self-contained HTML string, so every byte here
 * is paid by every person who installs the MCP server. That is the reason to check the number rather than
 * assume an icon set is small.
 */
import type { ComponentType } from 'react'
import NanoBanana from '@lobehub/icons/es/NanoBanana/components/Mono'
import OpenAI from '@lobehub/icons/es/OpenAI/components/Mono'
import Midjourney from '@lobehub/icons/es/Midjourney/components/Mono'
import Flux from '@lobehub/icons/es/Flux/components/Mono'
import TopazLabs from '@lobehub/icons/es/TopazLabs/components/Mono'
import Recraft from '@lobehub/icons/es/Recraft/components/Mono'
import Gemini from '@lobehub/icons/es/Gemini/components/Mono'
import Sora from '@lobehub/icons/es/Sora/components/Mono'
import Kling from '@lobehub/icons/es/Kling/components/Mono'
import ElevenLabs from '@lobehub/icons/es/ElevenLabs/components/Mono'
import Qwen from '@lobehub/icons/es/Qwen/components/Mono'
import BriaAI from '@lobehub/icons/es/BriaAI/components/Mono'
import ByteDance from '@lobehub/icons/es/ByteDance/components/Mono'
import Grok from '@lobehub/icons/es/Grok/components/Mono'
import Ideogram from '@lobehub/icons/es/Ideogram/components/Mono'
import AlibabaCloud from '@lobehub/icons/es/AlibabaCloud/components/Mono'
import { LAUREL_PATHS, LAUREL_VIEW_BOX } from '@contenthero-ai/brand-ui'

type Glyph = ComponentType<{ size?: number | string }>

function Laurel({ size = 14 }: { size?: number | string }) {
  return (
    <svg viewBox={LAUREL_VIEW_BOX} width={size} height={size} fill="currentColor">
      {LAUREL_PATHS.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  )
}

/**
 * Every `icon_key` the registry holds that this bundle can draw.
 *
 * ⚠️ FOUR KEYS ARE DELIBERATELY ABSENT: `infinity`, `gem` and `auphonic` are not brand marks lobehub
 * carries, and `auphonic` in particular is an SVG we authored that lives in the app repo. Copying it here
 * would make a second copy of a shape with no mechanism keeping the two in sync, which is the exact problem
 * `@contenthero-ai/brand-ui` was created to stop. It belongs in that package on the day a second surface
 * needs it, not before. Between them those keys cover 4 models of the 66 in the registry, and each still
 * renders its name and brand color.
 */
const GLYPHS: Record<string, Glyph> = {
  'nano-banana': NanoBanana,
  openai: OpenAI,
  midjourney: Midjourney,
  flux: Flux,
  topaz: TopazLabs,
  recraft: Recraft,
  gemini: Gemini,
  sora: Sora,
  kling: Kling,
  elevenlabs: ElevenLabs,
  qwen: Qwen,
  bria: BriaAI,
  bytedance: ByteDance,
  grok: Grok,
  ideogram: Ideogram,
  'alibaba-cloud': AlibabaCloud,
  laurel: Laurel,
}

/**
 * ⚠️ **THE LOBEHUB SVGS EMBED A `<title>`, WHICH THE BROWSER SHOWS AS A NATIVE TOOLTIP.** Hovering the
 * glyph would pop up the brand name next to the model name already printed beside it. `pointer-events: none`
 * makes the glyph unhoverable so the tooltip never fires, and clicks pass through to whatever is underneath.
 */
export function ModelGlyph({ iconKey, size = 13 }: { iconKey?: string | null; size?: number }) {
  const Icon = iconKey ? GLYPHS[iconKey] : undefined
  if (!Icon) return null
  return (
    <span style={{ pointerEvents: 'none', display: 'inline-flex', lineHeight: 1 }}>
      <Icon size={size} />
    </span>
  )
}
