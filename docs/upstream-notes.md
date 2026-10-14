# Upstream research notes

Everything here was verified against **Herdr 0.9.0** (`herdr --version`, brew install) and the
`herdrdev/herdr` `master` source. It exists because the plugin depends on undocumented provider
endpoints and on Herdr extension points that are not all covered by the public docs. If something
breaks after an upgrade, start here.

## Provider usage endpoints

Neither endpoint is a supported public API. They are what the vendor CLIs call, and their shapes can
change at any time. Both return JSON and reject requests without a bearer token.

### Claude Code

```
GET https://api.anthropic.com/api/oauth/usage
Authorization: Bearer <accessToken>
anthropic-beta: oauth-2025-04-20
Accept: application/json
Content-Type: application/json
```

Observed response (2026-10, `max` plan):

```json
{
  "five_hour":          { "utilization": 9,  "resets_at": "2026-10-14T16:00:00Z" },
  "seven_day":          { "utilization": 19, "resets_at": "2026-10-18T12:00:00Z" },
  "seven_day_opus":     { "utilization": 0,  "resets_at": "..." },
  "seven_day_omelette": { "utilization": 0,  "resets_at": "..." },
  "seven_day_oauth_apps": { "utilization": 0, "resets_at": "..." },
  "extra_usage": { "...": "..." }
}
```

- `utilization` is a 0-100 percentage (not a fraction).
- `resets_at` is ISO 8601.
- Which windows appear depends on plan and feature flags; absent keys are skipped.

Token refresh, used when `expiresAt` is within 5 minutes or a request returns 401/403:

```
POST https://platform.claude.com/v1/oauth/token
{ "grant_type": "refresh_token", "refresh_token": "<refreshToken>",
  "client_id": "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
  "scope": "user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload" }
```

Credentials live in the macOS Keychain under service `Claude Code-credentials` (suffixed
`-<sha256(CLAUDE_CONFIG_DIR)[0:8]>` when `CLAUDE_CONFIG_DIR` is set), or in
`$CLAUDE_CONFIG_DIR/.credentials.json` / `~/.claude/.credentials.json` under
`claudeAiOauth.{accessToken,refreshToken,expiresAt,subscriptionType}`. `expiresAt` is epoch millis.

### Codex

```
GET https://chatgpt.com/backend-api/wham/usage
Authorization: Bearer <access_token>
ChatGPT-Account-Id: <account_id>   # optional
Accept: application/json
```

Observed response (2026-10, `prolite` plan):

```json
{
  "plan_type": "prolite",
  "rate_limit": {
    "allowed": true,
    "limit_reached": false,
    "primary_window": { "used_percent": 85, "limit_window_seconds": 604800,
                        "reset_after_seconds": 601637, "reset_at": 1792605820 },
    "secondary_window": null
  },
  "code_review_rate_limit": null,
  "credits": { "has_credits": false, "unlimited": false, "balance": "0" },
  "model_usage": { "...": "..." }
}
```

