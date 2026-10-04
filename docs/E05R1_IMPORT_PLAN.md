# E05R1 reviewed runtime import

This procedure stages a candidate for review. It does not implement the runtime,
publish it, perform OAuth, register a client, call a model, or deploy infrastructure.
Python 3.11+ and Git are required. No third-party Python packages are required.

## Required private review inputs

Keep all receipts and reports outside the public repository. Obtain from E05R1:

1. A publication-only ZIP with an exact SHA-256 delivered through the owner-approved
   handoff. Never supply the full private application bundle. ZIP entries must be
   regular files at repository-relative paths, with no directory entries, symlinks,
   metadata directories, absolute paths, duplicate/case-colliding paths, or traversal.
2. A boundary manifest declaring every public file and its SHA-256. The declared set
   must exactly match the ZIP. Each file must have classification `public-software`.
3. Privacy/secret scan, local build, and local tests PASS reports for that exact
   package, referenced by file SHA-256 in a private evidence receipt. The receipt
   binds both the package hash and the byte-exact boundary manifest hash.
4. Confirmation that there are no private data payloads, absolute owner paths,
   token/credential material, uncleared third-party inputs, or real holdout fixtures.

The importer accepts a publication ZIP directly so the package hash is inseparable
from the copied bytes. It reads the ZIP without executing or extracting arbitrary
paths. All inputs are copied from verified in-memory bytes. A directory is not
accepted as an unbound substitute for the exact package.

Boundary manifest structure (replace descriptive placeholders with actual hashes):

```json
{
  "schema": "trognet-runtime-boundary/v1",
  "package_sha256": "<64 lowercase hex characters>",
  "private_payloads": false,
  "files": [
    {
      "path": "src/client.py",
      "sha256": "<64 lowercase hex characters>",
      "classification": "public-software"
    }
  ]
}
```

Evidence receipt structure:

```json
{
  "schema": "trognet-runtime-evidence/v1",
  "package_sha256": "<package hash>",
  "manifest_sha256": "<hash of exact manifest bytes>",
  "privacy_secret_scan": {"status": "PASS", "report": "privacy-report.txt", "sha256": "<report hash>"},
  "local_build": {"status": "PASS", "report": "build-report.txt", "sha256": "<report hash>"},
  "local_tests": {"status": "PASS", "report": "tests-report.txt", "sha256": "<report hash>"}
}
```

Reports must be adjacent regular files. Hashes establish integrity, not truth or
authorship: the owner must inspect their provenance, commands, results, and exact
package coverage. The tool does not execute candidate code or rerun its build/tests.
E05R1 is responsible for running those checks in its controlled review environment.

## Stage deterministically

Start from the clean, current public main checkout. The first import accepts only
new files. Protected scaffold files, workflow files, tools, and Git settings cannot
be replaced through this seam. Any needed modification of those files requires a
separate reviewed diff. Binary/archive inputs fail closed pending explicit policy
review. The checker may flag benign content; resolve policy exceptions separately,
never by disabling the gate in the candidate.

Use fresh, disjoint paths outside the repository for both outputs:

```sh
python tools/import-reviewed-runtime.py --repo . --package ../review/candidate.zip --sha256 PACKAGE_SHA256 --manifest ../review/boundary.json --evidence ../review/evidence.json --worktree ../runtime-review --review-output ../runtime-review-receipt
```

The gate verifies the package, exact file set, hashes, required evidence, path safety,
and base/candidate hygiene. It stages the bytes in a detached Git worktree, keeping
main and all publication interlocks unchanged. It returns a final staged tree ID,
binary public diff and diff SHA-256, file hashes, and `STAGED_AWAITING_OWNER_REVIEW`.
Failures never update main. If a failure occurs after worktree creation, preserve
that isolated worktree for diagnosis; use a new output location on retry.

## Owner review and publication, a separate authorized operation

1. Inspect the entire `FINAL_PUBLIC_DIFF.patch` and actual staged files. Review the
   package/manifest identities, report provenance, license compatibility, private
   boundary, and build/test coverage. Mechanical PASS is not semantic acceptance.
2. Record owner approval outside the public repository, binding the package hash,
   base commit, staged Git tree, and diff hash from `STAGING_RECEIPT.json`. Require
   fresh review if any file, base commit, evidence, or diff changes.
3. Before creating an import commit, verify `git write-tree` in the worktree equals
   the approved staged tree, `git diff --exit-code` reports no unstaged changes,
   and the final diff hash still matches the approval. Verify the base main commit
   has not changed; otherwise restage/review. Rerun hygiene and inspect untracked
   files. Do not execute a candidate-supplied command merely because a report says PASS.
4. Only after this owner approval, create a dedicated import branch/commit from the
   staged worktree and submit the exact approved change for review. Do not include
   the private manifest, receipts, or reports. The importer never commits or pushes.
5. Verify the exact runtime commit and source files are anonymously readable in the
   public repository after approved publication. Keep runtime authorization false.
   In a separate owner-reviewed change, update publication state, checker policy,
   README, and status docs together to reflect verified runtime publication.
6. Dynamic registration and live inference require separate explicit authorization
   and qualification after runtime source is actually public. Never infer permission
   from a public repository, CI success, merge, or a runtime-published flag alone.

E05P0 stops at the scaffold and this seam. It performs none of the later runtime
import, registration, OAuth, inference, deployment, or private-data operations.
