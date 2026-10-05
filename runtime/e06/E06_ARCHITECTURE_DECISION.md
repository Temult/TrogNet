# E06-A checkpoint / architecture decision

Chosen: a separate Access-authenticated Worker, a single owner Durable Object for
serialized request admission and persistent intent/attempt records, and a fixed
HTTPS Tunnel origin pointing only to 127.0.0.1:19456. No existing Portal binding changes.
Worker validates RS256 Access JWTs against owner-pinned public verification keys,
issuer, audience, expiry and exact subject. Keys are public configuration, not OAuth
credentials. Rotation requires owner updating the pinned key set; failure is closed.

The Durable Object commits an uncertain attempt BEFORE its single origin fetch.
Every attempt maps its browser ID to an increasing gateway sequence. The gateway
must be explicitly switched offline into permanent sequenced-only mode. Its durable
high-water mark consumes all lower sequence IDs, even after detailed tombstones are
archived. Existing legacy IDs are permanently forbidden at that transition.

Rejected: token-export Worker; generic proxy; eventually consistent KV admission;
request-ID regeneration on retry; TTL tombstones; deleting hashes without a permanent
fence; inferring safe replay from transport errors; changing the extractive Portal.

OPEN: owner-selected hostname, Access subject/audience/public key rotation procedure,
Tunnel deployment and E06 platform qualification, one live inference, and future
storage growth policy. The front-door intent ledger has a hard stop, no automatic
history deletion. These do not block offline implementation.

Downstream invariants: Oracle alone holds provider credentials; no billing fallback;
no owner socket exposure; one origin fetch per consumed browser ID; restart never
replays; new attempt requires explicit consent tied to previous attempt; no state
rollback; bounded JSON/headers/time/resources; public errors contain fixed labels.

Status: DESIGN_CHECKPOINT_RECORDED; not deployed or live-qualified.


## Reconciled owner prerequisite

After the worker completed, the independently owned Gate 5I qualification returned PASS. That closes the unattended-runtime renewal prerequisite but does not live-qualify E06, Cloudflare, Tunnel, or the front-door inference path.
