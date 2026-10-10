# Changelog

## Unreleased

- Fixed: `list_content` says each `accountIds` entry that named no account of yours, one line each, instead of
  silently matching nothing for it; the posts the other ids matched still list.
- Fixed: every tool that starts or finishes a background job names the job by an id `get_status` takes, with its
  link, finished or still running. `export_project` finished inside the call now names the export (its id, link and
  share page) beside the file it draws, as `get_export` does. A still-running generation, board, edit, upscale, lip
  sync, enhancement, import or editor effect names its short id, or its full id with `kind: "output"` (a full id alone
  was refused), and its link; a running export, Break It Down or scene map names its short id and link. A new avatar
  or brand kit names `get_status` for its wait.
- Fixed: the generation card's own poll passes `kind: "output"`, so a card holding an output's full id finishes.
- `generate_board` and `export_project` wait within the call as the other job tools do.
- Fixed: `get_status` with several ids answers each one on its own line. An id that names no job of yours reads
  `not found` with the server's reason, naming the id; the others still answer. It is an error only when no id
  answered.

## 0.4.34

- Breaking (hard cutover, no alias): `get_generation_status` is `get_status`. It checks any background job
  (generations and edits, exports, brand kit reads, avatars, content analysis, transcripts) and takes `ids`, each the
  id its starting call returned, with `kind` only for a full UUID, a transcript, or an id the server says is
  ambiguous. It still blocks up to about 40 seconds by default, `wait: false` still snapshots, and a generation still
  answers with its files. The generation card polls it.
- Waiting is `get_status`'s, everywhere: `export_project`, `list_exports` and a running export name
  `get_status` with kind `export` for the wait, and `get_export` reads one export (its file, state and details). A
  Break It Down still running names `get_status` with kind `content`, then `analyze_content` reads it at no charge.
- Breaking (hard cutover, no alias): `share_media` and `share_project` are one `share` tool, as `favorite` and
  `archive` are. Media is named by `mediaIds` (with `title`, or `shareUrl` to stop a link); anything else by
  `assetType` and `id`, today `project`. `shared: false` stops sharing either. Each kind keeps its scope:
  `studio:write` for media, `editor:write` for a project. It is in the media group, beside `favorite` and `archive`.
- Breaking (hard cutover, no alias): `save_project_version` is `create_project_version`, the verb every tool that
  makes a new item uses.
- Breaking (hard cutover, no alias): `list_project_exports` is `list_exports`, pairing with `get_export`. It takes
  `projectId` as an input, as `list_stages` takes `spaceId`, and still pages by cursor.

## 0.4.33

- Breaking: a project's settings are read by `get_project` and changed by `update_project`. `update_project` takes
  `fps`, `loudness`, `magneticTrack`, `linkage` and `linkedTracks` beside the title, size, brand kit and cover, and
  both tools report the settings. `get_timeline_settings` and `update_timeline_settings` are removed. `update_timeline`
  carries content only: `set_frame_rate` is no longer one of its operations.

- Breaking (hard cutover, no alias): `get_context` is `view`. It also takes `video` (watch a range play; here it
  returns frames across the range and the sound measured), and `assetId` or `mediaUrl` with `fromSec` and `toSec` to
  see a raw source clip, whose keyframes come back as images labeled with their time in the clip. `count` and `width`
  shape a clip's keyframes too. The descriptions that named `get_context` name `view`.
- Breaking: `get_media` no longer reads a clip's frames: its items drop `fromSec`, `toSec`, `frames` and
  `frameWidth`, and its `region` zooms an image only. Use `view`, whose `region` on a source clip is in the clip's own
  pixels and cuts each of its frames; a view clip says how a region maps back, or why it was not cut.
- Breaking: `restore_project_version` takes no `action`: it only restores. A copy from a saved version is
  `duplicate_project` with `versionId`.

## 0.4.32

- Breaking: a project's delivery loudness is a project setting. `get_timeline_settings` reads `loudness` and
  `update_timeline_settings` changes it: a target in LUFS, or `off`. `export_project` drops `normalizeLoudness` and
  takes `loudness`, one export's loudness in place of the project's. `get_export`, `export_project` and
  `list_project_exports` print how a finished export's loudness came out, in the app's one line.
