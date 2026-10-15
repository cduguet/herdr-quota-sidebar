# herdr-quota-sidebar

Herdr plugin that shows your **Claude Code** and **Codex** subscription quota inside the Herdr sidebar.

It polls each provider's CLI-style usage endpoint on a schedule and publishes the results as
[Herdr metadata tokens](https://herdr.dev/docs/socket-api/) (`quota_claude_5h`, `quota_codex_7d`, …).
You render them with `$token` rows in the sidebar config — the same mechanism Herdr uses for its own
built-in sidebar fields.

```
 spaces
 ● kataleptic
   ✻ 5h ░░░░░░░░  3% 5h      (orange)
   ✻ wk ████░░░░ 44% 3d      (orange)
   ◆ 7d █░░░░░░░  8% 7d      (teal)
 ○ openfon
   ✻ 5h ░░░░░░░░  3% 5h
   ...
```

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
  [{ token = "$quota_claude_5h",   fg = "#D97757" }],
  [{ token = "$quota_claude_wk",   fg = "#D97757" }],
  [{ token = "$quota_claude_opus", fg = "#D97757" }],
  [{ token = "$quota_codex_5h",    fg = "#10A37F" }],
  [{ token = "$quota_codex_7d",    fg = "#10A37F" }],
]
```

The plugin renders the bar and the layout; Herdr applies colour from your config, so the orange
(`#D97757`) and teal (`#10A37F`) above are just `fg` values you can change. A row whose token is
absent (say, no Opus window on your plan) is hidden automatically. Codex window names come from
the API (`5h`, `7d`, `review`, ...), so list the ones your plan reports.

Every window token is one aligned line: `✻ wk ████░░░░ 44% 3d`: provider badge, window, 8-cell
bar, percent used, time to reset. Other tokens:

| Token | Value |
| --- | --- |
| `$quota_claude_5h` / `_wk` / `_opus` / `_design` | bar line per window (those present) |
| `$quota_codex_5h` / `_7d` / `_review` | bar line per window (those present) |
| `$quota_<provider>_text` | one plain line with all windows, e.g. `5h 9% 2m wk 19% 4d` |
| `$quota_<provider>_left` | headroom on the most-used window, e.g. `56% left` |
| `$quota_<provider>_plan` / `_status` | plan name, snapshot age or error |

Row styles work too (`{ token = "$quota_claude_left", fg = "#ff5555" }`), and rules
(`equals`/`contains`/`gt`/`lt`/`hide`) apply exactly as for built-in tokens.

Apply changes with `herdr server reload-config`.

### Which workspace gets the tokens?

Every open workspace (and each agent pane in it) gets the tokens, because the sidebar renders each
space from its own metadata. The plugin publishes on:

- plugin startup,
- `workspace.created`, `workspace.updated`, `workspace.closed`, and
- manual `herdr plugin action invoke publish --plugin community.quota-sidebar`.

Tokens expire after `stale_after_minutes`, so a workspace created later shows them on the next
publish. Re-run the action to refresh by hand.

## Configuration

Optional. The plugin reads `config.toml` from its config dir
(`herdr plugin list` prints the path, usually `~/.config/herdr/plugins/config/community.quota-sidebar/`):

```toml
refresh_minutes = 5        # 1-1440
max_window_count = 4       # 1-8, windows shown per provider
stale_after_minutes = 30   # 1-1440, token TTL before Herdr drops them
token_prefix = "quota"     # token names become $<prefix>_<provider>_<window>
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
  (`7d` for `prolite`, `5h`/`7d` for others).
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