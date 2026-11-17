#!/usr/bin/env python3
"""Mio² Release: Version hochzählen -> APK bauen -> committen/taggen/pushen -> GitHub-Release mit APK.

  python release.py "Was ist neu"            # Patch +1   (1.0.0 -> 1.0.1)
  python release.py "Was ist neu" --minor    # Minor +1   (1.0.3 -> 1.1.0)
  python release.py "Was ist neu" --major
  (--bridge: zusätzlich ein Release in mio2-app, nur für die Umstellung auf 1.0.5)

Die installierte App prüft beim Start (und per Tipp auf den Avatar) das neueste
GitHub-Release und bietet das Update an. Voraussetzung: `gh auth login`,
android/keystore/ (Signierschlüssel – nie verlieren, nie committen!).
"""
import os, shutil, subprocess, sys

ROOT = os.path.dirname(os.path.abspath(__file__))
ANDROID = os.path.join(ROOT, 'android')
JAVA = os.environ.get('JAVA_HOME') or r'C:\Program Files\Eclipse Adoptium\jdk-17.0.19.10-hotspot'
VFILE = os.path.join(ROOT, 'VERSION')


def run(*cmd, cwd=ROOT, env=None):
    print('>', ' '.join(cmd))
    subprocess.run(cmd, cwd=cwd, check=True, env=env)


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    notes = args[0] if args else 'Verbesserungen und Fehlerbehebungen'
    ma, mi, pa = map(int, open(VFILE).read().strip().split('.'))
    if '--major' in sys.argv: ma, mi, pa = ma + 1, 0, 0
    elif '--minor' in sys.argv: mi, pa = mi + 1, 0
    else: pa += 1
    ver = f'{ma}.{mi}.{pa}'
    open(VFILE, 'w').write(ver + '\n')
    env = dict(os.environ, JAVA_HOME=JAVA)
    run(os.path.join(ANDROID, 'gradlew.bat' if os.name == 'nt' else 'gradlew'), 'assembleRelease', cwd=ANDROID, env=env)
    apk = os.path.join(ANDROID, 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk')
    os.makedirs(os.path.join(ROOT, 'dist'), exist_ok=True)
    out = os.path.join(ROOT, 'dist', 'Mio2.apk')
    shutil.copy(apk, out)
    run('git', 'add', '-A')
    run('git', 'commit', '-m', f'Release v{ver}: {notes}')
    run('git', 'tag', f'v{ver}')
    run('git', 'push', 'origin', 'HEAD', '--tags')
    if '--bridge' in sys.argv:  # nur für 1.0.5: alte Apps (<=1.0.4) suchen Updates noch in mio2-app
        run('gh', 'release', 'create', f'v{ver}', out, '--title', f'Mio² {ver}', '--notes', notes)
    # Ab jetzt: geprüftes Release im Update-Repo + Kopie in Liams Appstore (incoming-apks/)
    pub = os.path.join(ROOT, '..', 'mio2-updater', 'tools', 'publish_release.py')
    run(sys.executable, pub, out, notes, '--appstore')
    print(f'\nFertig: Mio² {ver} veröffentlicht.')


if __name__ == '__main__':
    main()
