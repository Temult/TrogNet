# E06-E checkpoint: one-shot owner qualification

Package built, NOT RUN. The browser helper is import-inert: no operation occurs at
module load. Owner serves/imports the reviewed module within the authenticated app
origin, calls visibleModels(), explicitly chooses the visible GPT-6 Astra slug, and
calls qualifyOnce with the exact one-inference authorization and reviewed deployment
attestation. No hard-coded slug substitutes for the account catalog.

Prerequisites: Gate 5I PASS is now supplied by its owner and included as reconciled evidence; Tailscale SSH proof, reviewed OCI
SSH ingress removal, installed source/manifest verification, offline fence migration,
Tunnel health proof, Access owner policy and pinned JWT keys, deployed Worker binding
to the permanent single DO namespace, no fallback/old token broker binding, and
successful authenticated /e06/models. All remain owner operations.

Exactly ONE provider inference is permitted. A browser lock and persisted attempt
marker precede POST. The Durable Object independently suppresses duplicate canonical
intent across tabs or browser storage loss. The helper has no new-attempt or reset
operation. Any further attempt requires separate explicit owner authorization and
review of the general consent protocol, never deletion of the qualification marker.

Expected receipts: deployment manifest SHA-256 and plan-only attestation; route
configuration review; gateway fence/high-water sanitized before/after observations;
request ID and gateway ID hash; selected model; HTTP status; elapsed time; gateway
completion; inference confirmed/no/unknown; answer hash. No tokens, cookies, raw
provider internals, prompts, exception messages or model output are in the receipt.

Browser success is PASS_PENDING_OWNER_PATH_CORRELATION. Final owner PASS additionally
requires installed source hashes and route bindings matching the review, gateway
sequence correlation, exactly one dispatch in this bounded operation, and the tiny
answer check. The request hash is correlation, not a cryptographic provider attestation.
No inference claim can be proven from an HTTP status alone.

STOP on timeout, disconnect, malformed response, persistence failure, absent/mismatched
path proof, hidden model, missing/unverified Gate 5I evidence, or any provider error. Preserve uncertainty.
GET-only reconcileQualification can recover a saved completion; it never resends POST.
The helper does not produce unconditional LIVE_QUALIFIED by itself.
