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
contenthero account get
contenthero model list --type image --human
```

## Generate

`generate` covers image, video, audio, board, and lip-sync. The waitable kinds
share `--cost` (preflight, charges nothing), `--wait` / `--no-wait` (default
waits), and `--timeout <seconds>`.

```bash
# Model ids come from `contenthero model list`
# Preflight the cost, then generate and wait for the URLs
contenthero generate image "a red ceramic cube on white" --model <imageModelId> --cost
contenthero generate image "a red ceramic cube on white" --model <imageModelId>

# Submit without blocking, then poll
ID=$(contenthero generate video "drone shot over a canyon" --model <videoModelId> --no-wait | jq -r .outputId)
contenthero status "$ID" --no-wait
contenthero status "$ID" --timeout 300

# Chain: feed a previous output id straight in as a reference (URL or output id)
contenthero generate video "slow zoom in" --model <videoModelId> --start-frame "$ID"

# Audio (synchronous) and upscaling
contenthero generate audio --model <audioModelId> --text "Hello there" --voice <voiceId>
contenthero upscale "$ID" --model <upscaleModelId> --factor 2x
```

Exit code 4 means a render was accepted but did not finish before the timeout. The
`outputId` is still emitted, so you can keep polling.

## The rest of the surface

Each command is named after the MCP tool it runs (`project export get` is `get_export`, `post publish` is
`publish_post`), so what an agent learns on one surface reads the same on the other.

```
contenthero view               see what the user is looking at; render, hear or watch your work; see a raw clip
contenthero project            list | get | create | update | duplicate | share | delete | import | apply
                               | export | export get|list | transcript get | edit undo|redo
                               | settings get|update | version list|save|restore|update|delete
contenthero media              list | search | get | zoom | upload | share | import
contenthero status             <ids...> [--kind <kind>]: where any background job is
contenthero card               list | get | create | update
contenthero post               publish
contenthero tag                list | create | update | delete
contenthero stage              list | create | update | delete
contenthero space              list | get | create | update | delete
contenthero folder             list | get | create | update | delete
contenthero brand-kit          list | get | create | extract | update | knowledge list|get|search|add|remove
contenthero template           list | get | create | update | delete
contenthero kling-element      list | get | create | update | delete
contenthero avatar             list | get | create | update | delete | look add|remove
contenthero voice              list | get
contenthero audio              isolate | enhance | enhance-clips
contenthero content            list | get | analyze
contenthero tracked-account    list | get | update
contenthero connected-account  list | get
contenthero account            get | update
contenthero model              list | get
contenthero schema             get
```

## For agents

`schema get commands` dumps every command's arguments and options as JSON, so an agent
can wire up calls without reading these docs:

```bash
contenthero schema get commands                 # the whole surface
contenthero schema get commands generate image  # just one command
```

## Exit codes

`0` success, `1` general error, `2` usage error, `3` authentication error,
`4` timeout (the work was accepted but did not finish in time), `5` a limit refused it (credits, the monthly
spend cap, storage, a plan limit; nothing ran and nothing was charged). In JSON mode a limit error also carries its
`code` and ranked `actions`.
