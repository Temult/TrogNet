# E06 front-door contract and threat model

## Trust boundaries and exact contract

Browser -> Access authenticates the session; Worker independently verifies the signed
application JWT and exact owner subject. Email/header assertions alone confer no access.
Worker -> single Durable Object owns admission and persistence. Durable Object -> fixed
PRIVATE_GATEWAY Workers VPC Service uses only ORIGIN_ADMISSION. The binding selects
the registered service; its owner-configured target must be verified independently.
The synthetic HTTP host cannot select a target. Legacy ORIGIN_URL is rejected and no
global fetch fallback exists. Access protects the workers.dev browser front door; no
public origin hostname/custom DNS zone is required. Tunnel -> loopback gateway crosses
no public OCI application port. Gateway -> provider is the existing plan-backed path.
Oracle alone holds provider credentials. Same-UID/root or a compromised Cloudflare
account controlling code/config is outside this application's attacker boundary.

| Browser route | Method | Result / origin operation |
|---|---|---|
| /e06/qualification | GET | Authenticated static owner qualification UI; no origin call |
| /e06/models | GET | One GET /models; sanitized visible catalog |
| /e06/responses | POST | At most one POST /responses per admitted identity |
| /e06/requests/{request_id} | GET | Durable saved attempt only; no origin call |
| Everything else, queries, other methods | any | 404; no generic proxy |

POST body is exactly `{request_id,payload,new_attempt_of?,consent?}`. request_id is
16-96 ASCII letters/digits/underscore/hyphen. payload is exactly model, instructions,
input, store:false, stream:true. Input has 1-13 user/assistant text messages. The new
attempt consent is the literal I_AUTHORIZE_ONE_NEW_ATTEMPT, referencing the latest
identical-intent predecessor. This is an application confirmation, not a digital
signature proving a human clicked; the authenticated owner application is trusted.

The Worker must see the pinned app URL origin. POST requires exact same Origin,
application/json and X-TrogNet-CSRF:1. Cross-site and same-site-subdomain Fetch Metadata
are denied, as is a mismatched Origin on GET. No Access-Control-Allow-* headers, no
OPTIONS support, no wildcard origin. Same-origin Access cookies may authenticate at
Cloudflare but are stripped before internal forwarding. The qualification UI has a
nonce CSP, no third-party resources and textContent-only rendering of catalog/results.

Incoming headers have a 32-name/8192-byte application budget after platform
normalization. Platform duplicate/header parsing limits still need deployment review.
Authentication consumes only Cf-Access-Jwt-Assertion. Origin, Content-Type,
Sec-Fetch-Site and X-TrogNet-CSRF govern request admission. Cookies and incidental
browser headers are tolerated within budget but never forwarded. All caller
X-TrogNet-* except CSRF, Authorization, Proxy-Authorization, Range, Content-Encoding
and X-HTTP-Method-Override are rejected. User email, forwarded host/IP, request IDs
and admission headers are never trusted to authorize work.

Generated trusted origin headers ONLY: Accept:application/json,
X-TrogNet-Admission; for POST, Content-Type:application/json and the coordinator's
X-TrogNet-Request-Id. HTTP transport/platform may add Host, length and Cloudflare
network metadata. No browser headers, JWT, cookies or arbitrary URL/body fields pass.
The gateway independently rejects browser Origin/Cookie. No Worker route reaches
health, token export, refresh, import, owner admission or the owner UNIX socket.

| Resource | Bound |
|---|---|
| Browser request envelope | 36 KiB streamed UTF-8; 15-second read |
| Canonical gateway payload | 32 KiB |
| Instructions / each message | 16000 / 12000 UTF-8 bytes |
| Model slug | 128 bytes and restricted ASCII |
| Browser/Worker headers | 32 normalized names, 8 KiB |
| Origin JSON response | 256 KiB streamed |
| Returned answer text | 32 KiB UTF-8 |
| Catalog | <=256 slug/display-name rows, 128/256 bytes per field |
| Gateway provider catalog | existing 1 MiB bound |
| Gateway SSE | existing 2 MiB stream / 256 KiB event |
| Coordinator origin deadline | 115 seconds including body read; redirect:error |
| Gateway | existing 15-second refresh / 90-second catalog+response budget |
| Qualification browser deadline | 120 seconds; timeout means uncertainty |
| Coordinator | one ordinary origin operation per resident instance; durable admission across restart |
| Gateway | existing one ordinary request, 16 connections; no transparent retries |
| Origin replay data | permanent high-water + <=512 legacy hashes |
| Front-door history | <=2048 attempts; hard stop, no TTL/eviction |

An evicted coordinator may leave an older origin operation in flight; the gateway's
single ordinary request gate and durable identity fence remain authoritative. New
explicit attempts during that ambiguity are separate work, never replay. Status reads
may run while origin work is pending. No progress claims are inferred from elapsed time.

