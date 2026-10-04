# TrogNet

TrogNet is an independent, open-source EVE Echoes research/client project.

## Current state: PUBLIC_RUNTIME

The reviewed OSS runtime is now public under [`runtime/`](runtime/).

- Reviewed runtime source files: **68**
- Publication candidate SHA-256: `30a277acf426cfdec9fd3ade9b63fceab3e417a186229f3a5ecb92aa053f93f7`
- Dynamic registration authorized: **no**
- Live ChatGPT-plan inference authorized: **no**

The published runtime contains the OAuth/PKCE and credential-broker implementation,
plan-only provider path, bounded evidence/request composition interfaces, schemas,
deployment templates, synthetic tests, and owner bootstrap tooling that were qualified
locally in E05R2.

Publishing the source does **not** establish OpenAI entitlement or permission to use a
ChatGPT plan. Real `dynamic_agent_client` registration, owner OAuth authorization,
remote-host qualification, unattended refresh, and live model calls remain separate
explicit gates.

Private research/evidence datasets are intentionally excluded. In particular, this
repository does not distribute the recovered-client corpus, Master Codex source archives,
E04B evidence payloads, Titan research datasets, blind holdout material, D1 data, account
credentials, or owner receipts.

## Local build

From `runtime/`:

```sh
npm ci --ignore-scripts
npm test
npm run bootstrap
```

The bootstrap command defaults to synthetic/offline fixtures. See
[`runtime/OWNER_BOOTSTRAP_RUNBOOK.md`](runtime/OWNER_BOOTSTRAP_RUNBOOK.md) before any
separately authorized live operation.

## Publication and security

- [Publication state](PUBLICATION_STATE.json)
- [Runtime publication receipt](RUNTIME_PUBLICATION_RECEIPT.json)
- [Public/private boundary](docs/OPEN_SOURCE_BOUNDARY.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Plan integration status](docs/PLAN_INTEGRATION_STATUS.md)
- [Privacy and credentials](docs/PRIVACY_AND_CREDENTIALS.md)
- [Security](SECURITY.md)

TrogNet is licensed under [Apache-2.0](LICENSE) and is not affiliated with or endorsed by
OpenAI, NetEase, CCP Games, or Cloudflare.
