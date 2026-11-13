# @contenthero/mcp

Official [ContentHero](https://contenthero.ai) MCP server. Generate images, video, and audio from any MCP client (Claude Code, Claude Desktop, ...) using your ContentHero API key.

## Tools

| Tool | What it does |
| --- | --- |
| `generate_image` | Generate images from a prompt (or image-to-image). Waits for the result and returns the URLs. |
| `generate_video` | Generate video from a prompt (or start/end frame, references). Returns at once with an `outputId`; `get_status` waits for the render. |
| `generate_audio` | ElevenLabs speech (TTS), music, or sound effects. Synchronous: returns the audio URL directly. |
| `get_status` | Wait for any background job by the id that started it (a generation's `outputId` gives its final URLs). |
| `get_account` | Your ContentHero account: balance, spend this month, the monthly spend cap, plan and auto top-up. |
| `update_account` | Change an account setting (today: the monthly spend cap). |

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

> "Generate a 16:9 image of a golden retriever astronaut with `<imageModelId>`."

> "Make an 8 second video of a city at dusk with audio using `<videoModelId>`."

> "Read this script aloud with ElevenLabs voice `<id>`."

Images return in one turn (~15s). Video either returns inline or hands back an `outputId`; the agent then calls `get_status` to fetch the final URLs. Insufficient credits, invalid parameters, and unknown models come back as readable tool errors.

## How it works

This server is a thin wrapper over [`@contenthero/sdk`](https://www.npmjs.com/package/@contenthero/sdk), which talks to the ContentHero `/api/v1` surface. Your API key resolves your account server-side; the server never sends a user id. Pricing is computed server-side.

## Image controls and discovery

The existing `generate_image` tool accepts `quality`, `outputFormat`, `background`, `frameCount`, `frameDurationMs`, and `frameSize`. Read `list_models` and `get_model` for each model's current choices, defaults, setting conditions, reference and transparency formats, and GIF sheet rules. Use numeric or string frame counts according to the declared control. Send GIF fields only for GIF output. `getCost` previews the same request without generating. Server refusals retain their specific message.


## Video draft controls

Discover the model declaration before generating. Model lists and details include accepted inputs, input modes, the declared Draft resolution, and upgrade resolution and availability when declared. Upgrade a completed draft owned by the caller while it remains available. Shot settings are inherited and cannot change. The server enforces ownership, completion, expiration and whether the selected draft output already has an upgrade.

`generate_video` accepts `draft`, `upgradeFromOutputId`, `upgradeSlot`, `outputFormat` and `returnLastFrame`. Draft and upgrade output options map to the API parameters bag. Source identifiers remain top level. Pass `getCost` to preview the same request without generating.

`generate_image` and `generate_video` run every model of their medium, and the model decides the work: upscale, background removal, layer separation and lip sync included. Sources go in `referenceImages` or `referenceVideos`. Read `get_model` first, which names the tool and the inputs the model takes. For a lip-sync model on `generate_video`, supply `referenceImages` for a model declaring `singleImage`, or `referenceVideos` for a model declaring `singleVideo`. Add `referenceAudio`, or `script` with `voiceId`. Pass `getCost` to preview the same request. The server validates the source required by the model.
