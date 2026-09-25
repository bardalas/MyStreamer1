"""Builds the over-the-air web bundle: web-bundle.zip (the app's assets), web-bundle.json (its manifest) and
web-bundle.zip.sig (an ECDSA P-256 / SHA-256 signature of the zip, DER, made with openssl).

    python tools/build_web_bundle.py OUT_DIR [--key private.pem]

Without --key the bundle is built unsigned (the app will refuse it): useful to look at, not to ship.
The bundle is made for the versionCode in app/build.gradle.kts: an app takes only a bundle made for itself.
"""
import hashlib, io, json, re, subprocess, sys, time, zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / 'app' / 'src' / 'main' / 'assets'


def main():
    args = sys.argv[1:]
    key = None
    if '--key' in args:
        i = args.index('--key'); key = args[i + 1]; del args[i:i + 2]
    out = Path(args[0]); out.mkdir(parents=True, exist_ok=True)
    gradle = (ROOT / 'app' / 'build.gradle.kts').read_text(encoding='utf-8')
    code = int(re.search(r'versionCode\s*=\s*(\d+)', gradle).group(1))
    name = re.search(r'versionName\s*=\s*"([^"]+)"', gradle).group(1)

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as z:
        for f in sorted(ASSETS.rglob('*')):
            if f.is_file():
                info = zipfile.ZipInfo(f.relative_to(ASSETS).as_posix(), (2020, 1, 1, 0, 0, 0))   # same input, same bytes
                info.compress_type = zipfile.ZIP_DEFLATED
                z.writestr(info, f.read_bytes())
    data = buf.getvalue()
    (out / 'web-bundle.zip').write_bytes(data)

    manifest = {
        'version': int(time.strftime('%Y%m%d%H%M', time.gmtime())),   # only ever grows
        'app': code,                                                   # the app version it was made for
        'appName': name,
        'size': len(data),
        'sha256': hashlib.sha256(data).hexdigest(),
    }
    (out / 'web-bundle.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    if key:
        subprocess.run(['openssl', 'dgst', '-sha256', '-sign', key, '-out', str(out / 'web-bundle.zip.sig'),
                        str(out / 'web-bundle.zip')], check=True)
    print(json.dumps(manifest))


if __name__ == '__main__':
    main()
