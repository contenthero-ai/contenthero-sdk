# @contenthero/sdk

Official SDK for the [ContentHero](https://contenthero.ai) Studio API. Generate images, video, and audio programmatically. This is the shared kernel the ContentHero MCP and CLI sit on.

## Install

```bash
npm install @contenthero/sdk
```

Requires Node 20+ (uses the global `fetch`).

## Quick start

```ts
import { ContentHero } from '@contenthero/sdk'

const client = new ContentHero({ apiKey: process.env.CONTENTHERO_API_KEY })

// Submit and poll to completion.
const image = await client.generateAndWait({
  modelId: 'nano-banana-2',
  prompt: 'a golden retriever astronaut on the moon, cinematic',
  aspectRatio: '16:9',
})

console.log(image.outputUrls)
```

The API key (`ch_live_...`) is read from `CONTENTHERO_API_KEY` when not passed explicitly. Identity is resolved from the key server-side, so you never send a user id.

## Generation is async

On the wire, generation is always asynchronous: a submit returns immediately and you poll for the result. The SDK gives you both shapes.

```ts
// Fire-and-forget: returns as soon as the job is accepted.
const { outputId } = await client.generate({
  modelId: 'veo-3',
  prompt: 'a timelapse of a city at dusk',
  duration: 8,
  audioEnabled: true,
})

// Poll yourself, later.
const generation = await client.getGeneration(outputId)
if (generation.status === 'completed') {
  console.log(generation.outputUrls)
}
```

`generateAndWait` does the polling for you and resolves with the finished `Generation` (or throws `GenerationFailedError` / `GenerationTimeoutError`). Tune it with `{ pollIntervalMs, timeoutMs, signal }`.

Audio (ElevenLabs) is synchronous server-side, so `generate` returns `status: 'completed'` with `outputUrls` already populated.

## The request envelope

`modelId` is always required. Beyond that, a typed core of universal fields covers most needs, `references` carries image/video/frame inputs, and `parameters` is a passthrough for anything model-specific. Per-model capabilities are validated server-side, so an unsupported field for a given model comes back as a `ValidationError`.

```ts
// Image-to-image with a reference.
await client.generate({
  modelId: 'nano-banana-2',
  prompt: 'turn this into a watercolor',
  references: { images: ['https://...'] },
})

// Text-to-speech.
await client.generate({
  modelId: 'elevenlabs-tts',
  text: 'Welcome to ContentHero.',
  voiceId: 'your-voice-id',
})
```

## Balance

```ts
const { balance, tier, autoTopupEnabled } = await client.getBalance()
```

## Errors

Every non-2xx response maps to a typed error; all extend `ContentHeroError`.

| Class | Status | Meaning |
| --- | --- | --- |
| `ValidationError` | 400 | Malformed or model-unsupported request |
| `AuthenticationError` | 401 | Missing, revoked, or expired key |
| `InsufficientCreditsError` | 402 | Not enough credits (carries `balance`, `required`) |
| `PermissionError` | 403 | Key lacks the required scope |
| `NotFoundError` | 404 | Unknown generation id |
| `GenerationFailedError` | n/a | `generateAndWait` saw a terminal failure |
| `GenerationTimeoutError` | n/a | `generateAndWait` exceeded `timeoutMs` |

```ts
import { InsufficientCreditsError } from '@contenthero/sdk'

try {
  await client.generateAndWait({ modelId: 'veo-3', prompt: '...' })
} catch (err) {
  if (err instanceof InsufficientCreditsError) {
    console.error(`Need ${err.required}, have ${err.balance}`)
  }
}
```

## Configuration

```ts
new ContentHero({
  apiKey: '...',                       // or CONTENTHERO_API_KEY
  baseUrl: 'https://app.contenthero.ai', // or CONTENTHERO_BASE_URL
  fetch: customFetch,                  // optional, defaults to global fetch
})
```
