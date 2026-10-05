# E06-C checkpoint: identity, uncertainty and compaction

Browser attempt IDs are immutable, bounded 16-96 character identifiers. The coordinator
maps each to a permanent increasing gateway ID e06_ plus 16 decimal digits. It hashes
the canonical reviewed payload as intent identity, including model, instructions and
ordered messages. Equivalent paraphrases are not detected. Same payload under a new
ID requires the exact latest predecessor and I_AUTHORIZE_ONE_NEW_ATTEMPT consent.
No code path mints a replacement browser attempt automatically.

State: absent -> durable uncertain -> completed or not_dispatched or uncertain.
The uncertain write precedes the only origin fetch. A crash before that write causes
no dispatch. A crash after it leaves a consumed attempt, even if no dispatch happened.
A completed result is returned only after origin completion validation and persistence.
GET /e06/requests/{id} reconciles a saved result without provider work. Unknown means
no front-door record found, not proof about an unrelated origin call.

The origin migration exports legacy hashes/timestamps with file fsync and directory
fsync before one atomic protected-state transition. Legacy arbitrary IDs close forever.
The at-most-512 legacy hashes remain as compact permanent exclusions, including a hash
that might collide with a future formatted sequence. Every sequence reservation fsyncs
its high-water mark before provider work. All lower sequences are consumed, including
unissued gaps. No detailed sequence history is required at the origin. Removing the
archive cannot reopen identities because the durable fence and legacy exclusions remain.
The archive is audit evidence, never a credential backup or replay authority.

DO storage is permanent, transactional and bounded at 2048 attempts. It never evicts
intent mappings. Exhaustion stops admission. Future front-door history compaction is
OPEN and deliberately not implemented by deleting rows. Sequence/gateway fences,
DO namespace and storage may never be reset or restored from an older backup. State
loss requires STOP and a separately reviewed recovery protocol; no automatic rebase.

Pre-origin cancellation is rejected before admission where observable. After admission,
caller loss does not cancel/retry the durable operation. Worker/Tunnel/network timeout
is uncertain. A valid authenticated gateway completion can reconcile uncertainty to
completion. A provider HTTP rejection remains uncertain because status alone does not
prove no inference. Positive upstream labels for admission/body/model rejection record
not_dispatched but still consume identity. GATEWAY_NOT_READY remains conservative.

OPEN: actual Cloudflare scheduler/storage and Tunnel behavior require owner validation;
semantic duplicate detection beyond identical canonical payload; provider-side factual
reconciliation after ambiguous dispatch; durable state disaster recovery. None permits
transparent replay. No live qualification is claimed.
