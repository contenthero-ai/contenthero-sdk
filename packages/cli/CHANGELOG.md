# Changelog

## Unreleased

- Breaking: `preview` is removed with the preview video. `context --render` with `--from-frame`, `--to-frame` and
  `--count` renders frames across a range, which is how an agent judges motion.
- The help names the API's renamed scopes: `brand:write`, `library:write`, and `inspiration:write` for
  `tracked-account update`.
- Breaking: every hand-arranged list moves by `--after <id>`, `--before <id>` or `--position top|bottom`, one wording
  from `withPlacementFlags`: `card create` and `card update`, `stage create` and `stage update`, `brand-kit update`
  (the kit among yours), `avatar update`, `template create` and `template update`. `stage update` loses `--to-start` and
  `--to-end` (use `--position top` or `bottom`).
- Breaking: `brand-kit reorder` is removed (the API refuses the whole-list reorder); move one kit with `brand-kit update`.
- New: `tracked-account update <id>` moves a tracked account within its list.
- New: `folder update --move-item <ref>` with `--move-after`, `--move-before` or `--move-position` moves one item in a
  manual folder. `brand-kit update --sections` entries may carry `afterId`, `beforeId` or `position`.
- `card list --sort position` reads one stage's own order (with `--stage`).

- `brand-kit create` and `brand-kit update` take `--display-logo <ref>`: one of the `--logo` refs, sent as that logo's
  `isDisplay`, the logo for the kit's compact places.
- Breaking: `--json` output follows the API's camelCase response fields (templates, Kling elements, brand kit media,
  project versions, `movedCards` on `stage delete`).
- Breaking: no manual position. `stage list` and `stage delete` drop their ORDER column (the rows are the board's
  order), `stage update` prints the stage and its `--json` is the stage alone (no `respaced`).
- `brand-kit create --logo` sends `isPrimary` (was `is_primary`) on the first logo only; `--asset` entries carry none.

- Breaking: `media list` follows the library-file contract. `--source` is `all` (the default), `creations`, `uploads`
  or `exports` (`stock` is refused); `--type` takes `image`, `video`, `audio`, `doc` and `other`, comma-separated
  (`transcript` is refused); `--kind` is `creation`, `board` or `look` (no `upload`: use `--source uploads`); `--status`
  is gone (a listed file is always completed). It takes `--sort` (`createdAt`, `fileName`, `sizeBytes`) and `--order`.
  `--favorite` and `--archived` apply to every file. `--human` shows each file's source and size.
- Breaking: every sortable list (`card list`, `project list`, `space list`, `content list`) takes `--sort` (a field the
  API declares for that list) and `--order` (`asc` | `desc`); a field the list does not have is a usage error.
  `content list` loses `--asc`, and its sort fields are the API's: `relevance` (with `--search` only), `outlierScore`,
  `publishedAt`, `viewCount` and `engagementRate` (were `score`, `date`, `views`, `engagement`).
- Breaking: every growable list pages. `tag list`, `avatar list`, `voice list`, `brand-kit list`, `kling-element list`,
  `connected-account list`, `tracked-account list`, `stage list`, `space list` and `folder list` take `--limit` and
  `--cursor`, end their `--human` output with `More: --cursor <cursor>` when a next page exists, and print the whole
  page under `--json` (items under their own key, and `nextCursor`), where most printed a plain array before.
- Breaking: `space list --archived` lists only archived spaces (it included them before); `space list` gains
  `--favorite` and `--search`. A space's card count is `cardCount` in `--json` (was `postCount`).
- `card list` takes `--tag`, and `--space all` for every space.
- New: `project update` (title, orientation, size, `--brand-kit`, `--cover`, `--cover-position`), `project duplicate`,
  `project settings get|update` (a video project's timeline settings), `project version list|save|restore|copy|rename|delete`
  (the version history), and `project undo` / `project redo`.
- Requires the unreleased `@contenthero/sdk` (sort and order, the paged lists, the new project methods).

## 0.3.21

- Breaking: the clip type `graphic` is retired and renamed `code`: a code clip or code layer is a video, audio or image
  whose content is code. `template list --kind` takes `code` (was `graphic`), and `schema code` prints the code guide
  (was `schema graphic`); the old values are refused.
- Breaking: the error code `GRAPHIC_FAILED` is `CODE_FAILED`, and the live-context error code `graphic_failed` is
  `code_failed`.
- Breaking: templates no longer carry `render_backend`, `lottie_url` or `lottie_recolor` in `--json`; `skeleton.type` is
  `video` or `shape` (was `graphic` or `shape`).
- The help text and the compiler findings say code where they said graphic (`Code warnings:`, `Code:`,
  `- code in <id> ...`).
- `template create` and `template update` describe `--emoji` and `--shape` by where their values are listed instead of
  an example value.
- Requires `@contenthero/sdk` 0.4.24 (`getCodeGuide`).

## 0.3.20

- Breaking: every paged list (`media list`, `media search`, `folder get`, `card list`, `content list`,
  `brand-kit knowledge list`, `template list`, `project list`) takes `--limit` and `--cursor`; `--offset` is gone. Under
  `--human` a page that has a next one ends with `More: --cursor <cursor>`.
- Breaking: the JSON of `media list`, `media search`, `folder get` and `project list` is the whole page (its items under
  `media`, `results`, `items` or `projects`, and `nextCursor`), where it was a plain array before.
- `media list --human` cuts a long file name the way it cuts a prompt.
- Requires `@contenthero/sdk` 0.4.23.
