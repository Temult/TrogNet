#!/usr/bin/env python3
"""Stage an exact reviewed ZIP in a detached worktree; never publish or authorize."""
import sys
sys.dont_write_bytecode = True
import argparse
import hashlib
import json
import re
import stat
import subprocess
import zipfile
from pathlib import Path, PurePosixPath
from publication_hygiene import check, REQUIRED

def sha(data):
    return hashlib.sha256(data).hexdigest()

def run(repo, *args):
    return subprocess.check_output(['git', '-C', str(repo), *args], stderr=subprocess.DEVNULL)

def require(condition, reason):
    if not condition:
        raise ValueError(reason)

def read_json(path):
    return json.loads(path.read_text(encoding='utf-8'))

def safe_name(name):
    p = PurePosixPath(name)
    require(bool(name) and not p.is_absolute() and '\\' not in name and ':' not in name,
            'unsafe candidate path')
    require(p.as_posix() == name and all(x not in ('', '.', '..') for x in name.split('/')),
            'noncanonical candidate path')
    for part in p.parts:
        require(not part.endswith(('.', ' ')) and not any(ord(c) < 32 or c in '<>"|?*' for c in part), 'unsafe path component')
        require(not re.match(r'(?i)^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)', part), 'reserved path component')
        require(part.lower() not in ('.git', '.hg', '.svn'), 'repository metadata forbidden')
    require(name.lower() not in {s.lower() for s in REQUIRED} and
            p.parts[0].lower() not in ('.github', 'tools') and
            p.name.lower() not in ('.gitattributes', '.gitignore', '.gitmodules'),
            'protected publication file; review separately')
    return name

def tree_manifest(repo):
    rows = []
    for p in sorted(repo.rglob('*')):
        rel = p.relative_to(repo)
        if '.git' in rel.parts:
            continue
        if p.is_file():
            rows.append({'path':rel.as_posix(), 'sha256':sha(p.read_bytes())})
    return rows

