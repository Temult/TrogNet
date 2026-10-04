# TrogNet

TrogNet is an independent, open-source EVE Echoes research/client project.
This repository is in **pre-alpha / publication bootstrap**.

## Current state: PUBLIC_SCAFFOLD

The plan-integration runtime is being prepared separately and is **not available
in this first scaffold commit**. No ChatGPT-plan authorization has been performed
through this public repository. Repository existence does not establish OpenAI
entitlement, plan-sharing eligibility, or approval of any integration.

`PUBLICATION_STATE.json` is the machine-readable interlock: runtime publication,
dynamic registration authorization, and live plan inference authorization are all
false. There is no runnable client, OAuth flow, or deployment in this scaffold.
The only executable tools here check publication hygiene and stage reviewed files.

Private research/evidence datasets are intentionally not distributed here. A future
public runtime will consume user-supplied/local projections rather than bundle
private data. The software is licensed under [Apache-2.0](LICENSE).

TrogNet is not affiliated with or endorsed by OpenAI, NetEase, CCP Games, or Cloudflare.

## Publication and review

- [Public/private boundary](docs/OPEN_SOURCE_BOUNDARY.md)
- [Architecture and ownership](docs/ARCHITECTURE.md)
- [Integration status](docs/PLAN_INTEGRATION_STATUS.md)
- [Privacy and credentials](docs/PRIVACY_AND_CREDENTIALS.md)
- [Reviewed runtime import](docs/E05R1_IMPORT_PLAN.md)
- [Security](SECURITY.md), [contributing](CONTRIBUTING.md), and [trademarks](docs/TRADEMARKS.md)

With Python 3.11 or later and Git installed, run the local publication check:

```sh
python tools/publication_hygiene.py --root . --history
```

This uses the standard library, makes no network requests, and requires no secrets.
Passing it is a mechanical check, not semantic approval or authorization to use a plan.
