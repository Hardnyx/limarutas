"""Select browser coverage from the complete delta since a successful release."""
from __future__ import annotations
import argparse
import fnmatch
import json
import os
import re
import subprocess
import urllib.request
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
POLICY=ROOT/'config/ci_test_scopes.json'


def git(*args):
    return subprocess.check_output(['git',*args],cwd=ROOT,text=True).strip()


def release_base(repository, token, head):
    """A cancelled/failed push must not become the baseline for the next push."""
    if not re.fullmatch(r'[\w.-]+/[\w.-]+',repository): raise ValueError('Invalid repository')
    url=f'https://api.github.com/repos/{repository}/actions/workflows/pages.yml/runs?branch=main&status=success&per_page=30'
    headers={'Accept':'application/vnd.github+json','User-Agent':'LimaRutas CI scope'}
    if token:headers['Authorization']='Bearer '+token
    with urllib.request.urlopen(urllib.request.Request(url,headers=headers),timeout=20) as response:
        runs=json.load(response)['workflow_runs']
    for run in runs:
        base=run['head_sha']
        if run.get('conclusion')=='success' and subprocess.run(['git','merge-base','--is-ancestor',base,head],cwd=ROOT,capture_output=True).returncode==0:
            return base
    raise ValueError('No successful deployment ancestor found')


def select(paths, policy, full_reason=None):
    groups=set(); reasons=[]; selected=set()
    if full_reason:reasons.append(full_reason)
    for path in sorted(set(paths)):
        matches=[rule for rule in policy['rules'] if any(fnmatch.fnmatchcase(path,p) for p in rule['paths'])][:1]
        if path.startswith('tests/') and path.endswith('.spec.js'):
            if not (ROOT/path).is_file():
                full_reason=full_reason or 'Browser test deleted';continue
            selected.add(path);reasons.append({'path':path,'groups':['test-file']});continue
        if not matches:
            full_reason=full_reason or 'Unclassified file';reasons.append({'path':path,'groups':['full']});continue
        impact={group for rule in matches for group in rule['groups']}
        if 'full' in impact:full_reason=full_reason or 'Shared runtime or CI contract changed'
        groups.update(impact);reasons.append({'path':path,'groups':sorted(impact)})
    if full_reason:
        selected={p.relative_to(ROOT).as_posix() for p in (ROOT/'tests').glob('*.spec.js')}
        groups={'full'}
    else:
        for group in groups:selected.update(policy['groups'].get(group,[]))
        if selected:selected.update(policy['smoke'])
    for path in selected:
        if not re.fullmatch(r'tests/[A-Za-z0-9_.-]+\.spec\.js',path) or not (ROOT/path).is_file():
            raise ValueError('Invalid test selection: '+path)
    # Each runner has its own HTTP servers and editor store. No shared fixtures
    # are made concurrent inside one process; sharding remains file-level.
    shards=2 if len(selected)>=5 else 1
    matrix={'include':[{'project':project,'shard':f'{i}/{shards}'}
                      for project in ['chromium','beta'] for i in range(1,shards+1)]}
    return {'version':1,'mode':'full' if full_reason else 'selected' if selected else 'contracts-only',
            'groups':sorted(groups),'files':sorted(selected),'run_browser':bool(selected),
            'matrix':matrix,'reasons':reasons,'full_reason':full_reason,'changed_files':sorted(set(paths))}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base')
    parser.add_argument('--full',action='store_true')
    parser.add_argument('--output',type=Path,default=ROOT/'pipeline/temp/ci-test-plan.json')
    args=parser.parse_args()
    head=git('rev-parse','HEAD');base=args.base;reason='Manual full suite' if args.full or os.getenv('FORCE_FULL')=='true' else None
    try:
        if not base:
            event=json.loads(Path(os.environ['GITHUB_EVENT_PATH']).read_text()) if os.getenv('GITHUB_EVENT_PATH') else {}
            if event.get('pull_request'):
                base=git('merge-base',event['pull_request']['base']['sha'],head)
            else:base=release_base(os.environ['GITHUB_REPOSITORY'],os.getenv('GH_TOKEN',''),head)
        if subprocess.run(['git','merge-base','--is-ancestor',base,head],cwd=ROOT,capture_output=True).returncode:
            raise ValueError('Baseline is not an ancestor')
        paths=git('diff','--name-only',base,head).splitlines()
    except (OSError,ValueError,KeyError,subprocess.CalledProcessError) as error:
        reason=reason or 'Baseline unavailable: '+str(error);paths=[];base=None
    plan=select(paths,json.loads(POLICY.read_text()),reason)
    plan.update(base_sha=base,head_sha=head)
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(plan,ensure_ascii=False,indent=2)+'\n')
    if os.getenv('GITHUB_OUTPUT'):
        with open(os.environ['GITHUB_OUTPUT'],'a') as stream:
            stream.write('run_browser='+str(plan['run_browser']).lower()+'\n')
            stream.write('matrix='+json.dumps(plan['matrix'],separators=(',',':'))+'\n')
            stream.write('files='+json.dumps(plan['files'],separators=(',',':'))+'\n')
    if os.getenv('GITHUB_STEP_SUMMARY'):
        with open(os.environ['GITHUB_STEP_SUMMARY'],'a') as stream:
            stream.write('## Selección de pruebas\n\nModo: **'+plan['mode']+'**. Base: `'+str(base)+'`.\n\n')
            stream.write('Grupos: '+', '.join(plan['groups'])+'.\n\n')
            stream.write('| Archivo modificado | Cobertura |\n|---|---|\n')
            for entry in plan['reasons']:
                if isinstance(entry,dict):stream.write('| '+entry['path']+' | '+', '.join(entry['groups'])+' |\n')
            if plan['full_reason']:stream.write('\nSuite completa: '+plan['full_reason']+'\n')
            stream.write('\nArchivos de navegador seleccionados: '+str(len(plan['files']))+'.\n')
    print(json.dumps({k:plan[k] for k in ['mode','groups','run_browser','full_reason']}))


if __name__=='__main__':main()