def stage(args):
    repo, worktree, review = (p.resolve() for p in (args.repo, args.worktree, args.review_output))
    require(repo == Path(run(repo, 'rev-parse', '--show-toplevel').decode().strip()).resolve(), 'repo must be a repository root')
    require(not run(repo, 'status', '--porcelain', '--untracked-files=all').strip(), 'base repository must be clean')
    require(not worktree.exists() and not review.exists(), 'output directories must not exist')
    require(not worktree.is_relative_to(repo) and not review.is_relative_to(repo), 'outputs must be outside repository')
    require(not worktree.is_relative_to(review) and not review.is_relative_to(worktree), 'outputs must be disjoint')
    base = run(repo, 'rev-parse', 'HEAD').decode().strip()
    package = args.package.read_bytes()
    package_hash = sha(package)
    require(re.fullmatch('[a-f0-9]{64}', args.sha256) is not None and package_hash == args.sha256, 'package SHA-256 mismatch')
    manifest_bytes, evidence_bytes = args.manifest.read_bytes(), args.evidence.read_bytes()
    manifest, evidence = json.loads(manifest_bytes), json.loads(evidence_bytes)
    require(manifest.get('schema') == 'trognet-runtime-boundary/v1', 'unsupported manifest schema')
    require(manifest.get('package_sha256') == package_hash, 'manifest package mismatch')
    require(manifest.get('private_payloads') is False, 'explicit no-private-payload declaration required')
    require(evidence.get('schema') == 'trognet-runtime-evidence/v1' and evidence.get('package_sha256') == package_hash,
            'evidence package mismatch')
    require(evidence.get('manifest_sha256') == sha(manifest_bytes), 'evidence manifest mismatch')
    for key in ('privacy_secret_scan', 'local_build', 'local_tests'):
        record = evidence.get(key, {})
        require(record.get('status') == 'PASS', 'missing PASS evidence: ' + key)
        report_name = record.get('report', '')
        require(report_name and Path(report_name).name == report_name and report_name not in ('.', '..'), 'report must be an adjacent file')
        report = args.evidence.resolve().parent / report_name
        require(not report.is_symlink() and report.is_file(), 'missing report')
        require(sha(report.read_bytes()) == record.get('sha256'), 'report hash mismatch')
    declared = {}
    case_names = set()
    path_spellings = {}
    for row in manifest['files']:
        name = safe_name(row['path'])
        require(name.casefold() not in case_names, 'duplicate manifest path')
        require(re.fullmatch('[a-f0-9]{64}', row['sha256']) is not None, 'invalid file hash')
        require(row.get('classification') == 'public-software', 'file not cleared for public software')
        parts = name.split('/')
        for n in range(1, len(parts)+1):
            prefix = '/'.join(parts[:n])
            require(path_spellings.get(prefix.casefold(), prefix) == prefix, 'case-colliding path component')
            path_spellings[prefix.casefold()] = prefix
        declared[name] = row['sha256']
        case_names.add(name.casefold())
    require(bool(declared), 'empty candidate')
    import io
    payloads = {}
    with zipfile.ZipFile(io.BytesIO(package)) as archive:
        entries = archive.infolist()
        require(len(entries) <= 10000 and sum(i.file_size for i in entries) <= 100 * 1024 * 1024, 'candidate too large')
        for item in entries:
            require(not item.is_dir(), 'ZIP must contain files only, no directory entries')
            name = safe_name(item.filename)
            mode = item.external_attr >> 16
            require(stat.S_IFMT(mode) in (0, stat.S_IFREG), 'nonregular ZIP entry')
            require(name not in payloads and name in declared, 'duplicate or undeclared ZIP file')
            require(item.file_size <= 5 * 1024 * 1024, 'candidate file too large')
            data = archive.read(item)
            require(sha(data) == declared[name], 'candidate file hash mismatch')
            payloads[name] = data
    require(set(payloads) == set(declared), 'declared files missing from package')
    for name in payloads:
        for parent in PurePosixPath(name).parents:
            require(str(parent) not in payloads, 'candidate file-directory collision')
    existing = {r['path'].casefold(): r['path'] for r in tree_manifest(repo)}
    for p in repo.rglob('*'):
        rel = p.relative_to(repo)
        if '.git' not in rel.parts:
            existing[rel.as_posix().casefold()] = rel.as_posix()
    for folded, spelling in path_spellings.items():
        require(folded not in existing or existing[folded] == spelling, 'base path component case collision')
    for name in payloads:
        require(name.casefold() not in existing or existing[name.casefold()] == name, 'base path case collision')
        target = repo / name
        require(not target.exists(), 'runtime seam accepts new files only; modifications require separate review')
        for parent in target.parents:
            if parent == repo:
                break
            require(not parent.is_file() and not parent.is_symlink(), 'path parent conflict')
    from publication_hygiene import inspect
    require(check(repo, history=True)['status'] == 'PASS', 'base hygiene failed')
    for name, data in payloads.items():
        require(not inspect(name, data), 'candidate hygiene failed')
    worktree.parent.mkdir(parents=True, exist_ok=True)
    run(repo, 'worktree', 'add', '--detach', str(worktree), base)
    for name, data in payloads.items():
        p = worktree / name
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(data)
    result = check(worktree, history=True)
    require(result['status'] == 'PASS', 'staged public hygiene failed')
    run(worktree, 'add', '--force', '--', *payloads.keys())
    tree = run(worktree, 'write-tree').decode().strip()
    diff = run(worktree, 'diff', '--cached', '--binary', '--no-ext-diff', '--no-textconv', base)
    review.mkdir(parents=True)
    (review / 'FINAL_PUBLIC_DIFF.patch').write_bytes(diff)
    receipt = {'schema':'trognet-runtime-stage/v1', 'status':'STAGED_AWAITING_OWNER_REVIEW',
               'package_sha256':package_hash, 'manifest_sha256':sha(manifest_bytes),
               'evidence_sha256':sha(evidence_bytes), 'base_commit':base, 'staged_git_tree':tree,
               'diff_sha256':sha(diff), 'files':tree_manifest(worktree), 'hygiene':result,
               'owner_review':'REQUIRED', 'runtime_published':False,
               'dynamic_registration_authorized':False, 'live_plan_inference_authorized':False}
    (review / 'STAGING_RECEIPT.json').write_text(json.dumps(receipt, indent=2)+'\n', encoding='utf-8')
    print(json.dumps({k:v for k,v in receipt.items() if k not in ('files','hygiene')}, indent=2))

def main():
    p = argparse.ArgumentParser(description=__doc__)
    for name in ('repo','package','manifest','evidence','worktree','review-output'):
        p.add_argument('--'+name, type=Path, required=True)
    p.add_argument('--sha256', required=True)
    args = p.parse_args()
    try:
        stage(args)
        return 0
    except (ValueError, OSError, KeyError, TypeError, zipfile.BadZipFile, subprocess.CalledProcessError) as error:
        print(json.dumps({'status':'REFUSED', 'reason':str(error) if isinstance(error, ValueError) and not isinstance(error, json.JSONDecodeError) else type(error).__name__}))
        return 1

if __name__ == '__main__':
    sys.exit(main())
