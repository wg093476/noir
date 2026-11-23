/* NOIR reviews — shared look for the home page section and reviews.html.
   Real reviews come from /api/order?reviews=1 (website orders + pre-launch customers).
   Only when the site is opened as files on your computer (no server) does it fall back to
   the sample set in assets/sample-reviews.js, with a "local preview" tag. That file is never
   uploaded to noirgc.com (see .vercelignore), so samples can't appear on the live site. */
(function () {
  const host = location.hostname;
  const SAMPLE_MODE = location.protocol === "file:" || host === "localhost" || host === "127.0.0.1";

  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };

  // ★★★★☆ as real elements so filled and empty stars can be styled
  function stars(n, cls = "") {
    const s = el("span", "nr-stars " + cls);
    s.setAttribute("aria-label", `${n} out of 5 stars`);
    for (let i = 1; i <= 5; i++) s.append(el("i", i <= Math.round(n) ? "on" : "", "★"));
    return s;
  }

  // Profile picture: initials on a grey disc (shade picked from the name), or a plain
  // silhouette for anonymous reviews. No photos of people.
  function avatar(name) {
    const a = el("span", "nr-ava");
    const clean = String(name || "").trim();
    if (!clean || /^anonymous$/i.test(clean)) {
      a.classList.add("anon");
      a.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="9" r="4"/><path d="M4 20c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>';
      return a;
    }
    const parts = clean.replace(/\./g, "").split(/\s+/);
    a.textContent = (parts[0][0] + (parts.length > 1 ? parts.at(-1)[0] : "")).toUpperCase();
    let h = 0;
    for (const c of clean) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    a.dataset.tone = String(h % 4); // 4 greys, see CSS
    return a;
  }

  function ago(t) {
    const d = Math.floor((Date.now() - t) / 86400000);
    if (d < 1) return "today";
    if (d === 1) return "yesterday";
    if (d < 30) return d + " days ago";
    if (d < 60) return "1 month ago";
    if (d < 365) return Math.floor(d / 30) + " months ago";
    return new Date(t).toLocaleDateString("en-US", { month: "short", year: "numeric" });
  }

  function card(rv) {
    const c = el("article", "nr-card");
    const head = el("div", "nr-head");
    const who = el("div", "nr-who");
    const nm = el("div", "nr-name", rv.name || "Anonymous");
    const meta = el("div", "nr-meta");
    if (rv.verified === true && !rv.sample)
      meta.append(el("span", "nr-ver", rv.source === "early" ? "✓ Verified customer" : "✓ Verified purchase"));
    if (rv.source !== "early") meta.append(el("span", null, ago(rv.at)));
    who.append(nm, meta);
    head.append(avatar(rv.name), who);
    c.append(head, stars(rv.rating));
    if (rv.text) c.append(el("p", "nr-text", rv.text));
    if (rv.brand) c.append(el("div", "nr-item", `${rv.brand}${rv.amount ? " · $" + rv.amount : ""}`));
    return c;
  }

  // Overall rating + 5→1 distribution bars. onPick(n) makes the bars filter buttons.
  function summary(d, onPick) {
    const box = el("div", "nr-summary");
    const score = el("div", "nr-score");
    score.append(el("div", "nr-avg", d.average.toFixed(1)), stars(d.average, "big"),
      el("div", "nr-count", `${d.count} review${d.count === 1 ? "" : "s"}`));
    const bars = el("div", "nr-bars");
    [5, 4, 3, 2, 1].forEach((n) => {
      const pct = d.count ? Math.round(((d.breakdown[n] || 0) / d.count) * 100) : 0;
      const row = el(onPick ? "button" : "div", "nr-bar");
      row.dataset.s = n;
      const track = el("span", "nr-track"); const fill = el("i"); fill.style.width = pct + "%"; track.append(fill);
      row.append(el("span", "nr-lbl", n + "★"), track, el("span", "nr-pct", pct + "%"));
      if (onPick) { row.type = "button"; row.title = `Show ${n}-star reviews`; row.onclick = () => onPick(n); }
      bars.append(row);
    });
    box.append(score, bars);
    return box;
  }

  // Same shape as the API: { count, average, breakdown, total, reviews }
  function summarize(all, { offset = 0, limit = 20, stars: only = 0 } = {}) {
    const breakdown = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    all.forEach((r) => breakdown[r.rating]++);
    const count = all.length;
    const average = count ? Math.round((all.reduce((s, r) => s + r.rating, 0) / count) * 10) / 10 : null;
    const pool = only ? all.filter((r) => r.rating === only) : all;
    return { count, average, breakdown, total: pool.length, reviews: pool.slice(offset, offset + limit) };
  }

  let samplePromise = null;
  function loadSamples() {
    samplePromise ||= new Promise((resolve) => {
      const s = document.createElement("script");
      s.src = "assets/sample-reviews.js";
      s.onload = () => resolve(window.NOIR_SAMPLE_REVIEWS || []);
      s.onerror = () => resolve([]);
      document.head.append(s);
    });
    return samplePromise;
  }

  async function fetchReviews(opts = {}) {
    // Real reviews whenever the server is there; samples only when the files are opened
    // on your computer with no server (or the local server's API isn't answering).
    if (location.protocol !== "file:") {
      try {
        const q = new URLSearchParams({ reviews: 1, limit: opts.limit || 20, offset: opts.offset || 0 });
        if (opts.stars) q.set("stars", opts.stars);
        const r = await fetch("/api/order?" + q);
        if (r.ok) return r.json();
        if (!SAMPLE_MODE) throw new Error("reviews " + r.status);
      } catch (err) {
        if (!SAMPLE_MODE) throw err;
      }
    }
    if (SAMPLE_MODE) {
      const samples = await loadSamples();
      if (samples.length) return { ...summarize(samples, opts), sample: true };
    }
    return { count: 0, average: null, breakdown: {}, total: 0, reviews: [] };
  }

  // Local preview only: one small tag pinned to the screen corner (outside the review
  // section, so the cards look exactly like the live site). Returns nothing visible in place.
  function sampleBanner() {
    if (!document.getElementById("nrPreviewTag")) {
      const t = el("div", "nr-preview-tag", "LOCAL PREVIEW · sample reviews");
      t.id = "nrPreviewTag";
      document.body.append(t);
    }
    return document.createComment("sample reviews (local preview)");
  }

  // Styles shared by both pages (black and white, thin borders).
  const css = document.createElement("style");
  css.textContent = `
.nr-stars{display:inline-flex;gap:2px;font-size:13px;line-height:1;font-style:normal}
.nr-stars i{font-style:normal;color:#3a3a3a}
.nr-stars i.on{color:#fff}
.nr-stars.big{font-size:18px;gap:3px}
.nr-card{background:#0b0b0b;border:1px solid rgba(255,255,255,.1);border-radius:14px;padding:18px;text-align:left;display:flex;flex-direction:column;gap:10px;min-width:0}
.nr-head{display:flex;align-items:center;gap:11px}
.nr-ava{flex:none;width:38px;height:38px;border-radius:50%;display:flex;align-items:center;justify-content:center;
  font-family:'JetBrains Mono',monospace;font-size:13px;font-weight:500;letter-spacing:.5px;color:#fff;background:#1f1f1f;border:1px solid rgba(255,255,255,.14)}
.nr-ava[data-tone="1"]{background:#2b2b2b}
.nr-ava[data-tone="2"]{background:#fff;color:#000;border-color:#fff}
.nr-ava[data-tone="3"]{background:#121212;border-color:rgba(255,255,255,.3)}
.nr-ava.anon{color:#8a8a8a;background:#141414}
.nr-ava svg{width:20px;height:20px}
.nr-who{min-width:0}
.nr-name{color:#fff;font-size:13px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.nr-meta{display:flex;flex-wrap:wrap;gap:4px 10px;color:#777;font-size:11px;margin-top:2px}
.nr-ver{color:#e6e6e6}
.nr-text{color:#d0d0d0;font-size:12.5px;line-height:1.7;margin:0;word-wrap:break-word}
.nr-item{color:#777;font-size:11px;margin-top:auto}
.nr-summary{display:grid;grid-template-columns:200px 1fr;gap:28px;align-items:center;max-width:640px;margin:0 auto 26px;
  background:#0b0b0b;border:1px solid rgba(255,255,255,.1);border-radius:16px;padding:22px 26px}
.nr-score{text-align:center}
.nr-avg{font-family:'Pixelify Sans',sans-serif;font-size:52px;line-height:1;color:#fff;margin-bottom:8px}
.nr-count{color:#8a8a8a;font-size:12px;margin-top:8px}
.nr-bars{display:flex;flex-direction:column;gap:2px}
.nr-bar{display:grid;grid-template-columns:34px 1fr 40px;align-items:center;gap:12px;width:100%;
  background:none;border:none;color:#bbb;font-family:'JetBrains Mono',monospace;font-size:12px;padding:5px 0;text-align:left}
button.nr-bar{cursor:pointer}
button.nr-bar:hover,.nr-bar.on{color:#fff}
.nr-track{height:7px;border-radius:7px;background:#1c1c1c;overflow:hidden}
.nr-track i{display:block;height:100%;background:#fff;border-radius:7px}
.nr-pct{text-align:right;color:#888}
.nr-preview-tag{position:fixed;left:10px;bottom:10px;z-index:60;padding:5px 9px;border-radius:6px;background:#fff;color:#000;
  font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:.5px;pointer-events:none;opacity:.85}
.nr-btn{display:inline-block;padding:12px 22px;border-radius:10px;border:1px solid rgba(255,255,255,.25);background:#0b0b0b;
  color:#fff;font-family:'JetBrains Mono',monospace;font-size:13px;text-decoration:none;cursor:pointer}
.nr-btn:hover{background:#fff;color:#000;border-color:#fff}
@media (max-width:640px){
  .nr-summary{grid-template-columns:1fr;gap:16px;padding:20px 18px}
}`;
  document.head.append(css);

  window.NOIRReviews = { SAMPLE_MODE, card, summary, summarize, stars, avatar, fetchReviews, sampleBanner, el };
})();
