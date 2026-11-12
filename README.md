# ContentHero SDK

The official developer platform for [ContentHero](https://contenthero.ai): programmatic image, video, and audio generation, plus reads and execution across the platform.

This monorepo holds the public packages:

| Package | What it is |
|---|---|
| [`@contenthero/sdk`](./packages/sdk) | The TypeScript kernel: a thin, typed client over the ContentHero `/api/v1` surface. |
| [`@contenthero/mcp`](./packages/mcp) | The MCP server: ContentHero tools for any MCP client (Claude, Cursor, and others), built on the SDK. |
| [`@contenthero/cli`](./packages/cli) | The command-line interface: `contenthero <noun> <verb>` from any terminal or agent shell, built on the SDK. |

## Install

```bash
npm install @contenthero/sdk
# run the MCP server directly
npx -y @contenthero/mcp
# install the CLI
npm install -g @contenthero/cli
```

## Quick start (SDK)

```ts
import { ContentHero } from '@contenthero/sdk'

const ch = new ContentHero({ apiKey: process.env.CONTENTHERO_API_KEY })

// Model ids come from `listModels()` (the `list_models` MCP tool).
// Estimate first, then generate.
const { creditsEstimate } = await ch.estimateCost({ modelId: '<imageModelId>', prompt: 'a neon city at dusk' })
const result = await ch.generateAndWait({ modelId: '<imageModelId>', prompt: 'a neon city at dusk' })
console.log(result.outputUrls)
```

Get an API key in the ContentHero app under Developer settings.

## About this repository

This repository is a read-only mirror of the public packages. The source of truth is ContentHero's private monorepo, and
every change to these folders is copied here automatically. Install from npm, as shown above. The packages use workspace
versions that only resolve inside the monorepo, so `npm install` in a clone of this repository will not work. Bug reports
and questions are welcome as issues; pull requests cannot be merged here.

## License

MIT
