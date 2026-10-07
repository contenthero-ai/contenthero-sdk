# Changelog

## 0.4.23

- Breaking: every paged listing pages by cursor. `listMedia`, `searchMedia`, `getFolder`, `listCards`, `listContent`,
  `listBrandKnowledge`, `listTemplates` and `listProjects` take `limit` and `cursor` (the shared `PageOptions`); `offset`
  is gone. Each returns its items under its own key with `nextCursor` (the shared `Paged`), null on the last page.
  `hasMore` is gone: a null `nextCursor` says it. `total` stays on cards, content and brand knowledge.
- Breaking: `listMedia` returns `MediaListResult` (`{ media, nextCursor }`), `searchMedia` returns `SearchMediaPage`
  (`{ results, nextCursor }`), `getFolder` returns `FolderContents` (`{ folder, items, nextCursor }`) and `listProjects`
  returns `ProjectListResult` (`{ projects, nextCursor }`), where they returned a plain array before.
