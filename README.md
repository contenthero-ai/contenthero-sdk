# ContentHero SDK

The official developer platform for [ContentHero](https://contenthero.ai): programmatic image, video, and audio generation, plus reads and execution across the platform.

This monorepo holds the public packages:

| Package | What it is |
|---|---|
| [`@contenthero/sdk`](./packages/sdk) | The TypeScript kernel: a thin, typed client over the ContentHero `/api/v1` surface. |
| [`@contenthero/mcp`](./packages/mcp) | The MCP server: ContentHero tools for any MCP client (Claude, Cursor, and others), built on the SDK. |

The CLI (`@contenthero/cli`) lands here next.

## Install

```bash
npm install @contenthero/sdk
# or run the MCP server directly
npx -y @contenthero/mcp
```

## Quick start (SDK)

```ts
import { ContentHero } from '@contenthero/sdk'

const ch = new ContentHero({ apiKey: process.env.CONTENTHERO_API_KEY })

// Estimate first, then generate.
const { creditsEstimate } = await ch.estimateCost({ modelId: 'nano-banana-2', prompt: 'a neon city at dusk' })
const result = await ch.generateAndWait({ modelId: 'nano-banana-2', prompt: 'a neon city at dusk' })
console.log(result.outputUrls)
```

Get an API key in the ContentHero app under Developer settings.

## License

MIT
