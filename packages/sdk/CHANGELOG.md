# Changelog

## 0.4.24

- Breaking: the clip type `graphic` is retired and renamed `code`: a code clip or code layer is a video, audio or image
  whose content is code. `TemplateKind` is `'code' | 'shape' | 'emoji'` (was `'graphic'`), so `listTemplates` takes
  `kind: 'code'`.
- Breaking: `getGraphicGuide` is `getCodeGuide`, and reads `GET /api/v1/editor/code-guide` (was `graphic-guide`).
  `GraphicGuide` is `CodeGuide`, `GraphicDiagnostic` is `CodeDiagnostic`, `describeGraphicWarnings` is
  `describeCodeWarnings`, `withGraphicWarnings` is `withCodeWarnings`, and the effect list's `graphicHosts` is
  `codeHosts`.
- Breaking: the error code `GRAPHIC_FAILED` is `CODE_FAILED`, and the live-context error code `graphic_failed` is
  `code_failed`.
- Breaking: `TemplateSummary` drops `render_backend`, `lottie_url` and `lottie_recolor`. `skeleton.type` is
  `'video' | 'shape'` (was `'graphic' | 'shape'`); an animated emoji template is `{ type: 'video', emoji }`. A template
  is an emoji when `skeleton.emoji` is set, a shape when `skeleton.type` is `'shape'`, and code otherwise.
  `TemplateFields` (`code`, `lottie`, `emoji`, `shape`) is unchanged.
- The words printed for compiler findings: `Graphic warnings:` is `Code warnings:`, `Graphic code:` is `Code:`, and each
  finding reads `- code in <id> ...` (was `- graphic <id> ...`).

## 0.4.23

- Breaking: every paged listing pages by cursor. `listMedia`, `searchMedia`, `getFolder`, `listCards`, `listContent`,
  `listBrandKnowledge`, `listTemplates` and `listProjects` take `limit` and `cursor` (the shared `PageOptions`); `offset`
  is gone. Each returns its items under its own key with `nextCursor` (the shared `Paged`), null on the last page.
  `hasMore` is gone: a null `nextCursor` says it. `total` stays on cards, content and brand knowledge.
- Breaking: `listMedia` returns `MediaListResult` (`{ media, nextCursor }`), `searchMedia` returns `SearchMediaPage`
  (`{ results, nextCursor }`), `getFolder` returns `FolderContents` (`{ folder, items, nextCursor }`) and `listProjects`
  returns `ProjectListResult` (`{ projects, nextCursor }`), where they returned a plain array before.
