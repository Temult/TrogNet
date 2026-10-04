#!/usr/bin/env python3
"""Offline, fail-closed publication checks. Findings never include matched values."""
import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

REQUIRED = (
    'README.md', 'LICENSE', 'NOTICE', 'SECURITY.md', 'CONTRIBUTING.md',
    '.gitignore', '.gitattributes', 'docs/ARCHITECTURE.md',
    'docs/OPEN_SOURCE_BOUNDARY.md', 'docs/PLAN_INTEGRATION_STATUS.md',
    'docs/PRIVACY_AND_CREDENTIALS.md', 'docs/TRADEMARKS.md',
    'docs/E05R1_IMPORT_PLAN.md', '.github/ISSUE_TEMPLATE/config.yml',
    '.github/workflows/publication-hygiene.yml', 'PUBLICATION_STATE.json',
    'tools/publication_hygiene.py', 'tools/import-reviewed-runtime.py',
)
PATTERNS = {
    'private-key': r'-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----',
    'github-token': r'\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b',
    'provider-key': r'\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}\b',
    'aws-key': r'\b(?:AKIA|ASIA)[A-Z0-9]{16}\b',
    'jwt': r'\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b',
    'bearer-token': r'(?i)\bbearer\s+[A-Za-z0-9._~+/-]{20,}',
    'credential-assignment': r'''(?ix)["']?(?:access_?token|refresh_?token|id_?token|api_?key|api_?secret|client_?secret|bootstrap_?secret|encryption_?key|password|cf_access_client_secret|cloudflare_api_token)["']?\s*[:=]\s*["']?([A-Za-z0-9_./+=-]{12,})''',
    'windows-owner-path': r'(?i)\b[A-Z]:[\\/]+(?:DL|Projects|Users|Documents and Settings)[\\/]',
    'unix-owner-path': r'/(?:home|Users)/[A-Za-z0-9_.-]+/',
    'email-address': r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b',
}
PRIVATE_NAMES = re.compile(
    r'(?i)(master[-_ ]?codex|evidencebundle|recoveredfull|'
    r'e04b.*(?:payload|projection|evidence|\.json|\.csv|\.parquet)|(?:holdout|evaluator|evaluation[-_]?keys)|'
    r'titan.*(?:research|dataset)|(?:^|/)(?:private|evidence|receipts|corpus|data)(?:/|$))'
)
ARCHIVES = {'.zip', '.7z', '.rar', '.gz', '.tar', '.sqlite', '.sqlite3', '.db', '.pfx', '.p12', '.key', '.pem'}

def git(root, *args):
    return subprocess.check_output(['git', '-C', str(root), *args], stderr=subprocess.DEVNULL)

def inspect(name, data):
    findings = []
    def fail(rule):
        findings.append({'path': name, 'rule': rule})
    if PRIVATE_NAMES.search(name):
        fail('private-artifact-name')
    if Path(name).suffix.lower() in ARCHIVES:
        fail('archive-database-or-key-file')
    if Path(name).name.lower().startswith('.env') and Path(name).name != '.env.example':
        fail('environment-secret-file')
    if len(data) > 5 * 1024 * 1024:
        fail('oversize-file-requires-policy-review')
        return findings
    try:
        content = data.decode('utf-8')
    except UnicodeDecodeError:
        fail('non-utf8-file-requires-policy-review')
        return findings
    if '\0' in content:
        fail('binary-file-requires-policy-review')
    for rule, pattern in PATTERNS.items():
        for match in re.finditer(pattern, content):
            if rule == 'credential-assignment' and match.group(1).upper().startswith(('PLACEHOLDER', 'REPLACE_ME', 'YOUR_')):
                continue
            if rule == 'email-address' and match.group(0).endswith('@users.noreply.github.com'):
                continue
            fail(rule)
            break
    return findings

def check(root, history=False):
    root = Path(root).resolve()
    findings = []
    count = 0
    for p in sorted(root.rglob('*')):
        rel = p.relative_to(root)
        if '.git' in rel.parts:
            continue
        if p.is_symlink() or (hasattr(p, 'is_junction') and p.is_junction()):
            findings.append({'path': rel.as_posix(), 'rule': 'symlink-or-junction'})
        elif p.is_file():
            count += 1
            findings.extend(inspect(rel.as_posix(), p.read_bytes()))
    for name in REQUIRED:
        if not (root / name).is_file() or (root / name).stat().st_size == 0:
            findings.append({'path': name, 'rule': 'required-file-missing-or-empty'})
    try:
        state = json.loads((root / 'PUBLICATION_STATE.json').read_text(encoding='utf-8'))
        if state.get('schema') != 'trognet-publication-state/v1':
            raise ValueError('schema')
        phase = state.get('repository_phase')
        if phase == 'PUBLIC_SCAFFOLD':
            if any(state.get(k) is not False for k in ('runtime_published','dynamic_registration_authorized','live_plan_inference_authorized')):
                raise ValueError('interlock')
        elif phase == 'PUBLIC_RUNTIME':
            if state.get('runtime_published') is not True:
                raise ValueError('runtime publication state')
            if state.get('dynamic_registration_authorized') is not False or state.get('live_plan_inference_authorized') is not False:
                raise ValueError('authorization interlock')
        else:
            raise ValueError('phase requires separately reviewed gate update')
    except (OSError, ValueError, AttributeError):
        findings.append({'path': 'PUBLICATION_STATE.json', 'rule': 'invalid-state-or-interlock'})
    license_path = root / 'LICENSE'
    if license_path.exists():
        license_text = license_path.read_text(encoding='utf-8')
        if 'Apache License' not in license_text or 'Version 2.0, January 2004' not in license_text or len(license_text) < 10000:
            findings.append({'path': 'LICENSE', 'rule': 'apache-license-incomplete'})
    commits = 0
    blobs = set()
    if history:
        for sha in git(root, 'rev-list', '--all').decode().splitlines():
            commits += 1
            findings.extend(inspect('git-commit-message', git(root, 'show', '-s', '--format=%B', sha)))
            for entry in git(root, 'ls-tree', '-r', '-z', sha).split(b'\0'):
                if not entry:
                    continue
                metadata, raw_name = entry.split(b'\t', 1)
                mode, kind, oid = metadata.decode().split()
                name = raw_name.decode('utf-8')
                if mode in ('120000', '160000'):
                    findings.append({'path': name, 'rule': 'history-symlink-or-submodule'})
                    continue
                identity = (name, oid)
                if kind == 'blob' and identity not in blobs:
                    blobs.add(identity)
                    findings.extend(inspect(name, git(root, 'cat-file', 'blob', oid)))
    unique = {json.dumps(f, sort_keys=True): f for f in findings}
    return {'schema': 'trognet-hygiene-results/v1', 'status': 'PASS' if not findings else 'FAIL',
            'files_checked': count, 'commits_checked': commits, 'historical_blobs_checked': len(blobs),
            'findings': list(unique.values()), 'scope': 'working-tree and reachable history' if history else 'working-tree',
            'limitation': 'Heuristic checks; owner review and separate E05R1 evidence remain mandatory.'}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path('.'))
    parser.add_argument('--history', action='store_true')
    args = parser.parse_args()
    try:
        result = check(args.root, args.history)
    except (OSError, ValueError, subprocess.CalledProcessError):
        result = {'status':'FAIL', 'findings':[{'rule':'scan-unavailable-or-unreadable'}]}
    print(json.dumps(result, indent=2))
    return 0 if result['status'] == 'PASS' else 1

if __name__ == '__main__':
    sys.exit(main())
