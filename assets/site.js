/* ============================================================
   NOIR business details — the ONLY place to edit them.
   When your LLC is formed, change legalName (and location),
   then push the site. Every page and the footer update.
   ============================================================ */
window.NOIR = {
  name: "NOIR",
  legalName: "NOIR",                 // e.g. "NOIR Gift Cards LLC"
  email: "support@noirgc.com",
  location: "United States",
  responseTime: "within 24 hours",
  policyDate: "November 19, 2026",
};

(function () {
  const N = window.NOIR;

  // fill <span data-noir="email"></span> etc.
  document.querySelectorAll("[data-noir]").forEach((el) => {
    el.textContent = N[el.dataset.noir] ?? "";
  });
  document.querySelectorAll("a[data-noir-mail]").forEach((a) => {
    a.href = "mailto:" + N.email;
    if (!a.textContent.trim()) a.textContent = N.email;
  });

  // footer on every page
  const css = document.createElement("style");
  css.textContent = `
.noir-footer{width:100%;max-width:1100px;margin:56px auto 0;padding:24px 5% 32px;
  border-top:1px solid rgba(255,255,255,.08);text-align:center;
  font-family:'JetBrains Mono',monospace;font-size:11px;color:#555;line-height:1.8}
.noir-footer nav{display:flex;flex-wrap:wrap;justify-content:center;gap:6px 18px;margin-bottom:10px}
.noir-footer a{color:#777;text-decoration:none}
.noir-footer a:hover{color:#fff}
.noir-footer p{max-width:620px;margin:0 auto}`;
  document.head.appendChild(css);

  const f = document.createElement("footer");
  f.className = "noir-footer";
  const year = new Date().getFullYear();
  f.innerHTML = `
<nav>
  <a href="about.html">About &amp; FAQ</a>
  <a href="reviews.html">Reviews</a>
  <a href="contact.html">Contact</a>
  <a href="refund.html">Refund policy</a>
  <a href="terms.html">Terms</a>
  <a href="privacy.html">Privacy</a>
</nav>
<p>NOIR is an independent reseller of digital gift cards and is not affiliated with, sponsored or endorsed by any of the brands shown. All trademarks belong to their owners.</p>
<p>© ${year} <span data-noir-legal></span> · <a data-noir-mail-footer></a></p>`;
  document.body.appendChild(f);
  f.querySelector("[data-noir-legal]").textContent = N.legalName;
  const mail = f.querySelector("[data-noir-mail-footer]");
  mail.href = "mailto:" + N.email;
  mail.textContent = N.email;
})();
