# E06R1 current baseline and authority

Repository: Temult/TrogNet. Exact parent commit:
`51f05cddef8d49941c52c4c8ae62c2c755ff02c6`.
Exact parent tree: `285ca0cea03c8f141c11c6775f8c9c52994c5cf2`.
The preferred local parent was verified clean before an isolated candidate was created.
Candidate commit/tree, hashes and full test results are recorded in the final handoff.
This is a local source/config/test repair; no push, deployment or live qualification.

Owner-supplied context, not independently verified by this source task: E06 gateway
is live, administration is Tailscale-only, public SSH is closed, permanent fence is
active with legacy_closed=true and high_water=0, and credential authority is generation 2.
The remotely managed trognet-origin tunnel has a dedicated connector account and active
HA connections. Preserve all of that state; do not rerun archival, renewal or installers.

Owner reports VPC Service trognet-gateway exists with service ID
`01a10c6d-8025-7163-a6b9-c87a58e11918`. Intended target is HTTP 127.0.0.1:19456
through trognet-origin. Target settings are configuration intent, still requiring
independent owner verification before live inference. No public origin hostname or
custom DNS zone is part of E06R1.

Historical Gate 5I PASS remains an owner prerequisite; this repair neither reproduces
nor freshly verifies it. No credentials, protected host state or blind cases were read.
The old extractive Portal is unchanged and remains rollback. Local tests establish
source behavior only, not actual Workers VPC, Access, Durable Object or provider behavior.
