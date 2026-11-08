/*!
 * BWF-SAM public dashboard · 1.2-pub
 * Pulls the CISA KEV catalog and the GitHub-built feeds.json on every page
 * load, then renders the ticker, headline panels, contractor watch, KEV
 * summary, charts and table into #bwf-sam. No dependencies.
 */
(function () {
  'use strict';

  var CFG = {
    tickerMaxAgeH: 12,     // headlines older than this roll off the ticker
    tickerMin: 3,          // fewer than this → ticker shows a "no fresh headlines" note
    pxPerSec: 40,          // ticker speed
    fedDays: 14,           // federal panel window
    fedMax: 10,
    pressHours: 48,        // press panel window
    pressMax: 12,
    watchMax: 10,
    feedsEveryMin: 15,     // re-pull feeds while the page stays open
    kevEveryMin: 60,       // re-pull KEV while the page stays open
    kevWindowDays: 30,
    medianWindowDays: 90,
    priorYears: 3
  };

  // Contractor watch: title must name a contractor and a charging/court step, or name Deloitte.
  var WATCH_ACTOR = /\bcontractors?\b/i;
  var WATCH_STEP = /\b(indict(?:ed|ment)?|charg(?:ed|es)|arrest(?:ed)?|plead(?:s|ed)?|pleaded|sentenc(?:ed|ing)|convicted)\b/i;
  var WATCH_NAMED = /\bdeloitte\b/i;

  var BRAND = { bar: '#78866B', barAlt: '#A9BA9D', grid: '#4A4E57', axis: '#8A8E97', label: '#D4D8E1' };
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var DAY = 864e5;

  function start() {
    var root = document.getElementById('bwf-sam');
    if (!root || root.getAttribute('data-bwf-ready')) return;
    root.setAttribute('data-bwf-ready', '1');

    var $ = function (name) { return root.querySelector('[data-bwf="' + name + '"]'); };
    var kevUrl = root.getAttribute('data-kev-url');
    var feedsUrl = root.getAttribute('data-feeds-url');
    var feedItems = [];

    // ---------- helpers ----------
    function esc(s) {
      return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
      });
    }
    function safeUrl(u) { return /^https?:\/\//i.test(u || '') ? u : '#'; }
    function isoDay(ms) { return new Date(ms).toISOString().slice(0, 10); }
    function dayMs(s) { return Date.parse(s + 'T00:00:00Z'); }
    function hhmm(ms) { return new Date(ms).toISOString().slice(11, 16) + 'Z'; }
    function stamp(ms) { return new Date(ms).toISOString().replace('T', ' ').slice(0, 16) + ' UTC'; }
    function ago(ms) {
      var m = Math.max(0, Math.round(ms / 60000));
      if (m < 60) return m + 'm ago';
      if (m < 48 * 60) return Math.floor(m / 60) + 'h ' + String(m % 60).padStart(2, '0') + 'm ago';
      return Math.floor(m / 1440) + 'd ago';
    }
    function median(a) {
      if (!a.length) return null;
      var s = a.slice().sort(function (x, y) { return x - y; });
      return s[Math.floor(s.length / 2)];
    }
    function getJSON(url) {
      return fetch(url, { cache: 'no-store', credentials: 'omit' }).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      });
    }

    // ---------- KEV ----------
    function loadKev() {
      getJSON(kevUrl).then(renderKev).catch(function (e) {
        $('kev-ver').textContent = 'unavailable';
        $('kev-body').innerHTML = '<tr><td colspan="8">Could not load the KEV catalog (' + esc(e.message) + '). Reload to try again.</td></tr>';
      });
    }

    function renderKev(d) {
      var V = (d && d.vulnerabilities) || [];
      var now = Date.now();
      var today = dayMs(isoDay(now));
      var Y = new Date(now).getUTCFullYear();
      var md = isoDay(now).slice(5);
      var rows = V.map(function (v) {
        var a = dayMs(v.dateAdded), due = dayMs(v.dueDate);
        return { a: a, added: v.dateAdded, due: v.dueDate, win: Math.round((due - a) / DAY), cve: v.cveID,
          vendor: v.vendorProject, product: v.product,
          name: String(v.vulnerabilityName || '').replace(String(v.vendorProject || '') + ' ', ''),
          rw: v.knownRansomwareCampaignUse, y: +v.dateAdded.slice(0, 4), md: v.dateAdded.slice(5) };
      }).filter(function (r) { return !isNaN(r.a); });

      $('kev-ver').textContent = (d.catalogVersion || '?') + ' · ' + (d.count || rows.length) + ' entries';
      $('kev-at').textContent = stamp(now);

      var recent = rows.filter(function (r) { return today - r.a <= CFG.kevWindowDays * DAY; })
        .sort(function (a, b) { return b.a - a.a || (a.cve < b.cve ? 1 : -1); });
      $('s-30').textContent = recent.length;
      $('s-rw').textContent = recent.filter(function (r) { return r.rw === 'Known'; }).length;

      // YTD vs the same calendar date in prior years, plus prior full years
      var ytd = rows.filter(function (r) { return r.y === Y; }).length;
      $('s-ytd-k').textContent = 'KEV added · ' + Y + ' YTD';
      $('s-ytd').textContent = ytd;
      var cut = MON[+md.slice(0, 2) - 1] + ' ' + (+md.slice(3));
      var html = '<span class="h"></span><span class="h">to ' + esc(cut) + '</span><span class="h">Year</span>';
      for (var i = 1; i <= CFG.priorYears; i++) {
        var py = Y - i;
        var same = rows.filter(function (r) { return r.y === py && r.md <= md; }).length;
        var full = rows.filter(function (r) { return r.y === py; }).length;
        html += '<span class="y">' + py + '</span><span class="n">' + same + '</span><span class="n">' + full + '</span>';
      }
      $('s-yoy').innerHTML = html;

      // Median remediation window: last 90 days vs prior full year
      var w90 = median(rows.filter(function (r) { return today - r.a <= CFG.medianWindowDays * DAY; }).map(function (r) { return r.win; }));
      var wPrev = median(rows.filter(function (r) { return r.y === Y - 1; }).map(function (r) { return r.win; }));
      $('s-win').textContent = w90 == null ? '—' : w90 + ' d';
      $('s-win-s').textContent = wPrev == null ? 'days from add to federal due date' : 'median for ' + (Y - 1) + ': ' + wPrev + ' d';

      // Weekly additions, last 12 ISO weeks (Mon start)
      var dow = (new Date(today).getUTCDay() + 6) % 7;
      var thisMon = today - dow * DAY, weeks = [];
      for (var k = 11; k >= 0; k--) {
        var ws = thisMon - k * 7 * DAY, we = ws + 7 * DAY;
        var n = rows.filter(function (r) { return r.a >= ws && r.a < we; }).length;
        var dt = new Date(ws);
        weeks.push({ k: MON[dt.getUTCMonth()] + ' ' + dt.getUTCDate(), v: n,
          tip: 'Week of ' + isoDay(ws) + ': ' + n + ' added' + (k === 0 ? ' (partial)' : '') });
      }
      var wmax = Math.max(4, Math.ceil(Math.max.apply(null, weeks.map(function (w) { return w.v; })) / 4) * 4);
      barChart($('c-weeks'), weeks, { max: wmax, ticks: [0, wmax / 4, wmax / 2, wmax * 3 / 4, wmax], label: 'KEV additions per week, last 12 weeks' });

      // Median window by month added: prior year baseline + this year's months
      var mons = [];
      var prevAll = rows.filter(function (r) { return r.y === Y - 1; });
      if (prevAll.length) mons.push({ k: String(Y - 1), v: median(prevAll.map(function (r) { return r.win; })), base: true,
        tip: (Y - 1) + ' (all): median ' + median(prevAll.map(function (r) { return r.win; })) + ' d over ' + prevAll.length + ' adds' });
      for (var m = 0; m <= new Date(now).getUTCMonth(); m++) {
        var mm = rows.filter(function (r) { return r.y === Y && +r.added.slice(5, 7) === m + 1; });
        if (!mm.length) continue;
        var mv = median(mm.map(function (r) { return r.win; }));
        mons.push({ k: MON[m], v: mv, tip: MON[m] + ' ' + Y + ': median ' + mv + ' d over ' + mm.length + ' adds' });
      }
      var mmax = Math.max(7, Math.ceil(Math.max.apply(null, mons.map(function (x) { return x.v; })) / 7) * 7);
      var mt = []; for (var t = 0; t <= mmax; t += 7) mt.push(t);
      barChart($('c-win'), mons, { max: mmax, ticks: mt, label: 'Median remediation window by month', highlight: function (x) { return x.base; } });

      // Table
      var input = root.querySelector('#bwf-kev-q');
      function draw() {
        var q = (input.value || '').toLowerCase();
        var list = recent.filter(function (r) {
          return !q || [r.added, r.cve, r.vendor, r.product, r.name, r.rw].join(' ').toLowerCase().indexOf(q) > -1;
        });
        $('kev-body').innerHTML = list.map(function (r) {
          return '<tr><td class="mono">' + esc(r.added) + '</td><td class="mono"><a href="https://www.cve.org/CVERecord?id=' +
            encodeURIComponent(r.cve) + '" target="_blank" rel="noopener">' + esc(r.cve) + '</a></td><td>' + esc(r.vendor) +
            '</td><td>' + esc(r.product) + '</td><td>' + esc(r.name) + '</td><td class="mono">' + esc(r.due) +
            '</td><td class="mono">' + r.win + ' d</td><td class="mono">' + esc(r.rw) + '</td></tr>';
        }).join('') || '<tr><td colspan="8">No entries match that filter.</td></tr>';
      }
      input.oninput = draw;
      draw();
    }

    function barChart(el, data, opts) {
      el.querySelectorAll('svg,.tip').forEach(function (n) { n.remove(); });
      if (!data.length) return;
      var W = 520, H = 220, m = { t: 20, r: 8, b: 34, l: 30 };
      var iw = W - m.l - m.r, ih = H - m.t - m.b, bw = iw / data.length, gap = 2;
      var y = function (v) { return m.t + ih - (v / opts.max) * ih; };
      var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(opts.label) + '">';
      opts.ticks.forEach(function (t) {
        s += '<line x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + y(t) + '" y2="' + y(t) + '" stroke="' + BRAND.grid + '" stroke-width="1"' + (t ? ' stroke-dasharray="2 3"' : '') + '/>';
        s += '<text x="' + (m.l - 6) + '" y="' + (y(t) + 4) + '" text-anchor="end" fill="' + BRAND.axis + '" font-family="JetBrains Mono,monospace" font-size="10">' + t + '</text>';
      });
      data.forEach(function (d, i) {
        var x = m.l + i * bw + gap, w = bw - gap * 2, h = (d.v / opts.max) * ih, top = y(d.v);
        var r = Math.min(4, w / 2, h);
        var fill = opts.highlight && opts.highlight(d) ? BRAND.barAlt : BRAND.bar;
        s += '<g class="bar" data-tip="' + esc(d.tip) + '" data-x="' + (x + w / 2) + '" data-y="' + top + '">';
        s += '<rect x="' + (m.l + i * bw) + '" y="' + m.t + '" width="' + bw + '" height="' + ih + '" fill="transparent"/>';
        if (h > 0) s += '<path d="M' + x + ',' + (m.t + ih) + ' V' + (top + r) + ' Q' + x + ',' + top + ' ' + (x + r) + ',' + top + ' H' + (x + w - r) + ' Q' + (x + w) + ',' + top + ' ' + (x + w) + ',' + (top + r) + ' V' + (m.t + ih) + ' Z" fill="' + fill + '"/>';
        s += '<text x="' + (x + w / 2) + '" y="' + (top - 5) + '" text-anchor="middle" fill="' + BRAND.label + '" font-family="JetBrains Mono,monospace" font-size="10">' + d.v + '</text>';
        s += '<text x="' + (x + w / 2) + '" y="' + (H - m.b + 14) + '" text-anchor="middle" fill="' + BRAND.axis + '" font-family="JetBrains Mono,monospace" font-size="9.5">' + esc(d.k) + '</text></g>';
      });
      el.insertAdjacentHTML('beforeend', s + '</svg>');
      var tip = document.createElement('div'); tip.className = 'tip'; tip.hidden = true; el.appendChild(tip);
      var svg = el.querySelector('svg'), bars = el.querySelectorAll('.bar');
      bars.forEach(function (g) {
        g.addEventListener('mouseenter', function () {
          var sc = svg.getBoundingClientRect().width / W;
          tip.textContent = g.getAttribute('data-tip'); tip.hidden = false;
          tip.style.left = (svg.offsetLeft + g.getAttribute('data-x') * sc) + 'px';
          tip.style.top = (svg.offsetTop + g.getAttribute('data-y') * sc) + 'px';
          bars.forEach(function (o) { o.style.opacity = o === g ? 1 : 0.55; });
        });
        g.addEventListener('mouseleave', function () { tip.hidden = true; bars.forEach(function (o) { o.style.opacity = 1; }); });
      });
    }

    // ---------- Feeds ----------
    function loadFeeds() {
      getJSON(feedsUrl).then(function (p) {
        feedItems = ((p && p.items) || []).map(function (i) {
          return { t: Date.parse(i.t), src: i.src, group: i.group, title: i.title, url: safeUrl(i.url) };
        }).filter(function (i) { return !isNaN(i.t); }).sort(function (a, b) { return b.t - a.t; });
        $('feeds-at').textContent = p.pulled ? stamp(Date.parse(p.pulled)) : '—';
        $('tk-asof').textContent = p.pulled ? 'feeds ' + hhmm(Date.parse(p.pulled)) : '';
        renderHealth(p.sources || []);
        renderPanels();
        renderTicker();
      }).catch(function (e) {
        var msg = 'Headlines unavailable: feeds.json did not load (' + esc(e.message) + ').';
        $('tk-track').innerHTML = '<div class="note">' + msg + '</div>';
        $('tk-track').style.animation = 'none';
        $('tk-asof').textContent = 'offline';
        ['fed', 'press', 'watch'].forEach(function (k) { $(k).innerHTML = '<div class="empty">' + msg + '</div>'; });
        $('health').innerHTML = '<span class="meta">' + msg + '</span>';
      });
    }

    function itemHtml(i, now) {
      var d = new Date(i.t);
      var md = MON[d.getUTCMonth()] + ' ' + d.getUTCDate();
      var when = now - i.t < 48 * 36e5 ? esc(ago(now - i.t)) + '<br>' + esc(md) : esc(isoDay(i.t));
      return '<div class="item"><span class="d">' + when + '</span><div>' +
        '<div class="t"><a href="' + esc(i.url) + '" target="_blank" rel="noopener">' + esc(i.title) + '</a></div>' +
        '<div class="row"><span class="tag' + (i.group === 'federal' ? '' : ' muted') + '">' + esc(i.src) + '</span></div></div></div>';
    }

    function renderPanels() {
      var now = Date.now();
      var fed = feedItems.filter(function (i) { return i.group === 'federal' && now - i.t <= CFG.fedDays * DAY; }).slice(0, CFG.fedMax);
      var press = feedItems.filter(function (i) { return i.group !== 'federal' && now - i.t <= CFG.pressHours * 36e5; }).slice(0, CFG.pressMax);
      var watch = feedItems.filter(function (i) {
        return WATCH_NAMED.test(i.title) || (WATCH_ACTOR.test(i.title) && WATCH_STEP.test(i.title));
      }).slice(0, CFG.watchMax);
      $('fed').innerHTML = fed.map(function (i) { return itemHtml(i, now); }).join('') || '<div class="empty">No federal items in the last ' + CFG.fedDays + ' days, or the federal feeds did not load (see Sources).</div>';
      $('press').innerHTML = press.map(function (i) { return itemHtml(i, now); }).join('') || '<div class="empty">No press items in the last ' + CFG.pressHours + ' hours.</div>';
      $('watch').innerHTML = watch.map(function (i) { return itemHtml(i, now); }).join('') || '<div class="empty">No matching headlines in the current feed window.</div>';
      $('n-fed').textContent = fed.length + ' · last ' + CFG.fedDays + ' days';
      $('n-press').textContent = press.length + ' · last ' + CFG.pressHours + ' hours';
    }

    function renderTicker() {
      var now = Date.now(), track = $('tk-track');
      var live = feedItems.filter(function (i) { return now - i.t >= -5 * 60000 && now - i.t <= CFG.tickerMaxAgeH * 36e5; });
      if (live.length < CFG.tickerMin) {
        track.style.animation = 'none';
        track.innerHTML = '<div class="note">Fewer than ' + CFG.tickerMin + ' headlines in the last ' + CFG.tickerMaxAgeH + ' hours (' + live.length + ' found).</div>';
        return;
      }
      var run = live.map(function (i) {
        return '<span class="tk"><time datetime="' + new Date(i.t).toISOString() + '">' + esc(ago(now - i.t)) + '</time><span class="src">' +
          esc(i.src) + '</span><a href="' + esc(i.url) + '" target="_blank" rel="noopener">' + esc(i.title) + '</a></span>';
      }).join('');
      track.style.animation = '';
      track.innerHTML = '<div class="run">' + run + '</div><div class="run" aria-hidden="true">' + run + '</div>';
      track.querySelectorAll('[aria-hidden] a').forEach(function (a) { a.tabIndex = -1; });
      var w = track.firstElementChild.getBoundingClientRect().width;
      track.style.setProperty('--dur', Math.max(30, w / CFG.pxPerSec) + 's');
    }

    function renderHealth(sources) {
      $('health').innerHTML = sources.map(function (s) {
        return '<span class="tag' + (s.ok ? '' : ' muted') + '" title="' + esc(s.ok ? s.count + ' items' : (s.error || 'no items')) + '">' +
          esc(s.label) + ' · ' + (s.ok ? s.count : 'no data') + '</span>';
      }).join('') || '<span class="meta">No sources reported.</span>';
    }

    // ---------- run ----------
    loadKev();
    loadFeeds();
    setInterval(function () { if (!document.hidden) loadFeeds(); }, CFG.feedsEveryMin * 60000);
    setInterval(function () { if (!document.hidden) loadKev(); }, CFG.kevEveryMin * 60000);
    setInterval(function () { if (feedItems.length) { renderTicker(); renderPanels(); } }, 5 * 60000);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { if (feedItems.length) renderTicker(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
