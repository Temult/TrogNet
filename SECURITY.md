# Security policy

This pre-alpha scaffold has no supported runtime releases. Do not use it to store
credentials or perform authentication. Publication tooling receives security fixes
on main; there is no promised response time.

Use GitHub's private vulnerability reporting option if it is enabled. If it is not,
open a minimal issue requesting a private reporting channel without including the
vulnerability details, secrets, personal information, or evidence data. Wait for a
maintainer-provided private channel before sharing sensitive details.

If a credential is exposed, revoke or rotate it at its issuer immediately. Removing
a file or commit alone does not revoke a credential. Do not paste credentials into
issues, pull requests, logs, scan reports, or examples. Hygiene reports contain rule
names and relative file names, never matching secret values.

## Published runtime

The `runtime/` source is public, but no live OAuth credential, client grant, Cloudflare secret, private evidence bundle, D1 contents, or account token belongs in this repository. Dynamic registration and live plan inference remain separately gated.
