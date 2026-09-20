# -*- coding: utf-8 -*-
"""Rewrite every module's imports from what it actually uses.

The module graph of the page is derived, never hand-kept: move a function from one file to another,
run this, and every `import` line in the app is correct again. It reads only real code - comments and
the literal parts of strings are ignored, so a word in a sentence never becomes an import.

    python tools/rewire.py             rewrite every import line
    python tools/rewire.py --check     fail if any import line is out of date (for a hook or CI)
    python tools/rewire.py --audit     also list names nothing provides (noisy: locals leak in)
"""
import io, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JS = os.path.join(ROOT, 'app', 'src', 'main', 'assets', 'js')

DECL = re.compile(r'^export\s+(?:async function|function|const|let|var|class)\s+([A-Za-z_$][\w$]*)')
MULTI = re.compile(r'^export\s+(?:const|let|var)\s+(.*)$')


def declared(line):
    """Every name a top-level declaration introduces (`const a = 1, b = 2;` introduces two)."""
    d = DECL.match(line)
    if not d:
        return []
    m = MULTI.match(code_only(line))
    if not m:
        return [d.group(1)]
    names, depth, cur = [], 0, ''
    for ch in m.group(1):
        if ch in '([{':
            depth += 1
        elif ch in ')]}':
            depth -= 1
        if ch == ',' and depth == 0:
            names.append(cur)
            cur = ''
        else:
            cur += ch
    names.append(cur)
    out = []
    for part in names:
        n = NAME.match(part.strip())
        if n:
            out.append(n.group(0))
    return out or [d.group(1)]
IMPORT_NAMED = re.compile(r"^import\s*\{[^}]*\}\s*from\s*'[^']+';\s*$")
IMPORT_SIDE = re.compile(r"^import\s*'[^']+';\s*$")
NAME = re.compile(r'[A-Za-z_$][\w$]*')


def _regex_here(out):
    """A slash starts a regular expression when what came before it cannot end a value."""
    j = len(out) - 1
    while j >= 0 and out[j] in ' \t\n':
        j -= 1
    if j < 0:
        return True
    prev = out[j]
    if prev in '(,=:[!&|?{};+-*%<>~^':
        return True
    word = ''
    while j >= 0 and (out[j].isalnum() or out[j] in '_$'):
        word = out[j] + word
        j -= 1
    return word in ('return', 'typeof', 'case', 'in', 'of', 'new', 'delete', 'void', 'do', 'else', 'yield', 'await')


def code_only(src):
    """The source with comments, string literals and regular expressions removed - but template
    expressions kept, because those are code."""
    out, i, n = [], 0, len(src)
    while i < n:
        c = src[i]
        two = src[i:i + 2]
        if c == '/' and two not in ('//', '/*') and _regex_here(out):
            i += 1                                    # a regular expression: it can hold anything
            while i < n:
                if src[i] == '\\':
                    i += 2
                    continue
                if src[i] == '[':                     # a class may hold an unescaped /
                    while i < n and src[i] != ']':
                        i += 2 if src[i] == '\\' else 1
                if src[i] == '/':
                    i += 1
                    break
                if src[i] == '\n':
                    break                             # not a regex after all
                i += 1
            while i < n and src[i].isalpha():         # flags
                i += 1
        elif two == '//':
            i = src.find('\n', i)
            if i < 0:
                break
        elif two == '/*':
            j = src.find('*/', i + 2)
            i = n if j < 0 else j + 2
        elif c in '"\'':
            i += 1
            while i < n and src[i] != c:
                i += 2 if src[i] == '\\' else 1
            i += 1
        elif c == '`':
            i += 1
            while i < n:
                if src[i] == '\\':
                    i += 2
                    continue
                if src[i] == '`':
                    i += 1
                    break
                if src[i:i + 2] == '${':          # a real expression inside the text
                    depth, i = 1, i + 2
                    start = i
                    while i < n and depth:
                        if src[i] == '{':
                            depth += 1
                        elif src[i] == '}':
                            depth -= 1
                        i += 1
                    out.append(' ' + src[start:i - 1] + ' ')
                    continue
                i += 1
        else:
            out.append(c)
            i += 1
    return ''.join(out)


def relpath(frm, to):
    base = os.path.dirname(frm)
    p = os.path.relpath(to, base).replace('\\', '/') if base else to
    return p if p.startswith('.') else './' + p


def read_all():
    files = {}
    for root, _, names in os.walk(JS):
        for f in sorted(names):
            if f.endswith('.js'):
                p = os.path.join(root, f)
                files[os.path.relpath(p, JS).replace('\\', '/')] = io.open(p, encoding='utf-8').read()
    return files


