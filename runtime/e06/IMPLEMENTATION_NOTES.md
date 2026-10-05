# E06 implementation notes

Separate modules under runtime/e06 add the front door, persistent coordinator, replay
fence migration and owner kit. Existing Portal, extractive rollback, publication/evidence
readers, OAuth grant logic and refresh schedule are unchanged. The original E06 gateway/protected-store changes are inherited without modification.
E06R1 changes only E06 front-door transport, its tests/configuration, materially stale
E06 documentation and the source manifest. No gateway, broker, fence or timeout code changes.

PRIVATE_GATEWAY.fetch is mandatory at both front-door and coordinator boundaries.
ORIGIN_URL presence fails closed, including empty/undefined values. Coordinator origin
calls enforce the two exact gateway paths and use a fixed synthetic HTTP URL, preserving
Accept and X-TrogNet-Admission plus Content-Type and X-TrogNet-Request-Id for responses.
No incoming URL, query, Host, cookie, JWT or arbitrary header is copied. A binding failure
retains the existing uncertainty semantics. The constructor no longer accepts a fetcher
transport override; tests inject the binding itself. The registered VPC Service selects
the actual destination, not the synthetic host. Real account behavior remains OPEN.

The gateway now reserves via reserveGatewayRequest, preserving the original legacy
hash ledger until explicit offline migration. Sequenced mode requires the fence and
returns a correlation hash on completed E06 responses. Legacy responses retain their
original shape. The store retains its same protected permissions, lock, atomic writes,
fsync, poisoning and credential record. The optional requestFence is validated in state;
older code rejects the new field rather than silently ignoring replay protection.

A bounded existing defect was isolated during E06 review: a provider catalog promise
that completes after the enclosing deadline could continue into inference in a transport
that ignores cancellation. One abort check immediately after catalog completion prevents
late dispatch. The regression releases a delayed catalog only after timeout and proves
zero inference calls. No refresh or provider protocol behavior was broadened.

The sequence fence permanently consumes a numeric prefix, including gaps. Legacy hash
exclusions prevent a previously consumed arbitrary ID that happens to match the E06
format from becoming replayable. Detailed timestamps are archived; legacy hashes remain
bounded permanent state. The DO maintains canonical-intent and browser-ID records with
transactional pre-dispatch uncertainty; no background job resumes uncertain work.

Static Access public-key pins avoid a new online authentication dependency or token URL
fetch. Owner key rotation is an explicit maintenance dependency. The selected front-door
module graph imports auth verification, not the older token-export or plan broker Worker.
No API-key/credits path is wired into E06. Existing generic compatibility code elsewhere
in the repository is not evidence of an E06 fallback.

The qualification interface is a separate owner-only route. Opening it does not fetch
models or infer. The model button is an explicit no-inference operation. The inference
button requires the owner attestation and selected visible model, then records an ID
before one POST. Saved results and GET-only reconciliation never trigger inference.

Deterministic tests use signed synthetic JWTs, injected transports, a transactional
storage model and real Linux protected-store/loopback/process-crash tests. They do not
qualify Cloudflare's scheduler, deployed Access policy, Tunnel, OCI or live GPT-6 Astra.
The owner kit's shell installer is syntax checked only; no installation was performed.

SOURCE/DERIVED/OBSERVED/MODEL/OPEN vocabulary and all player knowledge semantics remain
unchanged. No private evidence or blind-holdout files were read or copied. The optional
O2 bundle was inventoried only; no bundled workflow was executed or promoted to authority.
