/**
 * Fixed product vocabularies the generate tools take.
 *
 * ⛔⛔ NO MODEL IS NAMED HERE, AND NONE MAY BE. The model registry in the database is the one source of truth for
 * which models exist, what each is for and what each takes, and the server checks every model id against it. This
 * file used to hold the model ids as enums resolved at startup, a hardcoded copy used whenever that read failed (the
 * hosted server used the copy always, since it registers without a user), and guidance naming models per tool.
 * Measured 2026-10-05: the copy still offered `wan-2.6`, disabled in the registry, lacked six enabled video models,
 * and the guidance led with Veo while the registry's default video model is Kling 3.0. An agent reads a model list
 * from `list_models` and one model's options from `get_model`, so nothing here can fall behind the registry.
 */

/**
 * The nine Reference Board types. Unlike models, which only the registry names, board types are a fixed product
 * taxonomy with no discovery endpoint, so they are enumerated here. Keep in sync with the app's
 * lib/studio/reference-boards/templates.ts BOARD_TYPES.
 */
export const BOARD_TYPES = [
  'character',
  'pose',
  'mascot',
  'creature',
  'weapon',
  'vehicle',
  'object',
  'location',
  'shot',
] as const

/** Short selection guidance baked into the generate_board boardType description. */
export const BOARD_TYPE_GUIDANCE =
  'character = a person or figure. pose = a pose / action sheet. mascot = a brand mascot. creature = a creature or animal. weapon = a weapon. vehicle = a vehicle. object = a prop or object. location = an environment. shot = a multi-shot storyboard in one image.'
