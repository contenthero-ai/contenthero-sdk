
## B7: SDK, MCP and CLI read stock through list_media

Branch `media-browse-b7` of the sdk repo (worktree `contenthero-sdk-worktrees/media-browse-b7`, cut from main a51340c),
left uncommitted for the coordinator to commit. The app-repo part is W7 only (`clipMediaDescription`), committed on
`worktree-agent-af5a3858ca47156c5`. No version bump, no publish, no change to the app's pinned versions.

### Done

- SDK `types.ts`: `MEDIA_LIST_SOURCES` gains `stock`; `MEDIA_STOCK_COLLECTIONS` (photos, videos, gifs, stickers, sounds) with
  `MediaStockCollection` and `MediaStockLicense`; `ListMediaOptions` gains `collection` and `query`; `MediaSummary` gains
  `name` (every item) and the optional stock fields collection, provider, providerLabel, creator, creatorUrl,
  sourcePageUrl, license, previewUrl, width, height. Nullable as B4 made them: appUrl, status, generationSize,
  isFavorited. `client.ts` sends `collection` and `query`. `index.ts` exports the new names.
- MCP `server.ts`: list_media description (W1 and the W5 paging note appended), `source` (W2), `collection` (W3), `query`
  (W4); search_media corrected (W6). `format.ts`: a stock row prints name, `credit:` (license attribution, else
  `by {creator}`, else the provider label), collection, provider label, and `media id` to place by, then the URL; a
  library row prints the display name before the file name when it has one.
- CLI `commands/media.ts`: `--collection` (W3 verbatim) and `--query` (W4 verbatim), `--source` lists stock, an unknown
  collection is a usage error, a stock page prints ID, TYPE, COLLECTION, NAME, CREDIT; library tables show `name` first.
  `media get` tolerates a null status.

### Tests

New: sdk `client.test.ts` (stock query string), mcp `server.test.ts` (inputs forwarded, W1 to W6 wording, stock row,
display name), cli `parity-flags.test.ts` (flags reach the wire, bad collection refused, help text). Changed: the
"stock is refused" assertions (mcp, cli) now that stock is a source. The MCP/CLI parity test needed no change: it maps
`collection` and `query` to the same-named flags by its naming rule.
Results: `npm run build` (tsc for every package) clean; `npm test`: cli 187/187, mcp 401/401, sdk 179 pass, 0 fail
(180 tests, one skipped by the suite itself); `npm run check:spelling` clean.

### Notes

- The sdk repo has no `typecheck` script; its build runs tsc in each package and is the gate.
- The CLI does not require `--collection` with `--source stock`; the API refuses it with a typed 400 that says so.
- Not run: the app's vitest for the W7 test edit (the app worktree has no node_modules).

## Orientation

Follow-up to B7, uncommitted in the same worktree. No version bump, no publish.

- SDK `types.ts`: `MEDIA_STOCK_ORIENTATIONS` (landscape, portrait, square) with `MediaStockOrientation`;
  `ListMediaOptions.orientation`. `client.ts` sends it as the `orientation` query param. `index.ts` exports both names.
- MCP `server.ts`: `list_media` input `orientation` (enum), wording held once in `orientationInput`.
- CLI `commands/media.ts`: `--orientation <orientation>`, wording held once on the option; an unknown value is a usage
  error (`Invalid --orientation "x". Expected one of: landscape, portrait, square.`). Valid only with stock photos and
  videos; the CLI does not check that, the API refuses the rest with a typed 400.
- Agent-facing wording (proposal pending the owner's approval; a one-line edit in `server.ts` and `media.ts`): "Stock
  photos and videos only. Narrow the results to one shape: 'landscape', 'portrait' or 'square'. Omit it to read every
  shape." Nothing was added to the tool or flag descriptions elsewhere.
- Tests: sdk `client.test.ts`, mcp `server.test.ts`, cli `parity-flags.test.ts` (the parity test needed no change).
