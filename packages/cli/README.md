# @contenthero/cli

The official ContentHero command-line interface. Generate media, run the content
pipeline, and read your brand and research context from the terminal or any agent
shell. It rides the [`@contenthero/sdk`](https://www.npmjs.com/package/@contenthero/sdk)
kernel, so it talks to the same `/api/v1` surface as the SDK and MCP server.

## Install

```bash
npm install -g @contenthero/cli
```

## Authenticate

The CLI resolves your API key in this order: the `--api-key` flag, then the
`CONTENTHERO_API_KEY` environment variable, then a stored credential.

```bash
# Bring your own key (create one in the app under API Keys):
export CONTENTHERO_API_KEY=ch_live_...
# or store it:
contenthero login --with-key ch_live_...

contenthero auth status
```

Browser-assisted login (`contenthero login`) is coming in a later release.

## Output

JSON is the default (built for agents and scripts). Add `--human` for readable
tables.

```bash
contenthero account balance
contenthero model list --type image --human
```

## Exit codes

`0` success, `1` general error, `2` usage error, `3` authentication error,
`4` timeout (the work was accepted but did not finish in time).
