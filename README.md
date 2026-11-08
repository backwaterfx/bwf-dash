# bwf-dash

A public cybersecurity situational-awareness dashboard by BackwaterFx.

- **KEV numbers, charts and table:** pulled live in the visitor's browser from the CISA Known Exploited Vulnerabilities catalog on every page load.
- **Headlines:** a GitHub Actions workflow pulls public federal and press RSS feeds every 30 minutes and commits `feeds.json`. The page reads that file.

Nothing runs on the web server that hosts the page. It is one HTML block and one script.

## Repository layout

| Path | Purpose |
|---|---|
| `web/bwf-sam-public.html` | Dashboard markup and styles. Paste into a Custom HTML block. |
| `web/bwf-sam-public.js` | Dashboard script. Load after the HTML block. |
| `sources.json` | Feed list. Add, remove or fix feed URLs here. |
| `scripts/build_feeds.py` | Fetches and parses the feeds (RSS 2.0, RSS 1.0, Atom). |
| `.github/workflows/feeds.yml` | Runs the builder every 30 minutes and commits `feeds.json` when it changes. |
| `feeds.json` | Builder output. Do not edit by hand. |
| `INSTALL.md` | Setup steps for GitHub and WordPress. |

## How the pieces connect

```
RSS feeds ──► GitHub Actions (build_feeds.py) ──► feeds.json in this repo
                                                       │
CISA KEV (GitHub mirror) ──────────────┐               │
                                       ▼               ▼
                          visitor's browser runs bwf-sam-public.js
```

Both data files are served from `raw.githubusercontent.com`, which allows any website to read them.

## feeds.json format

```json
{
  "version": "1.2-pub",
  "pulled": "2026-01-01T00:00:00Z",
  "sources": [{"label": "...", "group": "federal|press", "ok": true, "count": 15, "error": ""}],
  "items":   [{"t": "2026-01-01T00:00:00Z", "src": "...", "group": "press", "title": "...", "url": "https://..."}]
}
```

## Security notes

- Feeds are parsed with `defusedxml`, which blocks entity-expansion and external-entity attacks.
- Titles are stripped of markup. Links must start with `http://` or `https://`. Undated items are dropped.
- The page escapes every value again when it renders, so a bad feed cannot inject script.
- One failing feed never stops a run. The run fails only if every source fails.
- The workflow can write only to this repository's contents. Commits use the `github-actions[bot]` noreply identity.

## Run the builder locally

```
python3 -m pip install defusedxml==0.7.1
python3 scripts/build_feeds.py
```

## License

Code: MIT, see `LICENSE`. Headlines in `feeds.json` belong to their publishers and link back to them. The license does not cover them.
