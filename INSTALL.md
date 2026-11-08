# Install bwf-dash

About 15 minutes. You need a GitHub account and a WordPress page where you can add a Custom HTML block and load a script.

## 1. Create the repository

1. On GitHub, create a new **public** repository named `bwf-dash`. Do not add a README or license; this package has them.
2. Upload every file and folder from this package, keeping the folder structure. Include the hidden `.github` folder.
   - Web upload: drag the whole unzipped folder onto the repository's "uploading an existing file" page.
   - Or from a terminal, inside the unzipped folder:
     ```
     git init -b main
     git add .
     git commit -m "Initial commit"
     git remote add origin https://github.com/ACCOUNT/bwf-dash.git
     git push -u origin main
     ```
     Before committing, check that `git config user.email` is an address you are happy to make public, or use your GitHub noreply address.

## 2. Turn on the workflow

1. Open the **Actions** tab. If GitHub asks, allow workflows to run.
2. **Settings → Actions → General → Workflow permissions:** choose **Read and write permissions** and save. The workflow needs this to commit `feeds.json`.
3. In **Actions**, choose **Build feeds.json → Run workflow**.
4. When it finishes, open `feeds.json` in the repository. `pulled` should show a time and `items` should hold headlines.
5. Look at the `sources` list. Any entry with `"ok": false` has a bad or moved URL. Fix it in `sources.json`, commit, and run the workflow again.

From then on it runs every 30 minutes by itself. GitHub sometimes starts scheduled runs a few minutes late.

## 3. Point the page at your repository

In `web/bwf-sam-public.html`, replace `ACCOUNT` with your GitHub account name in this line:

```
data-feeds-url="https://raw.githubusercontent.com/ACCOUNT/bwf-dash/main/feeds.json"
```

Also replace `ACCOUNT` in `scripts/build_feeds.py` (the `USER_AGENT` line) so feed publishers can see where requests come from.

## 4. Add it to WordPress

1. Edit the page and add a **Custom HTML** block. Paste the whole of `web/bwf-sam-public.html`.
2. Load `web/bwf-sam-public.js` on that page through your usual script loader. It must load **after** the HTML block (footer placement is fine).
3. If you previously installed the BWF-SAM PHP feed snippet, remove it. It is no longer used.
4. Publish, then open the page and hard-reload (Cmd+Shift+R on a Mac).

## 5. Check it

| On the page | Expected |
|---|---|
| Header: KEV catalog / KEV loaded | A catalog version and the current time |
| Header: Feeds built | The time of the last workflow run |
| Breaking bar | Scrolling headlines, or a note if fewer than 3 are under 12 hours old |
| Sources panel | One tag per feed; "no data" marks a feed to fix in `sources.json` |

If headlines say "feeds.json did not load", check the `data-feeds-url` line and that the repository is public.

## Day to day

| Task | How |
|---|---|
| Refresh headlines now | Actions → Build feeds.json → Run workflow |
| Add or fix a feed | Edit `sources.json` and commit |
| Change ticker age, panel windows or the contractor watch | Edit `CFG` and the `WATCH_` patterns at the top of `web/bwf-sam-public.js` |

GitHub turns off scheduled workflows in a public repository after 60 days with no activity. The workflow's own commits count as activity, so this only happens if every feed stops changing. If it does, re-enable the workflow from the Actions tab.
