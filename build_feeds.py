#!/usr/bin/env python3
"""
build_feeds.py · 1.2-pub

Pulls the RSS/Atom feeds listed in sources.json and writes feeds.json:
merged headlines (newest first) plus a status line per source.
Run by the GitHub workflow on a schedule; the dashboard page reads the
committed feeds.json from raw.githubusercontent.com.

Usage:
  python scripts/build_feeds.py [--sources sources.json] [--out feeds.json]
  python scripts/build_feeds.py --fixtures DIR   # offline test: DIR/<n>.xml per source, in order
"""
import argparse
import html
import json
import re
import sys
import urllib.request
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path

from defusedxml import ElementTree as ET   # hardened XML parser (no entity expansion / external entities)

VERSION = "1.2-pub"
USER_AGENT = "BackwaterFx-dash/1.2 (+https://github.com/ACCOUNT/bwf-dash)"
TIMEOUT_S = 20
MAX_BYTES = 5 * 1024 * 1024
ITEMS_PER_FEED = 15
MAX_ITEMS = 200
TITLE_MAX = 240

TAG_RE = re.compile(r"<[^>]+>")
WS_RE = re.compile(r"\s+")


def local(tag):
    """Strip any XML namespace: '{ns}entry' -> 'entry'."""
    return tag.rsplit("}", 1)[-1] if isinstance(tag, str) else ""


def child(el, name):
    for c in el:
        if local(c.tag) == name:
            return c
    return None


def text_of(el):
    return "".join(el.itertext()) if el is not None else ""


def clean_title(raw):
    t = html.unescape(TAG_RE.sub("", html.unescape(raw or "")))
    return WS_RE.sub(" ", t).strip()[:TITLE_MAX]


def clean_url(raw):
    u = (raw or "").strip()
    return u if re.match(r"^https?://", u, re.I) and len(u) <= 2048 and not re.search(r"\s", u) else ""


def parse_date(raw):
    s = (raw or "").strip()
    if not s:
        return None
    try:
        d = parsedate_to_datetime(s)          # RFC 822 (RSS)
    except (TypeError, ValueError, IndexError):
        try:
            d = datetime.fromisoformat(s.replace("Z", "+00:00"))   # ISO 8601 (Atom)
        except ValueError:
            return None
    if d.tzinfo is None:
        d = d.replace(tzinfo=timezone.utc)
    return d.astimezone(timezone.utc)


def parse_feed(data, label, group):
    root = ET.fromstring(data)
    out = []
    kind = local(root.tag)
    if kind == "rss" or kind == "RDF":
        chan = child(root, "channel")
        nodes = [c for c in (chan if chan is not None else root) if local(c.tag) == "item"]
        if kind == "RDF":
            nodes += [c for c in root if local(c.tag) == "item"]
        for it in nodes:
            title = clean_title(text_of(child(it, "title")))
            link = clean_url(text_of(child(it, "link")))
            date = parse_date(text_of(child(it, "pubDate")) or text_of(child(it, "date")))
            if title and link and date:
                out.append((date, title, link))
    elif kind == "feed":   # Atom
        for it in (c for c in root if local(c.tag) == "entry"):
            title = clean_title(text_of(child(it, "title")))
            link = ""
            for c in it:
                if local(c.tag) == "link" and c.get("rel", "alternate") == "alternate":
                    link = clean_url(c.get("href"))
                    break
            date = parse_date(text_of(child(it, "published")) or text_of(child(it, "updated")))
            if title and link and date:
                out.append((date, title, link))
    else:
        raise ValueError("not an RSS or Atom document (root <%s>)" % kind)
    out.sort(key=lambda x: x[0], reverse=True)
    return [{"t": d.strftime("%Y-%m-%dT%H:%M:%SZ"), "src": label, "group": group, "title": t, "url": u}
            for d, t, u in out[:ITEMS_PER_FEED]]


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.5"})
    with urllib.request.urlopen(req, timeout=TIMEOUT_S) as r:
        data = r.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise ValueError("response larger than %d bytes" % MAX_BYTES)
    return data


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sources", default="sources.json")
    ap.add_argument("--out", default="feeds.json")
    ap.add_argument("--fixtures", help="offline test directory: 0.xml, 1.xml, ... in source order")
    a = ap.parse_args()

    sources = json.loads(Path(a.sources).read_text(encoding="utf-8"))["sources"]
    items, status = [], []
    for n, s in enumerate(sources):
        st = {"label": s["label"], "group": s["group"], "ok": False, "count": 0, "error": ""}
        try:
            if a.fixtures:
                p = Path(a.fixtures) / ("%d.xml" % n)
                if not p.exists():
                    raise FileNotFoundError("no fixture")
                data = p.read_bytes()
            else:
                data = fetch(s["url"])
            got = parse_feed(data, s["label"], s["group"])
            items += got
            st["count"] = len(got)
            st["ok"] = bool(got)
            if not got:
                st["error"] = "feed loaded but returned no dated items"
        except Exception as e:   # one bad feed never stops the run
            st["error"] = ("%s: %s" % (type(e).__name__, e))[:160]
        status.append(st)
        print("%-18s %-5s %3d  %s" % (st["label"], "ok" if st["ok"] else "FAIL", st["count"], st["error"]), file=sys.stderr)

    seen, merged = set(), []
    for i in sorted(items, key=lambda x: x["t"], reverse=True):
        if i["url"] in seen:
            continue
        seen.add(i["url"])
        merged.append(i)

    payload = {
        "version": VERSION,
        "pulled": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "sources": status,
        "items": merged[:MAX_ITEMS],
    }
    Path(a.out).write_text(json.dumps(payload, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    ok = sum(1 for s in status if s["ok"])
    print("wrote %s: %d items from %d/%d sources" % (a.out, len(payload["items"]), ok, len(status)), file=sys.stderr)
    # Fail the run only if every source failed, so one dead feed doesn't block updates.
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
