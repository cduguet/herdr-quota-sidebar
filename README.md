# herdr-quota-sidebar

Herdr plugin that shows your **Claude Code** and **Codex** weekly subscription quota in Herdr's
tab bar, once, regardless of which workspace is active:

```
  1   2   quota-sidebar   +                       claude wk ████░░░░ 46% 3d  codex wk █░░░░░░░ 10% 7d
```

Each entry is the lowercase provider name, `wk`, an 8-cell bar, percent used, and time until the weekly window
resets. The plugin polls each provider's CLI-style usage endpoint and caches the result.

## Why the tab bar, not the sidebar

Herdr's plugin API v1 cannot inject a sidebar section. Sidebar rows exist only per workspace or per
agent pane, so quota there is repeated or tied to one workspace. The tab bar's right-hand status
area (`ui.tab_bar_right`) can run a command on an interval and show its output, which is the one
global spot stock Herdr lets you configure. A real quotas section between Spaces and Agents needs a
fork of Herdr (`src/ui/sidebar.rs::expanded_sidebar_sections` hard-codes two sections); see
[`docs/upstream-notes.md`](docs/upstream-notes.md). Status output is plain text, so it has no colour.

## Install

```sh
herdr plugin install cduguet/herdr-quota-sidebar
```

For local development: `herdr plugin link /absolute/path/to/herdr-quota-sidebar`.

Requires `bun` and Herdr >= 0.7.0.

## Tab bar setup

Herdr does not let a plugin edit `config.toml`, so add the entry yourself in
`~/.config/herdr/config.toml` (use the absolute paths of `bun` and this plugin):

```toml
[ui]
tab_bar_right = [
  { type = "command", command = "/opt/homebrew/bin/bun run /path/to/herdr-quota-sidebar/src/main.ts line", interval_seconds = 60, timeout_seconds = 30 },
]
```

Then `herdr server reload-config`. Herdr runs `line` every `interval_seconds`; `line` refreshes the
cache only when it is older than `refresh_minutes`, then prints one line (Herdr truncates status
text at 80 characters and hides it when the tab row is too narrow). Other entries such as
`{ type = "datetime" }` can sit alongside it, separated by `tab_bar_right_separator`.

Commands:

| Command | What it does |
| --- | --- |
| `line` | refresh if stale, print the status line (what the tab bar runs) |
| `refresh` | force a refresh and print each provider's windows (`herdr plugin action invoke refresh --plugin community.quota-sidebar`) |
| `show` | print the cached snapshot (`prefix+shift+q`) |

## Configuration

Optional. The plugin reads `config.toml` from its config dir
(`herdr plugin list` prints the path, usually `~/.config/herdr/plugins/config/community.quota-sidebar/`).
When Herdr runs the tab-bar command directly it uses `~/.config/herdr/quota-sidebar.toml` instead:

```toml
refresh_minutes = 5        # 1-1440, minimum age of the cache before a new fetch

[providers]
claude = true
codex = true
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
- Last known good values are reused when a refresh fails, so the line keeps the last bar instead of
  vanishing.

## Development

```sh
bun install
bun test          # unit tests for parsing, rendering, config, state, refresh
bunx tsc --noEmit # typecheck
bun run src/main.ts refresh   # fetch and print the current snapshot
```

## License

MIT.