def main(check=False):
    files = read_all()
    owner = {}
    for m, src in files.items():
        for l in src.split('\n'):
            for name in declared(l):
                owner[name] = m
        for block in re.findall(r'^export\s*\{([^}]*)\};?$', src, re.M):
            for w in NAME.findall(block):
                owner[w] = m

    changed = []
    for m, src in files.items():
        lines = src.split('\n')
        body, side = [], []
        for l in lines:
            if IMPORT_NAMED.match(l):
                continue
            if IMPORT_SIDE.match(l):
                side.append(l)
                continue
            body.append(l)
        while body and not body[0].strip():
            body.pop(0)
        head = [body.pop(0)] if body and body[0].startswith('/*') else []
        while body and not body[0].strip():          # no pile of blank lines where imports were
            body.pop(0)
        text = '\n'.join(body)
        mine = {n for l in body for n in declared(l)}
        used = set(NAME.findall(code_only(text)))
        need = {}
        for w in sorted(used - mine):
            home = owner.get(w)
            if home and home != m:
                need.setdefault(home, []).append(w)
        imports = [f"import {{{', '.join(sorted(v))}}} from '{relpath(m, k)}';" for k, v in sorted(need.items())]
        out = '\n'.join(head + imports + side + ([''] if (imports or side) else []) + body).strip() + '\n'
        if out != src:
            changed.append(m)
            if not check:
                io.open(os.path.join(JS, m), 'w', encoding='utf-8', newline='\n').write(out)

    if check and changed:
        print('imports out of date in:\n  ' + '\n  '.join(changed))
        return 1
    print(f'{len(files)} modules, {len(changed)} rewritten')
    return audit(read_all(), owner) if '--audit' in sys.argv else 0


# Everything a browser gives a page, plus the names the app is called by from the Android side.
GLOBALS = set('''
window document location history navigator console localStorage sessionStorage Math JSON Object Array String
Number Boolean Date Promise Map Set WeakMap WeakSet RegExp Error TypeError Symbol Proxy Reflect Function Intl
URL URLSearchParams DOMParser XMLHttpRequest FormData Blob File FileReader AbortController TextDecoder TextEncoder
IntersectionObserver MutationObserver ResizeObserver CustomEvent Event KeyboardEvent Element HTMLElement Node
NodeList CSS Image Audio Video MediaSource setTimeout clearTimeout setInterval clearInterval requestAnimationFrame
cancelAnimationFrame queueMicrotask structuredClone fetch alert confirm prompt addEventListener removeEventListener
dispatchEvent scrollTo scroll scrollBy scrollY scrollX innerWidth innerHeight outerWidth devicePixelRatio matchMedia
getComputedStyle encodeURIComponent decodeURIComponent encodeURI decodeURI parseInt parseFloat isNaN isFinite
Infinity NaN undefined null true false this arguments globalThis atob btoa crypto performance screen top parent
self frames opener closed name status length BoothAndroid Hls
'''.split()) | set('''
export import from as default async await function return const let var class new delete typeof instanceof in of
if else for while do switch case break continue try catch finally throw yield void this super extends static get set
true false null undefined
'''.split())


def audit(files, owner):
    """Names used that nothing declares, imports or provides: the split forgot something."""
    bad = 0
    for m, src in files.items():
        imported = set()
        for line in src.split('\n'):
            mm = IMPORT_NAMED.match(line)
            if mm:
                imported |= set(NAME.findall(line.split('{')[1].split('}')[0]))
        body = [l for l in src.split('\n') if not IMPORT_NAMED.match(l) and not IMPORT_SIDE.match(l)]
        mine = {n for l in body for n in declared(l)}
        # every local name: parameters, consts inside functions, labels… taken loosely
        joined = '\n'.join(body)
        local = set(re.findall(r'(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)', joined))
        local |= set(re.findall(r'([A-Za-z_$][\w$]*)\s*(?:=>|\()', joined))
        local |= set(re.findall(r'catch\s*\(\s*([A-Za-z_$][\w$]*)', joined))
        # destructuring, and the parameters of every function and arrow
        for block in re.findall(r'(?:const|let|var)\s*\{([^}]*)\}', joined) + re.findall(r'\(([^()]*)\)\s*=>', joined) \
                + re.findall(r'function\s*[A-Za-z_$\w]*\s*\(([^()]*)\)', joined):
            local |= set(NAME.findall(block))
        for block in re.findall(r'for\s*\(\s*(?:const|let|var)\s+([^;)]*)', joined):
            local |= set(NAME.findall(block))
        code = code_only('\n'.join(body))
        # drop property access (a.b) and object keys (b:) - only free identifiers matter
        code = re.sub(r'\.\s*[A-Za-z_$][\w$]*', '', code)
        code = re.sub(r'([A-Za-z_$][\w$]*)\s*:', '', code)
        for w in sorted(set(NAME.findall(code))):
            if w in mine or w in imported or w in local or w in GLOBALS or w in owner:
                continue
            if w.isupper() or w[0].isupper():
                continue                       # constants and classes of the platform
            print(f'{m}: nothing provides {w}')
            bad += 1
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main('--check' in sys.argv))