- `used_percent` is 0-100; `reset_at` is **unix seconds** (unlike Claude's ISO strings).
- `limit_window_seconds`: 18000 = 5 h, 604800 = 7 d. The plugin derives the window label from it and
  falls back to `session`/`wk`/`review` when absent.
- `primary_window` can itself be the 7-day window (as on `prolite`); `secondary_window` may be null.
- `credits.balance` is a **string**, and may be absent — do not assume a number.
- Refresh (not currently used by the plugin, recorded for completeness):
  `POST https://auth.openai.com/oauth/token`, form-encoded
  `grant_type=refresh_token&client_id=app_EMoamEEZ73f0CkXaXp7hrann&refresh_token=…`.

Credentials live in `$CODEX_HOME/auth.json` / `~/.codex/auth.json` as
`tokens.{access_token,refresh_token,account_id}` plus `auth_mode` (macOS Keychain service
`Codex Auth` also exists).

## Herdr extension surface

### Metadata tokens

`herdr workspace report-metadata <WORKSPACE_ID> --source <ID> --token name=value [--ttl-ms N] [--seq N]`
and the `pane` equivalent. From `herdr api schema --json`:

- request `tokens`: max 16 properties, names `^[A-Za-z0-9_-]{1,32}$`, values `string|null`
  (`null` clears a key);
- stored `PaneInfo.tokens` / `WorkspaceInfo.tokens`: max 32 properties (also `AgentInfo.tokens`);
- `ttl_ms` is 1 … 86400000;
- `seq` (uint64) drops out-of-order updates per source (`src/metadata_tokens.rs`), with at most 32
  sequence sources.

Tokens are display-only. They are consumed in `src/ui/sidebar/tokens.rs` as
`AgentSidebarToken::Custom` / `SpaceSidebarToken::Custom` — the `$name` syntax.

### Sidebar config

`[ui.sidebar.spaces].rows` and `[ui.sidebar.agents].rows` accept built-ins and `$custom` names,
optionally as `{ token = "$name", fg = "#abc", bold = true, dim = false }`, with rules
(`equals`/`contains`/`starts_with`/`gt`/`lt` plus `fg`/`bold`/`dim`/`hide`). Limits: 16 rows,
16 tokens per row. `herdr server reload-config` applies layout changes live.

Built-ins: spaces = `state_icon`, `state_text`, `workspace`, `branch`, `git_status`;
agents = `state_icon`, `state_text`, `machine`, `workspace`, `tab`, `pane`, `agent`,
`terminal_title`, `terminal_title_stripped`.

### Plugin manifest

`herdr-plugin.toml` supports `[[build]]`, `[[startup]]`, `[[actions]]`, `[[events]]`, `[[panes]]`,
`[[link_handlers]]`, `[[keys.command]]`. `command` values are argv arrays (no shell expansion).

Allowed `[[events]].on` names are the narrower `PLUGIN_HOOK_EVENT_KINDS`
(`src/api/schema/events.rs`): `workspace.created|updated|closed|renamed|moved|reordered|focused`,
`worktree.created|opened|removed`, `tab.created|closed|renamed|moved|focused`,
`pane.created|closed|focused|moved|exited|agent_detected|agent_status_changed`.
`pane.updated`, `pane.output_matched`, and `layout.updated` are **not** hookable.

Runtime environment: `HERDR_BIN_PATH`, `HERDR_SOCKET_PATH`, `HERDR_ENV=1`, `HERDR_PLUGIN_ID`,
`HERDR_PLUGIN_ROOT`, `HERDR_PLUGIN_CONFIG_DIR`, `HERDR_PLUGIN_STATE_DIR`,
`HERDR_PLUGIN_CONTEXT_JSON`, and during an action/hook optionally `HERDR_WORKSPACE_ID`,
`HERDR_TAB_ID`, `HERDR_PANE_ID`, `HERDR_PLUGIN_ACTION_ID`, `HERDR_PLUGIN_EVENT`,
`HERDR_PLUGIN_EVENT_JSON`, `HERDR_PLUGIN_ENTRYPOINT_ID`.

CLI quirks worth remembering: `herdr plugin action invoke <action_id> --plugin <id>` puts the action
**first**; `herdr tab create` has no `--json` flag; and `herdr plugin link` does not run `[[build]]`
(`herdr plugin install` does).

### Why not a dedicated sidebar section

`src/ui/sidebar.rs::expanded_sidebar_sections(area, split_ratio) -> (Rect, Rect)` returns exactly two
rectangles and `sidebar_section_divider_rect` draws one divider, so the sidebar is structurally
two-section. `src/client/shell/sidebar.rs::render_sidebar` paints `" spaces"` and then calls
`render_agent_panel`, whose header prints `" agents"`. Adding a third section means forking Herdr and
changing those functions plus the persisted `sidebar_section_split` state. The plugin deliberately
does not: it works on stock Herdr and does not carry a rebase tax.

## References

- Herdr plugin docs: <https://herdr.dev/docs/plugins/>
- Plugin manifest reference: <https://herdr.dev/docs/reference/plugin-manifest>
- Herdr source: <https://github.com/herdrdev/herdr> (Apache-2.0, branch `master`)
- Field mapping cross-checks: `abuhanna/winusage` (`docs/providers/{claude,codex}.md`),
  `steipete/CodexBar`.