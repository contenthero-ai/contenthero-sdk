# Changelog

## Unreleased

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