## Threat model

| Threat / failure | Control | Residual / response |
|---|---|---|
| Missing/forged Access JWT | RS256 signature, pinned public keys, issuer/audience/expiry/type | 401; key rotation fails closed |
| Authenticated non-owner | Exact subject match after signature verification | 403 |
| Browser admission/owner header forgery | Reject incoming X-TrogNet admission headers; construct fresh origin headers | 403; origin secret remains server-side |
| Origin/Cookie CSRF | Same origin, JSON, custom header, Fetch Metadata, no CORS | XSS or compromised owner session remains a trusted-session risk |
| Generic proxy/SSRF | Exact routes + fixed configured HTTPS origin; redirects rejected | Configuration changes are owner authority |
| Token/owner socket exposure | No route/binding; separate socket and Tunnel account inaccessible paths | Never tunnel UNIX sockets |
| Duplicate transport/Cloudflare retry | Same browser ID durable record; origin sequence high-water | Saved result or consumed uncertainty, never new dispatch |
| Duplicate intent under new ID | Canonical payload digest and latest predecessor consent | Paraphrases/changed payloads are distinct intent; no semantic classifier |
| Crash between commit and dispatch | Durable uncertain record before fetch | False-positive consumption is intentional |
| Provider rejection or transport loss | No raw body; no inference retry | HTTP rejection is not proof of no inference |
| Gateway ledger exhaustion | Legacy hard stop; owner-reviewed permanent fence | No deletion escape hatch |
| Archive then old ID replay | Permanent legacy exclusions plus sequence prefix fence | Preserve fence/namespace forever; old backup restore forbidden |
| Worker history exhaustion | 2048 hard stop, no eviction | Future history compaction is OPEN |
| Oversized/slow request or response | Streaming byte ceilings, deadlines, serialized work | Authenticated owner can consume resources; platform controls require review |
| Secret/provider-error echo | Gateway bearer redaction + strict front-door shape, fixed labels | No raw usage/reasoning/headers/errors returned |
| Logs leak bodies/credentials | No application access logger, fixed errors, observability disabled template | Owner reviews platform logging/retention |
| Configuration or source rollback | Manifest verification, state schema fails closed on older source | Rollback to extractive Portal; preserve newest state |
| Small VM memory pressure | Existing gateway limits; separately bounded Tunnel | Owner must measure real memory and STOP on OOM |
| Direct origin attack | Origin secret before expensive work; loopback behind Tunnel | Availability attacks remain possible; no public app port |

## Failure state table (required A-L)

| Case | Known facts / state | Reconciliation and new attempt |
|---|---|---|
| A before origin admission | Worker auth/body rejection: no admission. After durable marker, trusted origin ADMISSION_DENIED: not_dispatched | Fix cause; consumed admitted IDs still require explicit new attempt |
| B before gateway reservation | Confirmed body/busy rejection can be not_dispatched; Tunnel failure cannot establish reservation absence | Transport failure stays uncertain |
| C after reservation before dispatch | Gateway tombstone/fence already durable; model rejection proves no inference, other generic failures conservative | No reuse; owner-authorized new ID only |
| D confirmed provider rejection before inference | Only independent authoritative proof could establish this; HTTP rejection alone is insufficient | Current route conservatively uncertain; no replay |
| E possible dispatch without final response | uncertain, inference unknown | GET saved completion; otherwise STOP |
| F successful completion | Strict gateway schema/hash + durable completed result | Repeated same ID returns saved answer without dispatch |
| G caller disconnect | Before admission: stop. After possible admission: operation may finish | Preserve identity; GET only |
| H Worker timeout/eviction | Durable uncertain marker if admitted | Never resume fetch from storage |
| I Tunnel failure | Could precede or follow reservation/dispatch | uncertain regardless of generic network error |
| J gateway restart | Legacy tombstones or high-water survive fsync; newest credentials preserved | Replayed ID denied |
| K Cloudflare retry | Same immutable ID resolves existing durable attempt | No coordinator retry wrapper or reminted identity |
| L deliberate new attempt | New browser ID + exact latest predecessor + explicit consent | One new gateway sequence; may duplicate provider work by deliberate choice |

## Error/output mapping

401 AUTH_REQUIRED; 403 OWNER_REQUIRED/ORIGIN_REJECTED/HEADER_REJECTED; 404 NOT_FOUND
or UNKNOWN_REQUEST; 400 INVALID_REQUEST; 413 BODY_TOO_LARGE; 431 HEADERS_TOO_LARGE;
409 consumed/conflicting/uncertain attempt; 503 busy/unavailable. Malformed JSON and
unrecognized failures are fixed unavailable responses. Upstream body/header details
are never relayed. Models and completed text are reconstructed from allowlisted shapes.
Every response is no-store; JSON is nosniff. The browser's saved completion is private
owner data; it is not publication acceptance or proof of answer quality.
