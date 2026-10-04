# Architecture and ownership

This commit contains documentation and publication tooling only. It has no provider,
credential broker, model adapter, application entrypoint, or deployment.

E05R1 owns runtime development, qualification, and the eventual OSS publication
candidate. E05P0 owns repository scaffolding, licensing, hygiene, and the import gate.
E05P0 does not modify, execute, or race E05R1 implementation.

The intended future flow is local/user-supplied projection -> bounded request
composition -> reviewed plan provider adapter. A credential broker would isolate
credential storage from evidence readers. These are intended boundaries, not a claim
that implementations or provider compatibility have been qualified.

The import gate checks a package identity and exact file allowlist, stages changes in
a detached temporary worktree, runs local hygiene, and emits the final diff for owner
review. It never pushes, deploys, authenticates to a provider, or changes main.

## Published runtime

The reviewed OSS runtime is now published byte-for-byte under `runtime/`. It is the software surface qualified by E05R2. Private research/evidence payloads remain excluded. Publication makes the source inspectable; it does not authorize dynamic registration, OAuth, plan usage, or deployment.
