# @contenthero/cli

The official ContentHero command-line interface. Generate media, run the content
pipeline, and read your brand and research context from the terminal or any agent
shell. It rides the [`@contenthero/sdk`](https://www.npmjs.com/package/@contenthero/sdk)
kernel, so it talks to the same `/api/v1` surface as the SDK and the
[MCP server](https://www.npmjs.com/package/@contenthero/mcp).

Built agent-first: JSON by default, predictable exit codes, and a `schema` command
so an agent can discover every command's inputs without docs.

## Install

```bash
npm install -g @contenthero/cli
```

Requires Node 20+. The binary is `contenthero`.

## Authenticate

The CLI resolves your API key in this order: the `--api-key` flag, then the
`CONTENTHERO_API_KEY` environment variable, then a stored credential.

```bash
# Browser-assisted (recommended): opens your browser, mints a key for this machine
contenthero login

# Bring your own key (CI / headless): create one in the app under API Keys
export CONTENTHERO_API_KEY=ch_live_...
# ...or store it:
contenthero login --with-key ch_live_...     # or: echo "$KEY" | contenthero login --with-key

contenthero auth status        # verify the active key and show the account
contenthero logout             # remove the stored credential
```

The stored credential lives at `~/.contenthero/credentials` (mode 0600). The env
var always wins over the stored file, so CI can override a local login.

## Output

JSON is the default (built for agents and scripts). Add `--human` for readable
tables and key/value output.

```bash
contenthero account balance
contenthero model list --type image --human
```

## Generate

`generate` covers image, video, audio, board, and lip-sync. The waitable kinds
share `--cost` (preflight, charges nothing), `--wait` / `--no-wait` (default
waits), and `--timeout <seconds>`.

```bash
# Preflight the cost, then generate and wait for the URLs
contenthero generate image "a red ceramic cube on white" --model nano-banana-2 --cost
contenthero generate image "a red ceramic cube on white" --model nano-banana-2

# Submit without blocking, then poll
ID=$(contenthero generate video "drone shot over a canyon" --model veo-3.1-fast --no-wait | jq -r .outputId)
contenthero generation status "$ID"
contenthero generation wait "$ID" --timeout 300

# Chain: feed a previous output id straight in as a reference (URL or output id)
contenthero generate video "slow zoom in" --model veo-3.1-fast --start-frame "$ID"

# Audio (synchronous) and upscaling
contenthero generate audio --model elevenlabs-tts --text "Hello there" --voice <voiceId>
contenthero upscale "$ID" --model topaz-image-upscale --factor 2x
```

Exit code 4 means a render was accepted but did not finish before the timeout. The
`outputId` is still emitted, so you can keep polling.

## The rest of the surface

```
contenthero project      list | get | create | delete | import | export | export-status
                         | export-formats | layer-types | timeline-types | apply
contenthero media        list | get <id>
contenthero post         list | get | create | update | archive | schedule | publish
                         | destination add|update | asset add
contenthero pipeline     stages
contenthero brand-kit    list | get | update | archive | section add|update|archive
contenthero avatar       list | get <id>
contenthero voice        list | get <id>
contenthero inspiration  accounts | account <id> | outliers | content <id>
contenthero brand-account     list | performance <id>
contenthero connected-account list | get <id>
contenthero account      balance
contenthero model        list
```

## For agents

`schema` dumps every command's arguments and options as JSON, so an agent can wire
up calls without reading these docs:

```bash
contenthero schema                 # the whole surface
contenthero schema generate image  # just one command
```

## Exit codes

`0` success, `1` general error, `2` usage error, `3` authentication error,
`4` timeout (the work was accepted but did not finish in time).
