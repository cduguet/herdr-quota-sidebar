# herdr-quota-sidebar

Herdr plugin that shows your **Claude Code** and **Codex** subscription quota inside the Herdr sidebar.

It polls each provider's CLI-style usage endpoint on a schedule and publishes the results as
[Herdr metadata tokens](https://herdr.dev/docs/socket-api/) (`quota_claude_5h`, `quota_codex_7d`, …).
You render them with `$token` rows in the sidebar config — the same mechanism Herdr uses for its own
built-in sidebar fields.

```
 spaces
   ▸ 1 kataleptic
     5h 9% 2m wk 19% 4d
     7d 86% 7d
   ▸ 2 openfon
 agents
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
  ["$quota_claude_text"],
  ["$quota_codex_text"],
]
```

`$quota_claude_text` is one line per provider; granular tokens are available if you want them:

| Token | Value |
| --- | --- |
| `$quota_claude_text` | all Claude windows, e.g. `5h 9% 2m wk 19% 4d` |
| `$quota_claude_5h` | the 5-hour window, with time to reset |
| `$quota_claude_wk` | the weekly window |
| `$quota_claude_opus` / `$quota_claude_design` | per-model weekly windows when present |
| `$quota_claude_left` | headroom on the most-consumed window, e.g. `81% left` |
| `$quota_claude_plan` / `$quota_claude_status` | plan name, snapshot age |
| `$quota_codex_text` / `$quota_codex_7d` / `$quota_codex_left` / `$quota_codex_plan` | Codex equivalents |

Row styles work too (`{ token = "$quota_claude_left", fg = "#ff5555" }`), and rules
(`equals`/`contains`/`gt`/`lt`/`hide`) apply exactly as for built-in tokens.

Apply changes with `herdr server reload-config`.

### Which workspace gets the tokens?

Metadata is attached to a workspace, and a workspace is always known during a plugin action or event
hook (`HERDR_WORKSPACE_ID`). The plugin publishes on:

- plugin startup,
- `workspace.created`, `workspace.updated`, `workspace.closed`, and
- manual `herdr plugin action invoke publish --plugin community.quota-sidebar`.

So every workspace you touch during a session gets the tokens. If you want them everywhere at once,
run the publish action once per workspace, or invoke it from a workspace you keep open.

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