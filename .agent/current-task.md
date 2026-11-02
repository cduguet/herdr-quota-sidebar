# Claude usage-bar authentication guidance

- Status: In progress — documentation ready; review/merge pending.
- Owner: OMP lead.
- Branch: claude-oauth-token.
- Base commit: fcbffed2d0ea55398adfc5b6d27a23c4ff1fe13f.
- Last updated: 2026-11-02.
- Applicable operating constraints: /home/cirqular/.omp/agent/TEAM_POLICY.md.
- Read first: README.md, this record.

## Objective and approved scope

User initially requested optional long-lived OAuth authentication in the plugin and local
activation. After checking feasibility, the user explicitly chose: “Keep normal login;
document the limitation.” Ship documentation only, preserve standard login, and verify the
installed bar. No new credential source or runtime authentication feature is authorized now.

## Confirmed facts

- Official documentation says Claude setup-token creates a one-year token that can only
  make model requests: https://code.claude.com/docs/en/authentication#generate-a-long-lived-token .
- Installed setup-token --help exposes no scope selector. One read-only request using the
  provisioned vault token returned HTTP 403 identifying missing user:profile. No token,
  raw error body or credential file was disclosed.
- Upstream usage-grant request: https://github.com/anthropics/claude-code/issues/81015 .
  It is a user request, auto-closed for inactivity, not a supported scope-generation flow.
- Existing plugin code already reads standard native login and refreshes expired access
  tokens in memory without persisting credentials.

## Work completed

- Withdrew all unpublished token-helper code, schema, version and test changes by forward
  edits after git restore was denied by workspace policy. No bypass used.
- README now explains inference-only versus usage-capable login, the user:profile error,
  supported login renewal/refresh commands, and stale-cache limitations.
- Installed plugin/config remain unchanged: community.quota-sidebar 0.2.0, Claude/Codex
  enabled, no token command, existing Kataleptic helper preserved.
- Ran the EXACT configured tab-bar command with refresh, then line. Refresh exited 0 and
  updated the cache. All three providers were fresh without errors or stale fallback.
  Claude weekly usage was 17%; Codex 65%; Kataleptic current-day spend was present.
- Actual configured line exited 0 and printed the provider bars. No login or server restart
  was needed, no credentials copied, no inference keepalive requests made.

## Files changed

README.md and this durable record only. Runtime source, config schema/example, package and
plugin versions are unchanged. No machine credentials, Herdr configuration or agent-config
source pin changed; the existing runtime pin remains valid for this documentation-only change.

## Validation

- Installed bar: fresh Claude/Codex/Kataleptic snapshots, advanced refresh timestamp, exit 0.
- Earlier withdrawn helper draft had 7 passing tests and typecheck; this is NOT feature
  release evidence. Those draft tests/feature were removed under the approved scope.
- Documentation release requires native review and the existing bun test suite. Treat auth
  guidance conservatively as full tier even though no runtime/authentication behavior changes.

## Remaining work and exact next action

Commit README + this record, open a documentation-only PR, run qreview --harness omp --tier
full --claude-auth subscription-token --test 'bun test' on the pushed head, adjudicate,
merge and remove the owned worktree/branches. Final receipt and reviewed identity belong
on the PR. Existing installed plugin is already verified and needs no reinstall or pin bump.
