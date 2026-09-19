"""
Builds the "Booth Catalogs" Stremio add-on as static JSON under addon/.

Hebrew / Arabic film and series catalogs, generated from Wikidata (original language +
IMDb id), ranked by how many Wikipedia editions cover the title (a popularity proxy) or by
release date. Served straight from the repo via raw.githubusercontent.com, so refreshing
the catalogs (weekly workflow) needs no app release.

Usage: python tools/build_catalogs.py
"""
import json
import pathlib
import time
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent / "addon"
SPARQL = "https://query.wikidata.org/sparql"
UA = "BoothCatalogs/1.0 (https://github.com/bardalas/MyStreamer1)"
POSTER = "https://images.metahub.space/poster/medium/{}/img"
LIMIT = 100

HEBREW, ARABIC = "Q9288", "Q13955"
FILM, SERIES = "Q11424", "Q5398426"
# Country of origin (P495). Language alone is not enough: Hollywood films with a few lines of
# Hebrew or Arabic dialogue list those as original languages too.
COUNTRIES = {
    HEBREW: ["Q801"],  # Israel
    ARABIC: ["Q79", "Q822", "Q858", "Q851", "Q810", "Q1028", "Q948", "Q262", "Q796", "Q878", "Q219060",
             "Q817", "Q846", "Q1049", "Q1016", "Q805", "Q842", "Q398", "Q1025"],  # Arab League states
}

CATALOGS = [
    # id, type, name, language, class, order
    ("booth.he.movies", "movie", "Israeli films", HEBREW, FILM, "popular"),
    ("booth.he.movies.new", "movie", "New Israeli films", HEBREW, FILM, "new"),
    ("booth.he.series", "series", "Israeli series", HEBREW, SERIES, "popular"),
    ("booth.ar.movies", "movie", "Arabic films", ARABIC, FILM, "popular"),
    ("booth.ar.movies.new", "movie", "New Arabic films", ARABIC, FILM, "new"),
    ("booth.ar.series", "series", "Arabic series", ARABIC, SERIES, "popular"),
]


def query(lang, cls, retries=4):
    countries = " ".join(f"wd:{c}" for c in COUNTRIES[lang])
    sparql = f"""SELECT ?imdb ?links ?date ?he ?en ?ar WHERE {{
  VALUES ?country {{ {countries} }}
  ?item wdt:P364 wd:{lang}; wdt:P495 ?country; wdt:P31 wd:{cls}; wdt:P345 ?imdb; wikibase:sitelinks ?links.
  OPTIONAL {{ ?item wdt:P577 ?date. }}
  OPTIONAL {{ ?item rdfs:label ?he FILTER(LANG(?he) = "he") }}
  OPTIONAL {{ ?item rdfs:label ?en FILTER(LANG(?en) = "en") }}
  OPTIONAL {{ ?item rdfs:label ?ar FILTER(LANG(?ar) = "ar") }}
}}"""
    url = SPARQL + "?format=json&query=" + urllib.parse.quote(sparql)
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/sparql-results+json"})
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                return json.load(r)["results"]["bindings"]
        except Exception as e:  # Wikidata's endpoint is flaky under load; back off and retry
            print(f"  retry {attempt + 1} ({e})")
            time.sleep(10 * (attempt + 1))
    raise RuntimeError(f"Wikidata query failed for {lang}/{cls}")


def titles(rows, lang):
    """One entry per IMDb id: earliest year, best label, sitelink count."""
    out = {}
    for b in rows:
        imdb = b["imdb"]["value"]
        if not imdb.startswith("tt"):
            continue
        t = out.setdefault(imdb, {"imdb": imdb, "links": 0, "year": None, "labels": {}})
        t["links"] = max(t["links"], int(b["links"]["value"]))
        if "date" in b:
            y = b["date"]["value"][:4]
            if y.isdigit() and (t["year"] is None or y < t["year"]):
                t["year"] = y
        for k in ("he", "en", "ar"):
            if k in b:
                t["labels"].setdefault(k, b[k]["value"])
    prefer = ("he", "en", "ar") if lang == HEBREW else ("en", "he", "ar")
    for t in out.values():
        t["name"] = next((t["labels"][k] for k in prefer if k in t["labels"]), None)
    return [t for t in out.values() if t["name"]]


def meta(t, type_):
    m = {"id": t["imdb"], "type": type_, "name": t["name"], "poster": POSTER.format(t["imdb"])}
    if t["year"]:
        m["releaseInfo"] = t["year"]
    return m


def main():
    cache = {}
    manifest_catalogs = []
    for cid, type_, name, lang, cls, order in CATALOGS:
        key = (lang, cls)
        if key not in cache:
            print(f"query {lang} {cls}")
            cache[key] = titles(query(lang, cls), lang)
        items = cache[key]
        if order == "new":
            items = sorted((t for t in items if t["year"] and t["links"] >= 2), key=lambda t: (t["year"], t["links"]), reverse=True)
        else:
            items = sorted(items, key=lambda t: t["links"], reverse=True)
        metas = [meta(t, type_) for t in items[:LIMIT]]
        path = ROOT / "catalog" / type_ / f"{cid}.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({"metas": metas}, ensure_ascii=False, indent=0), encoding="utf-8")
        manifest_catalogs.append({"type": type_, "id": cid, "name": name})
        print(f"  {cid}: {len(metas)} titles")

    manifest = {
        "id": "org.booth.catalogs",
        "version": "1.0.0",
        "name": "Booth Catalogs",
        "description": "Israeli (Hebrew) and Arabic films and series, from Wikidata. Refreshed weekly.",
        "resources": ["catalog"],
        "types": ["movie", "series"],
        "idPrefixes": ["tt"],
        "catalogs": manifest_catalogs,
    }
    (ROOT / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
