#!/usr/bin/env python3
"""Validate and publish one snapshot. UI replacement is explicitly opt-in."""
import argparse
import fcntl
import re
import shutil
import subprocess
import tempfile
from contextlib import nullcontext
from pathlib import Path

from tracker_common import STATE_DIR, read_json, validate_bundle, write_json

REPO_URL = 'https://github.com/junshelp/indie-game-tracker-dashboard.git'
UI_FILES = ('index.html', 'app.js', 'styles.css')


def git(*args, cwd=None):
    result = subprocess.run(['git', *args], cwd=cwd, capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError(f'git {args[0]} failed: {result.stderr.strip()}')
    return result.stdout.strip()


def bump_version(root):
    root = Path(root)
    html = root / 'index.html'
    value = html.read_text()
    match = re.search(r'\./app\.js\?v=(\d+)', value)
    if not match:
        raise ValueError('Missing asset version in index.html')
    version = int(match[1]) + 1
    html.write_text(re.sub(r'(\./(?:app\.js|styles\.css)\?v=)\d+', rf'\g<1>{version}', value))
    app = root / 'app.js'
    value = app.read_text()
    app.write_text(re.sub(r'(\./data/(?:steam/)?(?:data|history|summary)\.json\?v=)\d+',
                          rf'\g<1>{version}', value))
    return version


def publish(args):
    source = Path(args.data_dir).resolve()
    count = validate_bundle(source)  # before clone, copy, staging, or version bump
    print(f'Validated {count} events')
    if args.include_ui and (not args.ui_dir or any(not (Path(args.ui_dir) / n).is_file() for n in UI_FILES)):
        raise ValueError('--include-ui requires --ui-dir with all three UI files')
    temporary = tempfile.TemporaryDirectory(prefix='tracker-publish-preview-') if args.dry_run else nullcontext(None)
    with temporary as preview:
        work = Path(preview) / 'repo' if preview else Path(args.work_dir).expanduser().resolve()
        if (work / '.git').is_dir():
            if git('status', '--porcelain', cwd=work):
                raise ValueError(f'Publish checkout has uncommitted changes: {work}')
            if git('branch', '--show-current', cwd=work) != 'main':
                raise ValueError('Publish checkout must be on main')
            git('pull', '--ff-only', 'origin', 'main', cwd=work)
        else:
            if work.exists() and any(work.iterdir()):
                raise ValueError(f'Refusing to replace nonempty checkout: {work}')
            work.parent.mkdir(parents=True, exist_ok=True)
            git('clone', '--branch', 'main', args.repo_url, str(work))
        # Always copy the required event bundle together.
        for name in ('data.json', 'history.json', 'summary.json'):
            dest = work / 'data' / name
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source / name, dest)
        if (source / 'steam/data.json').exists():
            if not (source / 'steam/history.json').exists():
                raise ValueError('Steam data requires Steam history')
            for name in ('data.json', 'history.json'):
                dest = work / 'data/steam' / name
                dest.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(source / 'steam' / name, dest)
        if args.include_ui:
            for name in UI_FILES:
                shutil.copy2(Path(args.ui_dir) / name, work / name)
        paths = ['data', *UI_FILES]
        if not git('status', '--porcelain', '--', *paths, cwd=work):
            print('No changes to publish')
            return
        version = bump_version(work)
        validate_bundle(work / 'data')
        git('add', '--', *paths, cwd=work)
        print(git('diff', '--cached', '--stat', cwd=work))
        if args.dry_run:
            print('Preview complete; live checkout, state, and remote were not changed')
            return
        git('commit', '-m', f'data: validated daily snapshot (v={version})', cwd=work)
        git('push', 'origin', 'main', cwd=work)
        # Only published snapshots become the next comparison baseline.
        state = Path(args.state_dir).expanduser()
        for kind, subdir in [('events', ''), ('steam', 'steam')]:
            for name in ('data.json', 'history.json'):
                path = source / subdir / name
                if path.exists():
                    write_json(state / kind / name, read_json(path))
        print(f'Published {git("rev-parse", "HEAD", cwd=work)} (v={version})')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data-dir', default='/tmp/tracker-dashboard/data')
    parser.add_argument('--repo-url', default=REPO_URL)
    parser.add_argument('--work-dir', default=str(STATE_DIR / 'publish'))
    parser.add_argument('--state-dir', default=str(STATE_DIR))
    parser.add_argument('--include-ui', action='store_true')
    parser.add_argument('--ui-dir')
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()
    if args.dry_run:
        publish(args)
    else:
        state = Path(args.state_dir).expanduser()
        state.mkdir(parents=True, exist_ok=True)
        with (state / 'publish.lock').open('a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            publish(args)


if __name__ == '__main__':
    main()
