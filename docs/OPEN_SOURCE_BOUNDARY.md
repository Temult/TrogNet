# Public/private boundary

## Publication status

The reviewed 68-file runtime source is public under `runtime/`. The boundary below continues to exclude all private research, evidence payloads, credentials, account state, and blind-evaluation material.

## Intended public software, only after E05R1 review

- Sign in with ChatGPT / OAuth protocol code.
- PKCE and dynamic-registration logic.
- Credential broker implementation.
- Plan provider adapter and plan-only runtime entrypoint.
- Bounded request-composition interfaces.
- Evidence/knowledge projection readers and schemas.
- Deployment/configuration templates containing placeholders.
- Tests, security/operational documentation, and build instructions.

These are intended future contents, not software available in this scaffold.
Publishing code does not authorize dynamic registration, OAuth, or live inference.

## Private and excluded

- OAuth access, refresh, and ID tokens; Cloudflare Access credentials.
- Bootstrap secrets, encryption keys, API keys, and other credential material.
- D1 contents; private account IDs/audiences unless intentionally documented.
- Personal email addresses, filesystem paths, host/device identifiers, owner receipts.
- EVE Echoes recovered-client corpus and Master Codex source archives.
- Private research corpus; E04B evidence payload contents; Titan research datasets.
- Screenshots or personal observations not explicitly cleared.
- Private evaluation keys, holdout cases, and evaluator payloads.
- Proprietary/private source inputs not required to reproduce the client.

Future code may define interfaces for local inputs without distributing those inputs.
No excluded dataset becomes Apache-licensed merely because software is published.
Use synthetic fixtures only; schemas must not embed real private example payloads.

## Review boundary

Only exact, declared, hash-verified files from the reviewed publication candidate may
be staged. A clean scan cannot determine ownership or consent: the owner must inspect
the final public diff. New private inputs or third-party material require separate
clearance. Keep private review receipts outside the public repository.
