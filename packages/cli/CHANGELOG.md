# Changelog

## 0.3.20

- Breaking: every paged list (`media list`, `media search`, `folder get`, `card list`, `content list`,
  `brand-kit knowledge list`, `template list`, `project list`) takes `--limit` and `--cursor`; `--offset` is gone. Under
  `--human` a page that has a next one ends with `More: --cursor <cursor>`.
- Breaking: the JSON of `media list`, `media search`, `folder get` and `project list` is the whole page (its items under
  `media`, `results`, `items` or `projects`, and `nextCursor`), where it was a plain array before.
- `media list --human` cuts a long file name the way it cuts a prompt.
- Requires `@contenthero/sdk` 0.4.23.
