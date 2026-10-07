# Changelog

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
- Requires `@contenthero/sdk` 0.4.24 (`getCodeGuide`).

## 0.3.20

- Breaking: every paged list (`media list`, `media search`, `folder get`, `card list`, `content list`,
  `brand-kit knowledge list`, `template list`, `project list`) takes `--limit` and `--cursor`; `--offset` is gone. Under
  `--human` a page that has a next one ends with `More: --cursor <cursor>`.
- Breaking: the JSON of `media list`, `media search`, `folder get` and `project list` is the whole page (its items under
  `media`, `results`, `items` or `projects`, and `nextCursor`), where it was a plain array before.
- `media list --human` cuts a long file name the way it cuts a prompt.
- Requires `@contenthero/sdk` 0.4.23.
