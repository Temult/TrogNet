# E06 executive summary — E06R1 transport revision

E06R1 uses the Access-protected workers.dev front door and a mandatory PRIVATE_GATEWAY
Workers VPC Service binding. Legacy ORIGIN_URL fails closed. No custom DNS zone or
public origin hostname is required. Owner verifies the existing service target before
live inference; Workers VPC beta/account behavior remains OPEN. See CURRENT_BASELINE.md.

The paragraphs below summarize inherited E06 behavior; prior test counts are historical.

Implemented a parallel owner-authenticated Cloudflare front door, durable attempt/intent
coordination, permanent origin replay fencing, a prepared Oracle/Tailscale/Tunnel owner
kit, and an owner-only one-inference qualification interface. The existing extractive
Portal and credential rotation semantics are preserved.

The security boundary is explicit: Cloudflare can hold only the distinct gateway origin
admission secret. Provider credentials, encryption key and owner admission remain on
Oracle. The owner socket has no front-door route or Tunnel mapping. No fallback is wired.

Replay prevention survives gateway restart and archive compaction. Every admitted
front-door attempt is durably uncertain before its one origin fetch; identical requests
return saved state. New attempts for the same canonical payload require explicit consent
referencing the latest predecessor. The origin uses a permanent consumed-sequence prefix
plus permanent legacy hash exclusions. Exhaustion never silently deletes history.

A bounded existing deadline defect was repaired: a late catalog completion cannot begin
inference after cancellation. Its regression and the existing E05 suite pass locally.
See TEST_RESULTS.md for exact final counts and limits of the test evidence.

IMPLEMENTED and DETERMINISTICALLY_TESTED apply to local source and synthetic tests.
OWNER_READY applies to this review package and templates, conditional on owner-selected
configuration and preflight. LIVE_QUALIFIED does not apply to E06. All E06 owner/live
deployment and inference actions are NOT_RUN. The independent Gate 5I prerequisite is now
PASS; actual E06 platform deployment, resource measurements, disaster recovery and future
front-door ledger compaction remain explicitly OPEN.

The next action is owner review of the single handoff, followed by the ordered owner
procedure. This package performs no deployment and authorizes no inference by itself.
