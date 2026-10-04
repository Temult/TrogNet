# Plan integration status

Repository phase: **PUBLIC_RUNTIME**.

| Interlock | Value |
| --- | --- |
| runtime_published | true |
| dynamic_registration_authorized | false |
| live_plan_inference_authorized | false |

The reviewed E05R2 runtime source is publicly available under `runtime/`.
Its publication candidate SHA-256 is
`30a277acf426cfdec9fd3ade9b63fceab3e417a186229f3a5ecb92aa053f93f7`.

This publication closes the source-availability prerequisite only. It does not establish
provider eligibility or authorize a client registration, OAuth grant, model call, remote
deployment, or unattended refresh.

The next permitted sequence is:

1. verify the exact public runtime and hygiene CI;
2. perform one owner-controlled `dynamic_agent_client` registration using the published
   runtime;
3. validate the returned issued client ID, signed identity, scopes, and Pro-plan access;
4. run one bounded owner-only plan probe;
5. keep live inference disabled until those receipts are reviewed.

Unattended renewal remains **NOT_LIVE_QUALIFIED** until the provider's
`earliest_refresh_at` encoding/units are authoritative and covered by edge tests.
