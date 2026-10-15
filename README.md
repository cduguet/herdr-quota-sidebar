# herdr-quota-sidebar

Herdr plugin that shows your **Claude Code** and **Codex** subscription quota inside the Herdr sidebar.

It polls each provider's CLI-style usage endpoint on a schedule and publishes the results as
[Herdr metadata tokens](https://herdr.dev/docs/socket-api/) (`quota_claude_wk`, `quota_codex_wk`).
You render them with `$token` rows in the sidebar config — the same mechanism Herdr uses for its own
built-in sidebar fields.

```
 spaces
 ● kataleptic
   ✻ wk ████░░░░ 46% 3d      (orange)
   ◆ wk █░░░░░░░ 10% 7d      (teal)
 ○ openfon
 ○ hinge-auto
```

Only the weekly limit is shown, once, under the first workspace in the sidebar.

## Why a plugin, not a new sidebar section

Herdr's plugin API v1 cannot inject a sidebar section. Panes, actions, event hooks, and metadata
tokens are the whole extension surface, so this plugin uses metadata tokens and leaves the existing
*Spaces* and *Agents* sections in place. A dedicated third "quotas" section between them requires
forking Herdr (`src/ui/sidebar.rs::expanded_sidebar_sections` hard-codes exactly two sections).
See [`docs/upstream-notes.md`](docs/upstream-notes.md).

## Install

```sh
herdr plugin install cduguet/herdr-quota-sidebar
```

For local development:

```sh
herdr plugin link /absolute/path/to/herdr-quota-sidebar
herdr plugin action invoke publish --plugin community.quota-sidebar
```

Requires `bun` and Herdr >= 0.7.0.

## Sidebar setup

Herdr does not let a plugin edit `config.toml`, so add the rows yourself in
`~/.config/herdr/config.toml`:

```toml
[ui.sidebar.spaces]
rows = [
  ["state_icon", "workspace"],
  [{ token = "$quota_claude_wk", fg = "#D97757" }],
  [{ token = "$quota_codex_wk",  fg = "#10A37F" }],
]
```

The plugin renders the bar and the layout; Herdr applies colour from your config, so the orange
(`#D97757`) and teal (`#10A37F`) above are just `fg` values you can change. Workspaces other than
the anchor carry no quota tokens, so those rows are hidden there.

The weekly token is one aligned line: `✻ wk ████░░░░ 46% 3d`: provider badge, window, 8-cell bar,
percent used, time to reset. Other tokens:

| Token | Value |
| --- | --- |
| `$quota_claude_wk` / `$quota_codex_wk` | the weekly bar line |
| `$quota_<provider>_left` | headroom on the weekly window, e.g. `54% left` |
| `$quota_<provider>_plan` / `_status` | plan name, snapshot age or error |

Row styles work too (`{ token = "$quota_claude_left", fg = "#ff5555" }`), and rules
(`equals`/`contains`/`gt`/`lt`/`hide`) apply exactly as for built-in tokens.

Apply changes with `herdr server reload-config`.

### Which workspace gets the tokens?

Herdr renders sidebar rows per workspace, so "show it once" means one workspace carries the tokens.
The plugin picks the first workspace in the sidebar and removes every `quota_*` token it set earlier
from all other workspaces and panes. Reorder workspaces and the next publish moves it.

It publishes on plugin startup, workspace/tab/pane focus, agent status changes, workspace
create/update/close, and by hand with
`herdr plugin action invoke publish --plugin community.quota-sidebar` (always refreshes). Event
runs fetch only after `refresh_minutes` since the last publish.

## Configuration

Optional. The plugin reads `config.toml` from its config dir
(`herdr plugin list` prints the path, usually `~/.config/herdr/plugins/config/community.quota-sidebar/`):

```toml
refresh_minutes = 5        # 1-1440
stale_after_minutes = 30   # 1-1440, token TTL before Herdr drops them
token_prefix = "quota"     # token names become $<prefix>_<provider>_wk
```

[`config.example.toml`](config.example.toml) is a fully commented copy.

## Credentials

The plugin reads the same credentials the provider CLIs already store — it never asks you to log in
again and never writes to those files.

| Provider | Source |
| --- | --- |
| Claude Code | macOS Keychain (`Claude Code-credentials`), else `$CLAUDE_CONFIG_DIR/.credentials.json` or `~/.claude/.credentials.json` |
| Codex | `$CODEX_HOME/auth.json` or `~/.codex/auth.json` |

Expired Claude access tokens are refreshed in memory with the stored refresh token; the refreshed
token is not persisted, so the CLI remains the owner of that file.

## Limitations

- Both usage endpoints are **undocumented and may change without notice**; the exact request and
  response shapes the plugin relies on are recorded in
  [`docs/upstream-notes.md`](docs/upstream-notes.md).
- Claude shows only the windows its endpoint returns, which vary by plan and feature flags.
- Codex labels windows from `limit_window_seconds`, so the names depend on your plan
  (the weekly window is the one shown).
- Headroom is a percentage of quota, not a message count.
- Last known good values are reused when a refresh fails, marked `stale: <reason>`; tokens carry a
  TTL so a dead plugin does not leave permanent stale rows.

## Development

```sh
bun install
bun test          # unit tests for parsing, rendering, config, state
bunx tsc --noEmit # typecheck
bun run src/main.ts show   # fetch and print the current snapshot
```

## License

MIT.