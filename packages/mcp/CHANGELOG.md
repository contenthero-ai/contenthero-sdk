# Changelog

## 0.4.30

- Breaking: every paged listing tool (`list_media`, `search_media`, `get_folder`, `list_cards`, `list_content`,
  `list_brand_knowledge`, `list_templates`, `list_projects`) takes `limit` and `cursor`; `offset` is gone and is refused
  as an undeclared input. A page that has a next one ends with `More: pass cursor "<cursor>".`, and says nothing on the
  last. `search_media`, `get_folder` and `list_projects` page for the first time; `limit` is capped at 100 everywhere
  but `list_templates` (500).
- `list_media` cuts a long file name the way it cuts a prompt.
- Requires `@contenthero/sdk` 0.4.23.
