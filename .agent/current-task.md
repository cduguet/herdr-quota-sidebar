# Claude usage authentication documentation

- Status: Documentation and runtime verification complete; integration receipt is PR #1.
- Owner: PR author.
- Branch: claude-oauth-token.
- Base commit: fcbffed2d0ea55398adfc5b6d27a23c4ff1fe13f.
- Last updated: 2026-11-02.
- Read first: README.md, Credentials and Limitations.
- Review/integration receipt: https://github.com/cduguet/herdr-quota-sidebar/pull/1 .

## Approved scope

The requester chose “Keep normal login; document the limitation” after checking the
long-lived token scope restriction. This is documentation only. The unpublished token
helper draft was withdrawn; runtime source, credential loading, config schema, tests,
dependencies, plugin version and installed authentication configuration are unchanged.

## Confirmed facts

- Official authentication docs say the one-year setup-token credential can only make
  model requests: https://code.claude.com/docs/en/authentication#generate-a-long-lived-token .
- Current native CLI help has no setup-token scope selector and confirms
  `claude auth login --claudeai` is a supported login command.
- The usage endpoint requires user:profile. The closed request for a usage-read grant
  is https://github.com/anthropics/claude-code/issues/81015, not an available CLI feature.
- The existing plugin uses standard saved login and refreshes access tokens in memory.
- Existing cache fallback can retain values for an initial failed refresh; repeated
  failures can yield n/a. README describes that limit without changing runtime behavior.

## Verified behavior

The installed status command was refreshed from its existing configuration and then
run in line mode. Both exited 0. The cache timestamp advanced and all enabled providers
had fresh snapshots, with Claude weekly usage present and no error/stale fallback.
No login, credential copying, configuration change, restart or inference keepalive was needed.
Account-specific measurements and machine-specific paths remain outside the shared record.

## Review and validation

- Reviewed head: 950c9c813b96afa9fc173731bc6a8bdb6f287166, against the base above.
- Native OMP and native Claude reviews completed; both used the existing Claude model
  family in independently executed contexts. No model-diversity claim is made.
- Existing suite: 28 tests passed, 0 failed.
- Minor documentation findings corrected: portable work record, closed-issue label,
  accurate repeated-failure cache wording, and one refresh/error instruction.
- Unchanged runtime retry behavior is outside this documentation-only scope.
- Final acceptance, focused validation and merge/cleanup receipts are on PR #1.
- Final focused validation: all 28 tests passed and TypeScript no-emit check passed.
- Fresh independent acceptance passed the exact installed line command and cache checks;
  it verified normal login with no configured token helper, no errors and no stale fallback.
