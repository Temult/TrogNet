# E06R1 future owner execution order — NOT_RUN

This is a review sequence, not authorization to deploy or infer. Use a separately
approved owner deployment window. Do not execute historical E06 host preparation.

1. Verify handoff hashes, exact parent/candidate identities, full Linux Node 22.23.3
   test results and runtime/SOURCE_MANIFEST.json. Build off-host using the lockfile.
2. Preserve current generation-2 credentials, gateway release, permanent fence,
   protected state, trognet-origin connector/token, Tailscale-only administration and
   untouched extractive Portal. Do not rerun archival, Gate 5I, installers or renewal.
3. Independently inspect existing VPC Service trognet-gateway, ID
   01a10c6d-8025-7163-a6b9-c87a58e11918: type HTTP, tunnel trognet-origin, IPv4
   127.0.0.1, HTTP port 19456. Check connector health and account VPC availability.
   Metrics/existence alone do not prove target settings. STOP on mismatch; correcting
   the service requires separate owner review. Do not create a VPC Network binding,
   DNS route, public origin, custom domain or replacement tunnel.
4. Copy runtime/wrangler.e06.example.json to private owner configuration. Keep Worker
   name trognet-e06-owner-front-door, workers_dev=true, preview_urls=false and
   APP_ORIGIN=https://trognet-e06-owner-front-door.valateve.workers.dev. Keep ENABLED
   false. Preserve the REQUESTS class, e06-owner-ledger-v1 object key, migrations and
   existing permanent namespace; never reset or replace ledger storage. Verify any
   existing namespace identity before deployment, STOP if it cannot be established.
5. Under separate authorization, configure Access protection for the entire workers.dev
   hostname, owner only with no bypass/service-token policy. Privately obtain and pin
   trusted public RS256 JWKs (1-8), exact issuer, audience and owner subject. Remove
   ORIGIN_URL from all variables/secrets/environments. Bind only PRIVATE_GATEWAY to the
   exact VPC Service above. ORIGIN_ADMISSION is the only gateway admission secret in
   Worker; owner transfers it privately. No provider/owner-admission/token-export keys.
6. Review the effective deployment configuration including dashboard overrides, route,
   service binding and namespace. Use an owner-reviewed Wrangler version supporting
   vpc_services. From runtime/, future command is `wrangler deploy --config <private-config>`
   with ENABLED=false. Keep private config beside the example so main/module paths
   resolve, or adjust those paths in the reviewed private copy. Never use remote dev
   bindings for this repair. Keep logs/traces/payload capture disabled.
7. Verify Access blocks unauthenticated/nonowner access and preview URLs remain off.
   Verify deployed source and bindings. Only after source, Access, target and namespace
   checks pass, privately set ENABLED=true and redeploy the same reviewed configuration.
   Then verify Worker denial cases. Browser JWT/cookies never cross the VPC binding.
8. In a separately authorized live qualification, open /e06/qualification and explicitly
   load visible models. This is a provider-backed catalog operation, NOT_RUN here.
   Preserve a sanitized catalog receipt, prior Gate 5I receipt and current source/route
   evidence. Check host resource sufficiency without changing gateway state.
9. Before any inference, correlate current fence/high_water with the permanent DO ledger;
   supplied high_water=0 is context only. STOP on inconsistent sequence or lost storage.
   Capture read-only fence-status before/after via owner kit. Select a visible intended
   GPT-6 Astra model and explicitly authorize exactly one tiny inference through the UI.
10. On timeout/error STOP; GET-only reconciliation may recover stored completion, never
    retry/reset. Final owner PASS requires reviewed source/Access/VPC target path,
    completed browser/DO receipt and exactly one correlated gateway sequence advance.
    Browser success alone is PASS_PENDING_OWNER_PATH_CORRELATION, not LIVE_QUALIFIED.
11. Rollback by disabling E06 Worker and using untouched extractive Portal. Preserve
    gateway, tunnel, credentials, fence and DO ledger; never restore old state. Product
    binding or retirement of rollback requires a later review.

See owner/OWNER_KIT.md for scope and evidence. No command here was run against a live
account or host. Workers VPC is beta; live behavior remains an owner qualification boundary.