- `share_media` stops sharing with `shared: false`, naming a generation by one media id or any media link as `shareUrl`.
- New: `list_project_exports` lists a project's exports, newest first, with each finished one's download and share
  page and each running one's status.
- New: `share_project` makes a project's public live link, or revokes it with `shared: false`; `share_media` shares
  outputs of finished generations as one link. `get_project` reports a project's link, and `get_export` a completed
  export's share page.

- Breaking: the preview video is retired. `get_preview` is removed, and `get_context` takes no `mode`: no agent can
  receive video over MCP, so the render's description says frames across a range are how an agent judges motion.
- The tool descriptions name the API's renamed scopes: `brand:read`, `brand:write`, `library:write`, and
  `inspiration:write` for `update_tracked_account`.
- Breaking: every hand-arranged list moves by neighbor or end, one wording from `placementInput()`: `afterId`, `beforeId`,
  or `position` (`top` | `bottom`). `create_card` and `update_card`, `create_stage` and `update_stage`,
  `update_brand_kit` (the kit among the caller's) and its section entries (within their tab), `update_avatar`,
  `create_template` and `update_template` take it. `update_stage` no longer reads an empty string as an edge: an end is
  `position`.
- Breaking: `update_brand_kit` drops `orderedIds` (the whole-list reorder is retired); `brandKitId` is required.
- New: `update_tracked_account` moves a tracked account within its list. `update_folder` takes `moveItem` to move one
  item within a manual folder.
- `list_cards` takes `sort` `position`: one stage's own order, which needs `stage`.

- `create_brand_kit` and `update_brand_kit` logo entries take `isDisplay`: the logo for the kit's compact places, at most
  one per kit.
- Breaking: the brand kit tools' logo entries take `isPrimary` (was `is_primary`), the name the API reads.
- No manual position: `create_stage` and `update_stage` no longer print `Position:`, and `update_stage` no longer
  reports a renumbered board (the API carries no position; `list_stages` returns the board in order).
- Templates, Kling elements and project versions are read by the API's camelCase fields; a brand kit's full read
  carries its logos, assets and social accounts camelCase.

- Breaking: `list_media` follows the library-file contract. `source` is `all` (the default), `creations`, `uploads` or
  `exports` (`stock` is gone); `contentType` is a list of `image`, `video`, `audio`, `doc` and `other` (`transcript` is
  gone); `status` is gone (a listed file is always completed). It takes `sort` (`createdAt`, `fileName`, `sizeBytes`)
  and `order`. `favorited` and `archived` apply to every file. Each line shows the file's size and source, and the page
  no longer says newest first.
- Breaking: every sortable list tool (`list_cards`, `list_projects`, `list_spaces`, `list_content`) takes `sort` (the
  fields the API declares for that list, from the SDK's `LIST_SORTS`) and `order` (`asc` | `desc`). `list_content`'s
  `sortBy` and `sortOrder` are gone; its fields are `relevance` (with a search only), `outlierScore`, `publishedAt`,
  `viewCount` and `engagementRate`.
- Breaking: every growable list tool pages. `list_tags`, `list_avatars`, `list_voices`, `list_brand_kits`,
  `list_tracked_accounts`, `list_connected_accounts`, `list_kling_elements`, `list_stages`, `list_spaces` and
  `list_folders` take `limit` and `cursor`, and end with the next page's cursor when there is one.
- Breaking: `list_spaces` takes `archived` (only archived spaces; was `includeArchived`), `favorited` and `search`.
- `list_cards` takes `isFavorite` and `tag`, and `spaceId` `all` for every space; a list across every space says so.
- `list_content` names its page as posts, in the order asked for (it said outliers by score whatever the sort).
- New tools: `update_project` (title, size, brand kit, cover and its framing), `duplicate_project`,
  `get_timeline_settings` / `update_timeline_settings`, the version history (`list_project_versions`,
  `save_project_version`, `restore_project_version` with `action` restore or copy, `update_project_version`,
  `delete_project_version`), and `undo_project_edit` / `redo_project_edit`.
- Requires the unreleased `@contenthero/sdk` (sort and order, the paged lists, the new project methods).

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
