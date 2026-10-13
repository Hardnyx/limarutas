"""Execute the selected files without interpolating paths into shell commands."""
import json
import os
import re
import subprocess
import sys
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]


def command(files,project,shard):
    if project not in ('beta','chromium') or not re.fullmatch(r'[12]/[12]',shard):raise ValueError('Invalid browser matrix')
    if not files:raise ValueError('Empty browser selection')
    for file in files:
        if not re.fullmatch(r'tests/[A-Za-z0-9_.-]+\.spec\.js',file) or not (ROOT/file).is_file():raise ValueError('Invalid test file')
    return ['npx','playwright','test',*files,'--project='+project,'--shard='+shard,'--workers=1']


if __name__=='__main__':
    sys.exit(subprocess.run(command(json.loads(os.environ['TEST_FILES']),os.environ['PW_PROJECT'],os.environ['PW_SHARD']),cwd=ROOT).returncode)
