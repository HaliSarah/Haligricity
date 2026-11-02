/*
  Title:       Haligricity Books — Shared Cart, Currency & Checkout
  Author:      Hali Sarah Parsons
  Date:        2026-10-30
  Modified By: Claude
  Description: Drop-in script for every book page. Reads data-* attributes on
               the page and builds: currency picker, book cards, product detail,
               cart count, and the full checkout (Stripe + Lulu shipping quote).
               The cart lives in localStorage, so it follows the customer from
               any book page to any other page on haligricity.iqproductionz.com.
  Host at:     /HaligricFoundation/Order/assets/shop.js
  Needs:       <script src="https://js.stripe.com/v3/"></script> before this file.

  Page hooks:
    <select data-hb-currency>            currency dropdown
    <div data-hb-row="original">         a row of cards (ids comma-separated)
    <div data-hb-product="gods">         full product block for one book
    <div data-hb-cartbar>                "View Cart" summary bar (book pages)
    <div data-hb-checkout>               the checkout panel (Cart page only)
    <a  data-hb-cartlink>                nav cart button (shows count)

  Privacy: only the cart (book IDs + quantities) and currency are remembered.
  Name, email and address are typed once at checkout and never stored.
*/
(function () {
  'use strict';

  // ── CONFIG ──────────────────────────────────────────────────────────────────
  const WORKER    = 'https://lulu-order.halisarahparsons.workers.dev'; // WHY: reuses the existing worker so its secrets carry over
  const STRIPE_PK = 'pk_live_51KGEFWCL2m4xr1VIspOtCN2T1EVYCgfhsF5zgDOT4NkIKbQ8PqiPTYBmaoYzJwXqp9jkFdb2TNZOf5QKBaQh5RAv00IYVZw3oI';
  const SITE      = 'https://haligricity.iqproductionz.com';
  const ORDER     = SITE + '/HaligricFoundation/Order';
  const ART       = ORDER + '/assets/covers/';
  const CART      = ORDER + '/Cart/';

  const CURRENCIES = {
    USD: 'US Dollar', EUR: 'Euro', GBP: 'British Pound', AUD: 'Australian Dollar', CAD: 'Canadian Dollar',
  };

  // WHY: display copy of the prices so pages render instantly. The worker
  // holds the real price list and re-prices every checkout, so if these ever
  // drift the customer is still charged the worker's numbers (shown in the
  // quote before paying). Keep both in sync when you change a price.
  const BOOKS = {
    'original': {
      title: 'Haligricity', ed: 'The Foundational Texts · Original Edition',
      tag: 'Original', cover: ART + 'original.jpg', url: ORDER + '/TheOriginal/',
      specs: [['Format', 'Hardcover case wrap, matte'], ['Size', '8.5 × 11 in'], ['Pages', '665'],
              ['Interior', 'Black & white on 60# cream'], ['Contains', 'The complete Haligric library in one volume']],
      price: { USD: 8888, EUR: 7777, GBP: 7777, AUD: 9999, CAD: 9999 },
    },
    'foundation-4x6': {
      title: 'Haligricity', ed: 'The Foundational Texts · Pocket Edition',
      cover: ART + 'foundation-4x6.jpg', url: ORDER + '/Files/4x6/Foundation/',
      specs: [['Format', 'Paperback, perfect bound, matte'], ['Size', 'Pocket · 4.25 × 6.875 in'],
              ['Interior', 'Black & white on 60# cream'], ['ISBN', '978-0-557-71940-2']],
      price: { USD: 4444, EUR: 3333, GBP: 3333, AUD: 7777, CAD: 7777 },
    },
    'adaptation': {
      title: 'The Haligric Adaptation Guide', ed: 'Modernized practices for Haligric practitioners',
      cover: ART + 'adaptation.jpg', url: ORDER + '/Files/4x6/Adaptation/',
      specs: [['Companion', 'To the Foundational Texts'], ['Format', 'Paperback, perfect bound, matte'],
              ['Size', 'Pocket · 4.25 × 6.875 in'], ['Pages', '130'], ['ISBN', '978-0-557-69557-7']],
      price: { USD: 1111, EUR: 1111, GBP: 1111, AUD: 2222, CAD: 2222 },
    },
    'gods': {
      title: 'The Gods of the World', ed: 'A Haligric cross-cultural compendium',
      cover: ART + 'gods.jpg', url: ORDER + '/Files/4x6/Gods/',
      specs: [['Companion', 'To the Foundational Texts'], ['Format', 'Paperback, perfect bound, matte'],
              ['Size', 'Pocket · 4.25 × 6.875 in'], ['Pages', '255'], ['ISBN', '978-0-557-69560-7']],
      price: { USD: 2222, EUR: 2222, GBP: 2222, AUD: 3333, CAD: 3333 },
    },
    'real-magic': {
      title: 'Real Magic', ed: 'An Introduction',
      // WHY: same cover image as the book's own page — no more placeholder.
      cover: SITE + '/RealMagic/Book-Front-Cover.gif', url: SITE + '/RealMagic/OrderNow/',
      specs: [['Format', 'Paperback, perfect bound'], ['Size', '5.5 × 8.5 in'], ['Pages', '71'],
              ['Author', 'Hali Sarah Parsons']],
      price: { USD: 777, EUR: 888, GBP: 777, AUD: 1111, CAD: 2222 },
    },
  };

  // WHY: ISO codes are what Lulu and Stripe need; names come from the browser
  // (Intl) so the list stays short. RU/UA left out under sanctions.
  const COUNTRIES = ['US','CA','GB','AU','NZ','IE','DE','FR','NL','BE','LU','AT','CH','ES','PT','IT','DK','SE','NO','FI',
    'IS','PL','CZ','SK','HU','RO','BG','GR','HR','SI','EE','LV','LT','MT','CY','JP','KR','SG','HK','TW','MY','PH','TH',
    'IN','AE','IL','ZA','NG','GH','KE','MX','BR','AR','CL','CO','PE','JM','TT','BS','BB','PR'];

  // ── STORAGE ─────────────────────────────────────────────────────────────────
  // WHY: localStorage can throw (private mode, blocked cookies). Every access
  // is wrapped so the shop still works — the cart just won't persist.
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* not persisted */ } },
  };

  let cart = sanitize(store.get('hb_cart', {}));
  let currency = store.get('hb_currency', null) || guessCurrency();
  let quote = null;          // last server quote; cleared whenever cart/currency/address changes
  const listeners = [];

  function sanitize(c) {
    // WHY: drop anything left over from old versions or edited by hand.
    const out = {};
    for (const [id, q] of Object.entries(c || {})) if (BOOKS[id] && +q > 0) out[id] = Math.min(20, Math.floor(+q));
    return out;
  }

  function guessCurrency() {
    // WHY: first-time visitors see a sensible currency without choosing; they can still change it.
    const l = (navigator.language || 'en-US').toUpperCase();
    if (l.endsWith('-GB')) return 'GBP';
    if (l.endsWith('-AU')) return 'AUD';
    if (l.endsWith('-CA')) return 'CAD';
    if (/^(DE|FR|ES|IT|NL|PT|FI|EL|SK|SL|ET|LV|LT)\b/.test(l) || /-(IE|AT|BE)$/.test(l)) return 'EUR';
    return 'USD';
  }

  // ── STATE CHANGES ───────────────────────────────────────────────────────────
  function changed() {
    // WHY: one place that persists state and redraws every widget, so the
    // cart count, cards and checkout can never disagree with each other.
    store.set('hb_cart', cart);
    store.set('hb_currency', currency);
    quote = null;
    listeners.forEach(fn => fn());
  }

  const HB = {
    BOOKS,
    get currency() { return currency; },
    setCurrency(c) { if (CURRENCIES[c] && c !== currency) { currency = c; changed(); } },
    add(id, n) { if (!BOOKS[id]) return; cart[id] = Math.min(20, (cart[id] || 0) + (n || 1)); changed(); },
    setQty(id, n) { if (n > 0) cart[id] = Math.min(20, n); else delete cart[id]; changed(); },
    count() { return Object.values(cart).reduce((s, q) => s + q, 0); },
    money(cents, cur) {
      // WHY: Intl formats € / £ / A$ / CA$ correctly for each currency.
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: cur || currency }).format(cents / 100);
    },
    price(id) { return HB.money(BOOKS[id].price[currency]); },
  };
  window.HB = HB;

  // ── SMALL DOM HELPERS ───────────────────────────────────────────────────────
  const $  = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function coverHTML(id, cls) {
    const b = BOOKS[id];
    // WHY: Real Magic has no cover art online yet, so draw a branded stand-in.
    if (!b.cover) return `<div class="cover cover-ph ${cls || ''}"><span class="ring"><i></i></span><b>${esc(b.title)}<br><small>${esc(b.ed)}</small></b></div>`;
    return `<img class="cover ${cls || ''}" src="${b.cover}" alt="${esc(b.title + ' — ' + b.ed)} cover" loading="lazy">`;
  }

  function flash(btn, text) {
    // WHY: quick visual confirmation so customers don't click "Add" twice.
    const old = btn.textContent;
    btn.textContent = text; btn.classList.add('added');
    setTimeout(() => { btn.textContent = old; btn.classList.remove('added'); }, 1300);
  }

  // ── WIDGETS ─────────────────────────────────────────────────────────────────
  function mountCurrency(sel) {
    sel.classList.add('hb-cur');
    sel.innerHTML = Object.entries(CURRENCIES).map(([c, n]) => `<option value="${c}">${c} — ${n}</option>`).join('');
    sel.addEventListener('change', () => HB.setCurrency(sel.value));
    const sync = () => { sel.value = currency; };
    listeners.push(sync); sync();
  }

  function mountCartLink(a) {
    a.href = CART;
    const sync = () => { a.innerHTML = 'Cart <b>' + HB.count() + '</b>'; };
    listeners.push(sync); sync();
  }

  function mountRow(el) {
    const ids = el.dataset.hbRow.split(',').map(s => s.trim()).filter(id => BOOKS[id]);
    const feature = el.classList.contains('one');
    // WHY: build once, then only refresh prices — avoids re-loading images on every change.
    el.innerHTML = ids.map(id => {
      const b = BOOKS[id];
      return `<article class="hb-card${feature ? ' feature' : ''}">
        ${b.tag ? `<span class="tag">${esc(b.tag)}</span>` : ''}
        <a href="${b.url}">${coverHTML(id)}</a>
        <h3>${esc(b.title)}</h3><div class="ed">${esc(b.ed)}</div>
        <div class="price" data-p="${id}"></div>
        <div class="acts">
          <button class="btn small" data-add="${id}">Add to Cart</button>
          <a class="btn small ghost" href="${b.url}">Details</a>
        </div></article>`;
    }).join('');
    $$('[data-add]', el).forEach(btn => btn.addEventListener('click', () => { HB.add(btn.dataset.add); flash(btn, 'Added ✓'); }));
    const sync = () => $$('[data-p]', el).forEach(p => { p.textContent = HB.price(p.dataset.p); });
    listeners.push(sync); sync();
  }

  function mountProduct(el) {
    const id = el.dataset.hbProduct; const b = BOOKS[id];
    if (!b) return;
    let n = 1;
    el.classList.add('hb-detail');
    el.innerHTML = `<div>${coverHTML(id)}</div>
      <div>
        ${b.tag ? `<span class="tag">${esc(b.tag)}</span>` : ''}
        <h2>${esc(b.title)}</h2><div class="ed">${esc(b.ed)}</div>
        <ul class="specs">${b.specs.map(([k, v]) => `<li><span>${esc(k)}</span>${esc(v)}</li>`).join('')}</ul>
        <div class="price" data-p></div>
        <div class="pnote">+ shipping, calculated for your address at checkout · printed to order</div>
        <div class="buy-row">
          <span class="qty"><button type="button" data-d="-1" aria-label="Fewer">−</button><output>1</output><button type="button" data-d="1" aria-label="More">+</button></span>
          <button class="btn" data-addp>Add to Cart</button>
          <a class="btn ghost" href="${CART}">View Cart</a>
        </div>
      </div>`;
    const out = $('output', el);
    $$('[data-d]', el).forEach(btn => btn.addEventListener('click', () => { n = Math.max(1, Math.min(20, n + +btn.dataset.d)); out.textContent = n; }));
    $('[data-addp]', el).addEventListener('click', e => { HB.add(id, n); flash(e.currentTarget, 'Added ✓'); });
    const sync = () => { $('[data-p]', el).textContent = HB.price(id); };
    listeners.push(sync); sync();
  }

  function mountCartBar(el) {
    // WHY: a strong, bottom-of-page call to action on every book page,
    // so buyers always know where to go once they've chosen their books.
    el.classList.add('checkout', 'cartbar');
    const sync = () => {
      const n = HB.count();
      const sub = Object.keys(cart).reduce((t, id) => t + BOOKS[id].price[currency] * cart[id], 0);
      el.innerHTML = n
        ? `<h2>Your Cart</h2><p class="lead">${n} book${n > 1 ? 's' : ''} · ${HB.money(sub)} before shipping</p>
           <a class="btn wide" href="${CART}">View Cart &amp; Checkout →</a>`
        : `<h2>Your Cart</h2><p class="lead">Your cart is empty — add a book above.</p>`;
    };
    listeners.push(sync); sync();
  }

  // ── CHECKOUT ────────────────────────────────────────────────────────────────
  function mountCheckout(el) {
    el.id = el.id || 'checkout';
    el.classList.add('checkout');
    const regionNames = (() => { try { return new Intl.DisplayNames(['en'], { type: 'region' }); } catch { return null; } })();
    const cName = c => (regionNames ? regionNames.of(c) : c);
    const countryOpts = COUNTRIES.map(c => [c, cName(c)]).sort((a, b) => (a[0] === 'US' ? -1 : b[0] === 'US' ? 1 : a[1].localeCompare(b[1])))
      .map(([c, n]) => `<option value="${c}">${esc(n)}</option>`).join('');

    el.innerHTML = `
      <div class="hb-form">
        <h2>Your Order</h2>
        <p class="lead">Every book ships together in one package — one shipping charge.</p>
        <ul class="cart-list"></ul>
        <div class="cart-add">
          <a class="btn small ghost" href="${ORDER}/">+ Add other Haligric books</a>
          <a class="btn small ghost" href="${BOOKS['real-magic'].url}">+ Add Real Magic</a>
          <select data-hb-currency aria-label="Currency"></select>
        </div>

        <div class="section-label">Your Information</div>
        <div class="form-grid">
          <div class="fld"><label>First Name <em>*</em></label><input class="hb-input" name="first" autocomplete="given-name"></div>
          <div class="fld"><label>Last Name <em>*</em></label><input class="hb-input" name="last" autocomplete="family-name"></div>
          <div class="fld"><label>Email <em>*</em></label><input class="hb-input" name="email" type="email" autocomplete="email"></div>
          <div class="fld"><label>Phone <em>*</em></label><input class="hb-input" name="phone" type="tel" autocomplete="tel" placeholder="Needed by the printer for delivery"></div>
        </div>

        <div class="section-label">Delivery Address</div>
        <div class="form-grid">
          <div class="fld full"><label>Street Address <em>*</em></label><input class="hb-input" name="line1" autocomplete="address-line1"></div>
          <div class="fld full"><label>Apt / Suite (optional)</label><input class="hb-input" name="line2" autocomplete="address-line2"></div>
          <div class="fld"><label>City <em>*</em></label><input class="hb-input" name="city" autocomplete="address-level2"></div>
          <div class="fld"><label>State / Region</label><input class="hb-input" name="state" autocomplete="address-level1" placeholder="TX"></div>
          <div class="fld"><label>Postal / ZIP <em>*</em></label><input class="hb-input" name="postcode" autocomplete="postal-code"></div>
          <div class="fld"><label>Country <em>*</em></label><select class="hb-select" name="country" autocomplete="country">${countryOpts}</select></div>
        </div>

        <button class="btn ghost wide" type="button" data-quote>Calculate Shipping &amp; Total →</button>
        <div class="hb-msg" data-msg1></div>

        <div data-pay hidden>
          <div class="totals"></div>
          <div class="tip-row">
            <label class="fld" style="margin:0"><span style="font-family:Cinzel,serif;font-size:.62rem;letter-spacing:.1em;text-transform:uppercase">Add a gift</span></label>
            <input class="hb-input" data-tip type="number" min="0" step="1" value="0" style="width:110px">
            <span class="note">Optional — give more if this work has meant something to you.</span>
          </div>
          <div class="section-label">Payment</div>
          <div id="hb-card"></div>
          <div class="hb-msg err" data-msg2></div>
          <button class="btn wide" type="button" data-paybtn>Complete Order &amp; Pay</button>
          <p class="fine">Secure payment by Stripe. Printed on demand and shipped directly to you — allow about 5–14 business days.<br>
          Your card is charged in the currency shown; your bank may convert it.</p>
        </div>
      </div>
      <div class="hb-done">
        <div class="sym">✦</div>
        <h3>Your Order Has Been Received</h3>
        <p data-donemsg></p>
        <p class="fine">You Are The Current · Be More You · Ashe.</p>
      </div>`;

    mountCurrency($('[data-hb-currency]', el));
    const list = $('.cart-list', el), payBox = $('[data-pay]', el), totals = $('.totals', el);
    const msg1 = $('[data-msg1]', el), msg2 = $('[data-msg2]', el);
    const quoteBtn = $('[data-quote]', el), payBtn = $('[data-paybtn]', el), tipIn = $('[data-tip]', el);
    const field = n => $(`[name="${n}"]`, el);

    // WHY: nothing typed here is saved. A changed address can change shipping
    // and tax, so the old total is cleared and must be recalculated.
    ['line1', 'city', 'state', 'postcode', 'country'].forEach(n => {
      field(n).addEventListener('input', () => { if (quote) { quote = null; drawCart(); } });
    });
    // WHY: clear any details an older version of this page may have saved.
    try { localStorage.removeItem('hb_customer'); } catch { /* storage blocked */ }

    function drawCart() {
      const ids = Object.keys(cart);
      list.innerHTML = ids.length ? ids.map(id => `<li>
          ${coverHTML(id)}
          <div class="t">${esc(BOOKS[id].title)}<small>${esc(BOOKS[id].ed)}</small></div>
          <span class="qty"><button type="button" data-q="${id}" data-d="-1">−</button><output>${cart[id]}</output><button type="button" data-q="${id}" data-d="1">+</button></span>
          <span class="lp">${HB.money(BOOKS[id].price[currency] * cart[id])}</span>
          <button class="rm" type="button" data-rm="${id}" aria-label="Remove">×</button></li>`).join('')
        : '<li class="cart-empty" style="display:block">Your cart is empty — add a book above.</li>';
      $$('[data-q]', list).forEach(b => b.addEventListener('click', () => HB.setQty(b.dataset.q, cart[b.dataset.q] + +b.dataset.d)));
      $$('[data-rm]', list).forEach(b => b.addEventListener('click', () => HB.setQty(b.dataset.rm, 0)));
      // WHY: hide payment until a fresh server quote exists for this exact cart.
      payBox.hidden = !quote;
      quoteBtn.textContent = quote ? 'Recalculate Shipping' : 'Calculate Shipping & Total →';
      quoteBtn.disabled = !ids.length;
    }
    listeners.push(drawCart); drawCart();

    function collect() {
      const v = n => field(n).value.trim();
      return {
        customer: { first: v('first'), last: v('last'), email: v('email'), phone: v('phone') },
        address: { line1: v('line1'), line2: v('line2'), city: v('city'), state: v('state'), postcode: v('postcode'), country: v('country') },
      };
    }

    async function post(path, data) {
      // WHY: single fetch wrapper so every call reports errors the same way.
      const r = await fetch(WORKER + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
      let d; try { d = await r.json(); } catch { d = {}; }
      if (!r.ok || !d.ok) throw new Error(d.error || 'Something went wrong — please try again.');
      return d;
    }

    let stripe = null, card = null;
    function ensureCard() {
      // WHY: mount Stripe only once the customer reaches payment — keeps page load light.
      if (card) return;
      stripe = window.Stripe(STRIPE_PK);
      card = stripe.elements().create('card', {
        style: { base: { fontFamily: '"Cormorant Garamond", Georgia, serif', fontSize: '17px', color: '#4A1060', '::placeholder': { color: '#aaa' } }, invalid: { color: '#c0392b' } },
      });
      card.mount('#hb-card');
      card.on('change', e => { msg2.textContent = e.error ? e.error.message : ''; });
    }

    quoteBtn.addEventListener('click', async () => {
      const f = collect();
      msg1.textContent = ''; msg1.className = 'hb-msg';
      if (!f.customer.first || !f.customer.email || !f.address.line1 || !f.address.city || !f.address.postcode) {
        msg1.textContent = 'Please fill in your name, email and full address first.'; msg1.className = 'hb-msg err'; return;
      }
      quoteBtn.disabled = true; quoteBtn.textContent = 'Calculating…';
      // WHY: a failed quote must leave the button usable, so restore in finally.
      try {
        const q = await post('/quote', { cart, currency, address: f.address });
        quote = q;
        totals.innerHTML = q.items.map(i => `<div class="line"><span>${esc(i.title)} × ${i.qty}</span><span>${HB.money(i.line_cents, q.currency)}</span></div>`).join('') +
          `<div class="line"><span>Shipping (${q.shipping_level === 'MAIL' ? 'standard mail' : esc(q.shipping_level.toLowerCase())}${q.shipping_estimated ? ', estimated' : ''})</span><span>${HB.money(q.shipping_cents, q.currency)}</span></div>
           ${q.tax_cents ? `<div class="line"><span>Texas sales tax (${(q.tax_rate * 100).toFixed(2)}%)</span><span>${HB.money(q.tax_cents, q.currency)}</span></div>` : ''}
           ${q.vat_cents ? `<div class="line"><span>VAT / GST for your country</span><span>${HB.money(q.vat_cents, q.currency)}</span></div>` : ''}
           <div class="line total"><span>Total</span><span data-total>${HB.money(q.total_cents, q.currency)}</span></div>`;
        drawCart(); ensureCard();
        payBox.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } catch (e) {
        msg1.textContent = e.message; msg1.className = 'hb-msg err';
      } finally {
        quoteBtn.disabled = false;
        quoteBtn.textContent = quote ? 'Recalculate Shipping' : 'Calculate Shipping & Total →';
      }
    });

    const tipCents = () => Math.max(0, Math.round((parseFloat(tipIn.value) || 0) * 100));
    tipIn.addEventListener('input', () => {
      if (quote) $('[data-total]', totals).textContent = HB.money(quote.total_cents + tipCents(), quote.currency);
    });

    payBtn.addEventListener('click', async () => {
      if (!quote) return;
      const f = collect();
      msg2.textContent = ''; payBtn.disabled = true; payBtn.textContent = 'Processing…';
      // WHY: any failure (decline, network, worker) re-enables the button with a clear message.
      try {
        const pi = await post('/create-payment-intent', { cart, currency, address: f.address, customer: f.customer, tip_cents: tipCents() });
        const r = await stripe.confirmCardPayment(pi.client_secret, {
          payment_method: { card, billing_details: { name: f.customer.first + ' ' + f.customer.last, email: f.customer.email, phone: f.customer.phone } },
        });
        if (r.error) throw new Error(r.error.message);
        await post('/submit-order', { payment_intent_id: r.paymentIntent.id });

        $('[data-donemsg]', el).innerHTML = `Thank you, ${esc(f.customer.first)}. Your payment of <strong>${HB.money(pi.amount_cents, pi.currency)}</strong> was received.<br>
          A confirmation is on its way to <strong>${esc(f.customer.email)}</strong>, and we'll email again when your books ship.`;
        $('.hb-form', el).style.display = 'none';
        $('.hb-done', el).classList.add('show');
        cart = {}; changed();
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } catch (e) {
        msg2.textContent = e.message + ' If you were charged, email SarahParsons@IQProductionz.com.';
        payBtn.disabled = false; payBtn.textContent = 'Complete Order & Pay';
      }
    });
  }

  // ── BOOT ────────────────────────────────────────────────────────────────────
  function boot() {
    // WHY: ?add=<id> lets any page/email link straight into a pre-filled cart.
    const add = new URLSearchParams(location.search).get('add');
    if (add && BOOKS[add] && !cart[add]) { cart[add] = 1; store.set('hb_cart', cart); }

    $$('[data-hb-row]').forEach(mountRow);
    $$('[data-hb-product]').forEach(mountProduct);
    $$('[data-hb-checkout]').forEach(mountCheckout);
    $$('[data-hb-cartbar]').forEach(mountCartBar);
    $$('[data-hb-currency]').forEach(s => { if (!s.classList.contains('hb-cur')) mountCurrency(s); });
    $$('[data-hb-cartlink]').forEach(mountCartLink);

    // WHY: keep tabs in sync — adding a book in one tab updates the cart in another.
    window.addEventListener('storage', e => {
      if (e.key === 'hb_cart' || e.key === 'hb_currency') {
        cart = sanitize(store.get('hb_cart', {})); currency = store.get('hb_currency', currency);
        quote = null; listeners.forEach(fn => fn());
      }
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
