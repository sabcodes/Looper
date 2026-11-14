#!/usr/bin/env python3
"""Package the installed Electron runtime; no downloads or build dependencies."""
import argparse
import json
import os
import platform
import plistlib
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
NAME = 'Looper'
BUNDLE_ID = 'local.looper.app'
BUDGET = 1_000_000_000


def tree_bytes(path):
    if not path.exists():
        return 0
    return sum((Path(folder) / name).lstat().st_size
               for folder, _, files in os.walk(path) for name in files)


def retained_bytes():
    return tree_bytes(ROOT / 'node_modules') + tree_bytes(ROOT / '.cache')


def configure_plist(path, helper=None):
    with path.open('rb') as file:
        info = plistlib.load(file)
    info.update(CFBundleName=NAME + ((' Helper' + helper) if helper is not None else ''),
                CFBundleDisplayName=NAME + ((' Helper' + helper) if helper is not None else ''),
                CFBundleIdentifier=BUNDLE_ID + ('.helper' + helper.lower().replace(' ', '').replace('(', '.').replace(')', '') if helper is not None else ''))
    if helper is None:
        release_version = PACKAGE['version'].split('-', 1)[0]
        info.update(CFBundleVersion=release_version, CFBundleShortVersionString=release_version,
                    LSApplicationCategoryType='public.app-category.music')
        info.pop('ElectronAsarIntegrity', None)
    with path.open('wb') as file:
        plistlib.dump(info, file)


def replace_build(files):
    backups = [(target, target.with_name('.previous-' + target.name)) for _, target in files if target.exists()]
    moved = []
    installed = []
    try:
        for target, backup in backups:
            target.rename(backup)
            moved.append((target, backup))
        for source, target in files:
            source.rename(target)
            installed.append((source, target))
    except OSError:
        for source, target in reversed(installed):
            target.rename(source)
        for target, backup in reversed(moved):
            backup.rename(target)
        raise
    for _, backup in backups:
        if backup.is_dir() and not backup.is_symlink():
            shutil.rmtree(backup)
        else:
            backup.unlink()


if platform.system() != 'Darwin':
    raise SystemExit('This build script packages macOS apps; run it on a Mac.')
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--staging-dir', type=Path, help='An explicitly approved empty temporary folder outside cloud storage.')
parser.add_argument('--replace', action='store_true', help='Replace the previous app and ZIP after verifying their replacements.')
parser.add_argument('--budget-bytes', type=int, default=BUDGET, help='Approved runtime and build storage limit in bytes.')
args = parser.parse_args()
PACKAGE = json.loads((ROOT / 'package.json').read_text())
electron = ROOT / 'node_modules/electron/dist'
runtime = electron / 'Electron.app'
if not runtime.exists():
    raise SystemExit('Install this project’s Electron runtime before building.')
arch = 'arm64' if platform.machine() == 'arm64' else 'x64'
output = ROOT / '.cache/build' / ('macos-' + arch)
final_bundle = output / (NAME + '.app')
staging = args.staging_dir.resolve() if args.staging_dir else output
bundle = staging / (NAME + '.app')
archive = output / (NAME + '-macos-' + arch + '.zip')
if args.replace and staging == output:
    parser.error('--replace requires a separate approved --staging-dir')
if bundle.exists() or (not args.replace and (final_bundle.exists() or archive.exists())):
    raise SystemExit('Build output already exists. Move it aside before rebuilding: ' + str(output))
if args.replace and any(os.path.lexists(output / ('.previous-' + path.name)) for path in (final_bundle, archive)):
    raise SystemExit('A previous replacement backup is still present: ' + str(output))
# Reserve the runtime copy plus compressed archive before any large writes.
estimate = retained_bytes() + int(tree_bytes(runtime) * 1.7) + 5_000_000
if estimate > args.budget_bytes:
    raise SystemExit('Build would exceed the approved runtime/cache budget. Estimated peak: ' + str(estimate))
output.mkdir(parents=True, exist_ok=True)
if args.staging_dir and staging.exists() and any(staging.iterdir()):
    raise SystemExit('Staging folder must be empty: ' + str(staging))
staging.mkdir(parents=True, exist_ok=True)
print('Copying installed Electron into ' + str(bundle), flush=True)
shutil.copytree(runtime, bundle, symlinks=True)
resources = bundle / 'Contents/Resources'
(resources / 'default_app.asar').unlink(missing_ok=True)
app = resources / 'app'
app.mkdir()
runtime_files = ['main.js', 'backend.js', 'suggest-direction.js', 'suggest-direction.py', 'liquid.js', 'score-editor.js', 'part-variation.js', 'worker.js', 'preferences.js', 'preload.cjs', 'renderer.js', 'index.html', 'styles.css']
(app / 'desktop').mkdir()
for name in runtime_files:
    shutil.copy2(ROOT / 'desktop' / name, app / 'desktop' / name)
shutil.copytree(ROOT / 'src', app / 'src')
(app / 'data').mkdir()
for name in ['genre-rules.json', 'intent-corpus.json', 'analysis-descriptions.json']:
    shutil.copy2(ROOT / 'data' / name, app / 'data' / name)
production = {key: PACKAGE[key] for key in ['name', 'productName', 'version', 'description', 'type', 'main', 'license']}
(app / 'package.json').write_text(json.dumps(production, indent=2) + '\n')
for name in ['LICENSE', 'LICENSES.chromium.html']:
    if (electron / name).exists():
        shutil.copy2(electron / name, resources / name)
configure_plist(bundle / 'Contents/Info.plist')
for helper in (bundle / 'Contents/Frameworks').glob('Electron Helper*.app'):
    configure_plist(helper / 'Contents/Info.plist', helper.stem.removeprefix('Electron Helper'))
# copy2 can retain Finder metadata that codesign rejects. Only clean the new
# artifact's two signing-incompatible attributes; preserve all other attributes.
attributes = subprocess.run(['xattr', '-r', str(bundle)], check=True, capture_output=True, text=True)
for line in attributes.stdout.splitlines():
    path, _, attribute = line.rpartition(': ')
    if attribute in ('com.apple.FinderInfo', 'com.apple.ResourceFork'):
        subprocess.run(['xattr', '-d', attribute, path], check=True)
print('Applying a local ad-hoc signature (Apple notarization is a separate release step).', flush=True)
subprocess.run(['codesign', '--force', '--deep', '--sign', '-', '--preserve-metadata=entitlements', str(bundle)], check=True)
subprocess.run(['codesign', '--verify', '--deep', '--strict', str(bundle)], check=True)
subprocess.run(['node', str(ROOT / 'desktop/verify-package.js'), str(bundle)], cwd=ROOT, check=True)
print('Creating shareable ZIP.', flush=True)
new_archive = staging / archive.name if args.replace else archive
subprocess.run(['ditto', '-c', '-k', '--norsrc', '--keepParent', str(bundle), str(new_archive)], check=True)
subprocess.run(['unzip', '-tq', str(new_archive)], check=True)
if args.replace:
    replace_build(((bundle, final_bundle), (new_archive, archive)))
    staging.rmdir()
elif bundle != final_bundle:
    shutil.move(str(bundle), final_bundle)
    staging.rmdir()
if retained_bytes() > args.budget_bytes:
    raise SystemExit('Storage budget exceeded. Do not produce further outputs.')
print(json.dumps({'app': str(final_bundle), 'archive': str(archive), 'retainedBytes': retained_bytes(),
                  'architecture': arch, 'signing': 'ad-hoc; not notarized'}, indent=2))
