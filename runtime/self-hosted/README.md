# Self-hosted owner gateway (E05R5, unpublished)

Node 22 on Linux, with util-linux `/usr/bin/flock`. No runtime npm dependencies.
Build with `npm ci --ignore-scripts --no-audit --no-fund` and `npm run build` in
`runtime`. Run `npm test` on Linux for the complete suite. Linux filesystem tests
explicitly skip on other systems; a Windows-only run is not qualification.

This is one owner's TrogNet origin. Credentials remain in this runtime. The new
entry point is `node self-hosted/serve.mjs`; it does not instantiate or expose the
older Cloudflare credential-export worker. Existing Cloudflare/Portal modules
are unchanged and are not connected to this gateway. E06 must replace their
token-export integration before connecting them. No API-key/credits fallback.

## HTTP contract

The listener is always `127.0.0.1`, default port 19456. Wildcard, hostname, IPv6,
and public bindings are rejected. No public OCI application port is needed.

- `GET /health`: `{ "ready": true|false }`, HTTP 200/503; local readiness only,
  never a provider probe. Expensive model operations still may fail.
- `GET /models`: authenticate using `X-TrogNet-Admission`; returns
  `{ "models": [{ "slug": "...", "display_name": "..." }] }`. Only current
  account catalog entries with `visibility: list`, in provider order.
- `POST /responses`: same admission header, JSON content type, plus a unique
  `X-TrogNet-Request-Id` (16–96 ASCII letters, digits, underscore or hyphen).
  Exactly `model`, `instructions`, `input`, `store:false`, `stream:true`.
  `input` is 1–13 `{role: user|assistant, content: string}` messages. The whole
  JSON body is at most 32 KiB. Instructions are at most 16000 UTF-8 bytes and
  each message at most 12000. This matches TrogNet's existing text request
  builder; tools, attachments, arbitrary headers and URLs are not accepted.
  Returns `{schema:"trognet-gateway-response/v1",status:"completed",text:"..."}`
  only after the shared SSE parser reaches valid completion and stream EOF.
  Text is at most 32 KiB; stream is at most 2 MiB, event at most 256 KiB.
  Missing Content-Type is accepted; an explicitly incompatible one is rejected.

All ordinary routes except health require origin admission before body parsing.
Browser Origin and Cookie headers are rejected. Responses have no CORS headers.
Header budget is 8 KiB, 32 headers; at most 16 connections, one ordinary request
in progress, 10-second headers, 15-second inbound body and 90-second provider
catalog/Responses budget. Broker renewal has its existing 15-second deadline.
No caller-supplied header reaches OpenAI. HTTP failures retain sanitized provider
status, body-shape classification, known code/parameter and bounded request ID;
these are diagnostic facts, never permission to replay. No raw provider headers, errors,
reasoning, IDs, usage objects or SSE events become HTTP output. Known bearer
values (before and after renewal) and JWT-shaped strings are rejected in output.
Fixed error labels exclude exceptions, bodies and filesystem paths.

## Durability and ownership

Use one dedicated state directory, owned by the service UID, exactly 0700. All
state and lock files must be owned by that UID, 0600, singly linked regular
files. The store rejects unsafe ancestors, symlinks, traversal, unexpected
files, malformed UTF-8/JSON, unknown schema/fields and oversized state. Inputs
are opened O_NOFOLLOW/O_NONBLOCK and checked through the opened descriptor.

The state schema is `trognet-file-broker/v1`: one `session` using the unchanged
BrokerCore record model, optional migration identity, and a bounded request
ledger. Tokens stay AES-GCM sealed using the existing token-envelope helper.
Writes use an exclusive same-directory temp file, file fsync, atomic rename,
then directory fsync. Any write uncertainty poisons that store instance.
Restart discards only the known uncommitted temp file; it never promotes it.
An acknowledged durable replacement can never be overwritten by old state.

`flock` holds the writer lock in a helper inheriting a private parent pipe.
Parent death closes that pipe and releases the kernel lock. The persistent lock
file is never unlinked. Migration and the service use this same exclusion.
Do not run an old VM helper alongside the service: it does not know this lock.
Root and same-UID malicious processes are outside this local filesystem trust
boundary; keep the account dedicated and source/deployment files root-owned.

BrokerCore alone renews credentials. `replacement_staged` finishes promotion;
`refreshing` freezes for reconciliation; `configuration_error`, `disabled` and
`reauth_required` remain blocked. Retry-not-before survives restart. There is
no startup refresh and no background renewal timer. An ordinary admitted
request renews when the existing two-minute expiry window and provider's
earliest refresh threshold both allow it. The observed six-minute lead is not
a constant or a new scheduler setting. No phase reset or blind retry command
is supplied.

## Replay boundary for E06

The origin stores a SHA-256 request-ID tombstone durably before any work for an
accepted response request. A reused ID is HTTP 409, including after restart or
ambiguous dispatch. The ledger has 512 entries, no automatic eviction, and
fails closed when full. No result/body cache is stored. Even a pre-inference
failure consumes the ID; a new ID is a deliberate new request, never an
automatic retry. Post-dispatch failures return `PROVIDER_UNCERTAIN` without
partial text. Cancellation or caller disconnect must be treated as uncertain.

E06's owner-authenticated front door must own end-to-end request identity,
intent, duplicate suppression, reconciliation and explicit new-request consent.
It must not mint a fresh ID to transparently retry an uncertain request. Before
production Portal use, define a reviewed archival protocol for the bounded
origin ledger. Until then exhaustion requires owner intervention, not deleting
state. The origin cannot recognize the same intent under a deliberately new ID.

The future Worker/Access integration may supply only the distinct origin shared
secret from its protected configuration. It must restrict access to this owner
and this connected application, strip untrusted admission headers, and avoid
logging request bodies/secrets. It must never hold the OpenAI bearer token.
Tunnel routing must expose only the three ordinary routes, never the owner
UNIX socket. No Cloudflare configuration is included or performed here.

## Owner renewal check

`qualify.mjs --socket <private-run-dir>/owner.sock --secret <owner-secret-file>`
connects to a 0600 UNIX socket in a 0700 directory. It requires a separate owner
secret, never the origin secret. The resident service runs its normal models
path with BrokerCore, then rereads persisted state. The receipt includes only
phase, generation, encrypted-envelope hash, timing, model count and booleans.
`AUTOMATIC_REFRESH_OBSERVED` requires a ready-to-ready generation increment and
a changed durable envelope in that invocation. Staged crash recovery and a
request outside the renewal window report `NO_REFRESH_OBSERVED`. Neither result
makes an inference request. `BLOCKED` records sanitized before/after state when
the normal path fails (command exit 2); unreadable state gives a fixed failure.
These outcomes do not authorize
retrying a frozen refresh. See the install plan for the later owner sequence.

## Logging and resources

Only fixed startup/stopped labels go to journald. No HTTP access logger, bodies,
tokens, authorization URLs or exception stacks. Review journald retention at
installation; do not enable HTTP/provider debug logs. systemd bounds heap,
memory, file descriptors, tasks and restarts (60 seconds, three starts per 15
minutes). Stored backoff/frozen phases survive any restart. Runtime swap is
disabled for the unit. The existing 2 GiB swap is build headroom only; install
prebuilt output where possible on the 1 GiB VM. No Docker or deployment step
is needed to run deterministic tests.
