# @contenthero/mcp

Official [ContentHero](https://contenthero.ai) MCP server. Generate images, video, and audio from any MCP client (Claude Code, Claude Desktop, ...) using your ContentHero API key.

## Tools

| Tool | What it does |
| --- | --- |
| `generate_image` | Generate images from a prompt (or image-to-image). Waits for the result and returns the URLs. |
| `generate_video` | Generate video from a prompt (or start/end frame, references). Waits up to ~75s, then returns an `outputId` to poll if the render is still running. |
| `generate_audio` | ElevenLabs speech (TTS), music, or sound effects. Synchronous: returns the audio URL directly. |
| `check_generation` | Poll an image/video `outputId` to its final URLs. |
| `get_balance` | Current credit balance, tier, and auto-top-up state. |

Three intent-shaped generate tools (not one `generate_media`): image and video share the async smart-wait lifecycle, audio shares almost nothing and runs synchronously, and per-tool `modelId` enums keep each schema clean.

## Setup

Requires Node 20+. You need a ContentHero API key (`ch_live_...`).

### Claude Code

```bash
claude mcp add contenthero --env CONTENTHERO_API_KEY=ch_live_xxx -- npx -y @contenthero/mcp
```

### Claude Desktop / generic MCP config

```json
{
  "mcpServers": {
    "contenthero": {
      "command": "npx",
      "args": ["-y", "@contenthero/mcp"],
      "env": { "CONTENTHERO_API_KEY": "ch_live_xxx" }
    }
  }
}
```

### Environment

| Variable | Required | Default |
| --- | --- | --- |
| `CONTENTHERO_API_KEY` | yes | - |
| `CONTENTHERO_BASE_URL` | no | `https://app.contenthero.ai` |

## Usage

Once connected, just ask in natural language. The agent picks the tool and model:

> "Generate a 16:9 image of a golden retriever astronaut with nano-banana-2."

> "Make an 8 second video of a city at dusk with audio using veo-3.1-fast."

> "Read this script aloud with ElevenLabs voice `<id>`."

Images return in one turn (~15s). Video either returns inline or hands back an `outputId`; the agent then calls `check_generation` to fetch the final URLs. Insufficient credits, invalid parameters, and unknown models come back as readable tool errors.

## How it works

This server is a thin wrapper over [`@contenthero/sdk`](https://www.npmjs.com/package/@contenthero/sdk), which talks to the ContentHero `/api/v1` surface. Your API key resolves your account server-side; the server never sends a user id. Pricing is computed server-side.
