# Changelog

## 0.4.31

- Breaking: the clip type `graphic` is retired and renamed `code`: a code clip or code layer is a video, audio or image
  whose content is code. `list_templates` takes `kind` `code` (was `graphic`), and `get_schema` takes kind `code` for
  the code guide (was `graphic`); the old values are refused. The `timeline` and `layer` kinds no longer list a
  `graphic` type.
- Breaking: the error code `GRAPHIC_FAILED` is `CODE_FAILED`, and the live-context error code `graphic_failed` is
  `code_failed`.
- Breaking: templates no longer carry `render_backend`, `lottie_url` or `lottie_recolor`, and `get_template` no longer
  prints a `Lottie file:` line (a Lottie template is code that plays its file, which its props hold). `skeleton.type` is
  `video` or `shape` (was `graphic` or `shape`).
- The tool descriptions, the effect list and the compiler findings say code where they said graphic (`Code warnings:`,
  `Code:`, `- code in <id> ...`). `create_template`'s `emoji` and `shape` name where their values are listed instead of
  an example value.
- Requires `@contenthero/sdk` 0.4.24 (`getCodeGuide`).

## 0.4.30

- Breaking: every paged listing tool (`list_media`, `search_media`, `get_folder`, `list_cards`, `list_content`,
  `list_brand_knowledge`, `list_templates`, `list_projects`) takes `limit` and `cursor`; `offset` is gone and is refused
  as an undeclared input. A page that has a next one ends with `More: pass cursor "<cursor>".`, and says nothing on the
  last. `search_media`, `get_folder` and `list_projects` page for the first time; `limit` is capped at 100 everywhere
  but `list_templates` (500).
- `list_media` cuts a long file name the way it cuts a prompt.
- Requires `@contenthero/sdk` 0.4.23.
