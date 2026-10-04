# TrogNet OSS client candidate

Local runtime candidate under Apache-2.0, selected from the scaffold. Do not register this client until the owner has published the selected runtime and provided a publication receipt.

## Build and local qualification

Requires Node >=22.16 and TypeScript 5.8.3. Install the locked compiler with `npm ci --ignore-scripts`, then `npm test`. Tests use synthetic identity/token data and injected providers; one test uses an HTTP loopback listener. Run `npm run bootstrap` for a default in-memory dry run of dynamic registration, signature/identity/scope validation, sealed broker import and aperture closure. No account is contacted.

## Architecture

`src/oss-oauth.ts` enforces issued-client, host and verified returning subject identity; workspace binding belongs to the provider-issued registration over the inherited OAuth/PKCE primitives. `scripts/oss-bootstrap.mjs` is the local authorization helper. It defaults to fixtures. Explicit live mode requires an owner publication receipt. `scripts/oss-import.mjs` sends a sealed record through the temporary Access-protected importer after its digest is preauthorized. The broker serializes refresh and freezes ambiguous outcomes. Ordinary browser sessions use Cloudflare Access; provider tokens stay in the broker and never enter evidence or browser responses.

The selected Worker entrypoint is `src/oss-plan-staging.ts`. It admits Pro plan mode only, rejects API keys and credits fallback, retains the inherited qualification receipt gate, and requires the selected slug to be present in the account-discovered visible catalog. Configuration provides a selection, never a substitute for the catalog. `src/owner-staging.ts` preserves extractive rollback. The inherited generic library includes API support for compatibility, but no OSS plan deployment template selects that route.

`src/app.ts` owns existing request idempotency and persistence. It freezes uncertain post-dispatch outcomes. `scripts/cyberdeck-seam.mjs` is a bounded composer and validator for offline rehearsal, not a deployed agent framework or E06 route. Exact evidence and accepted-knowledge readers remain in source with synthetic empty release pins. Native class labels and OPEN boundaries are retained; structural validation does not prove prose truth.

## Intentionally excluded

No private research rows, source archives, Master Codex, E04B evidence payloads, hidden evaluation material, D1 contents, credentials, account identifiers, personal paths or operational receipts are included. Empty synthetic reader pins prevent accidentally serving a private release. To use a separately authorized private evidence release, bind it privately through the reader schema/hash contract; do not add it to this public repository. Deployment configurations have rejected placeholders and inference disabled.

See SECURITY.md and OWNER_BOOTSTRAP_RUNBOOK.md. Publishing software is distinct from accepting research evidence or establishing a live entitlement. Provider policy, renewal schedule encoding and remote-host eligibility remain subject to owner verification against the official protocol before activation.

First enrollment learns the verified subject and requires explicit local confirmation. Pending issued registration is persisted before exchange. The runtime lives beneath runtime/; root policy and license govern the combined repository. No private reader payloads are included.
