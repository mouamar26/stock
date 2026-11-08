(function () {
'use strict';
var CUR = 'N-UM';
var VERSION = '1.0.0';

/* ============ helpers ============ */
var $ = function (s, r) { return (r || document).querySelector(s); };
var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
var digits = function (s) { return String(s).replace(/[٠-٩]/g, function (d) { return '٠١٢٣٤٥٦٧٨٩'.indexOf(d); }).replace(/[۰-۹]/g, function (d) { return '۰۱۲۳۴۵۶۷۸۹'.indexOf(d); }); };
var norm = function (s) { return digits(String(s == null ? '' : s)).toLowerCase().normalize('NFD').replace(/[̀-ًͯ-ٰٟـ]/g, '').replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/\s+/g, ' ').trim(); };
var parseNum = function (s) { var t = digits(s == null ? '' : s).replace(/[٫,]/g, '.').replace(/[\s  ]/g, ''); if (t === '') return NaN; var n = Number(t); return isFinite(n) ? n : NaN; };
var r2 = function (n) { return Math.round(n * 100) / 100; };
var fmt = function (n) { return r2(n || 0).toLocaleString('en-US').replace(/,/g, ' '); };
var pad = function (n, w) { return String(n).padStart(w || 2, '0'); };
var dayKey = function (t) { var d = new Date(t); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
var timeStr = function (t) { var d = new Date(t); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
var uid = function () { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); };
var money = function (n) { return '<bdi class="m">' + fmt(n) + '<span class="cur">' + CUR + '</span></bdi>'; };
var moneyT = function (n) { return fmt(n) + ' ' + CUR; };

/* ============ i18n ============ */
var LANG = 'ar';
function t(key, p) {
  var d = window.I18N[LANG] || {}, s = d[key];
  if (s == null) s = window.I18N.ar[key];
  if (s == null) return key;
  if (p) for (var k in p) s = s.split('{' + k + '}').join(p[k]);
  return s;
}
function dateLabel(key) {
  var a = key.split('-').map(Number), d = new Date(a[0], a[1] - 1, a[2]), base = key;
  try { base = new Intl.DateTimeFormat(LANG === 'fr' ? 'fr' : 'ar-u-nu-latn', { weekday: 'long', day: 'numeric', month: 'long' }).format(d); } catch (e) {}
  if (key === dayKey(Date.now())) return t('today') + ' · ' + base;
  if (key === dayKey(Date.now() - 864e5)) return t('yesterday') + ' · ' + base;
  return base + (a[0] !== new Date().getFullYear() ? ' ' + a[0] : '');
}

/* ============ state ============ */
var STORES = ['parts', 'names', 'vehicles', 'suppliers', 'moves', 'sales', 'settings'];
var S = { parts: new Map(), names: new Map(), vehicles: new Map(), suppliers: new Map(), sales: new Map(), moves: [], settings: { id: 'main' }, qty: new Map(), last: new Map(), cart: [] };
var ui = { tab: 'stock', q: '', filter: 'all', veh: '', sort: 'name', mf: 'all' };
var IDB = null, DBOK = false, deferredInstall = null;

/* ============ storage (IndexedDB) ============ */
function openDB() {
  return new Promise(function (res, rej) {
    if (!window.indexedDB) return rej(new Error('no idb'));
    var r = indexedDB.open('partstock', 1);
    r.onupgradeneeded = function () { STORES.forEach(function (s) { if (!r.result.objectStoreNames.contains(s)) r.result.createObjectStore(s, { keyPath: 'id' }); }); };
    r.onsuccess = function () { res(r.result); };
    r.onerror = function () { rej(r.error); };
  });
}
function getAll(store) {
  return new Promise(function (res, rej) { var q = IDB.transaction(store).objectStore(store).getAll(); q.onsuccess = function () { res(q.result); }; q.onerror = function () { rej(q.error); }; });
}
function tx(ops) {
  if (!DBOK || !ops.length) return Promise.resolve();
  return new Promise(function (res, rej) {
    var names = []; ops.forEach(function (o) { if (names.indexOf(o[0]) < 0) names.push(o[0]); });
    var x = IDB.transaction(names, 'readwrite');
    ops.forEach(function (o) { var st = x.objectStore(o[0]); if (o[1] === 'put') st.put(o[2]); else if (o[1] === 'del') st.delete(o[2]); else if (o[1] === 'clear') st.clear(); });
    x.oncomplete = function () { res(); };
    x.onerror = x.onabort = function () { rej(x.error); };
  });
}
function persist(ops) { return tx(ops).catch(function (e) { try { console.error(e); } catch (x) {} toast(t('err_save')); }); }

function applyMove(m) {
  S.qty.set(m.partId, r2((S.qty.get(m.partId) || 0) + m.delta));
  if (m.kind === 'sale') { var l = S.last.get(m.partId); if (!l || m.t >= l.t) S.last.set(m.partId, { price: m.price, t: m.t }); }
}
function rebuild() {
  S.qty = new Map(); S.last = new Map();
  S.moves.sort(function (a, b) { return a.t - b.t; });
  S.moves.forEach(applyMove);
}
function loadState(data) {
  S.parts = new Map((data.parts || []).map(function (x) { return [x.id, x]; }));
  S.names = new Map((data.names || []).map(function (x) { return [x.id, x]; }));
  S.vehicles = new Map((data.vehicles || []).map(function (x) { return [x.id, x]; }));
  S.suppliers = new Map((data.suppliers || []).map(function (x) { return [x.id, x]; }));
  S.sales = new Map((data.sales || []).map(function (x) { return [x.id, x]; }));
  S.moves = (data.moves || []).slice();
  var st = (data.settings || []).filter(function (x) { return x.id === 'main'; })[0];
  S.settings = st || { id: 'main' };
  rebuild();
}
function snapshot() {
  return { parts: [...S.parts.values()], names: [...S.names.values()], vehicles: [...S.vehicles.values()], suppliers: [...S.suppliers.values()], sales: [...S.sales.values()], moves: S.moves.slice(), settings: [S.settings] };
}

/* ============ model ============ */
var qtyOf = function (id) { return S.qty.get(id) || 0; };
var liveParts = function () { return [...S.parts.values()].filter(function (p) { return !p.deleted; }); };
var nameOf = function (p) { var n = S.names.get(p.nameId); return n ? n.name : '—'; };
var vehOf = function (p) { return (p.vehicleIds || []).map(function (id) { var v = S.vehicles.get(id); return v ? v.name : ''; }).filter(Boolean); };
var supOf = function (p) { var s = S.suppliers.get(p.supplierId); return s ? s.name : ''; };
var sep = function () { return LANG === 'fr' ? ', ' : '، '; };
function stateOf(p) { var q = qtyOf(p.id); if (q <= 0) return 'out'; if ((p.min || 0) > 0 && q <= p.min) return 'low'; return 'ok'; }
var needQty = function (p) { return Math.max(r2((p.min || 0) * 2 - qtyOf(p.id)), 1); };
function mkMove(partId, kind, delta, x) { return Object.assign({ id: uid(), t: Date.now(), kind: kind, partId: partId, delta: delta, price: 0, cost: 0, saleId: '', note: '', label: '' }, x || {}); }
function addMoves(ms) { ms.forEach(function (m) { S.moves.push(m); applyMove(m); }); }
function settingsPut() { return ['settings', 'put', S.settings]; }

function createPart(d, qty) {
  var now = Date.now(), p = Object.assign({ id: uid(), createdAt: now, updatedAt: now }, d);
  S.parts.set(p.id, p);
  var ops = [['parts', 'put', p]];
  if (qty > 0) { var m = mkMove(p.id, 'init', qty, { cost: p.buy, label: nameOf(p) }); addMoves([m]); ops.push(['moves', 'put', m]); }
  return persist(ops);
}
function restock(id, qty, buy, note) {
  var p = S.parts.get(id), ops = [];
  if (buy > 0 && buy !== p.buy) { p.buy = buy; }
  p.updatedAt = Date.now(); ops.push(['parts', 'put', p]);
  var m = mkMove(id, 'in', qty, { cost: p.buy, price: p.buy, note: note || '', label: nameOf(p) });
  addMoves([m]); ops.push(['moves', 'put', m]);
  return persist(ops);
}
function updatePart(id, d, qty) {
  var p = S.parts.get(id), old = qtyOf(id), ops = [];
  Object.assign(p, d, { updatedAt: Date.now() }); ops.push(['parts', 'put', p]);
  var delta = r2(qty - old);
  if (delta !== 0) { var m = mkMove(id, 'adj', delta, { note: t('adj_note'), label: nameOf(p) }); addMoves([m]); ops.push(['moves', 'put', m]); }
  return persist(ops);
}
function deletePart(id) { var p = S.parts.get(id); p.deleted = true; p.updatedAt = Date.now(); return persist([['parts', 'put', p]]); }
function nextNo() { var mx = 0; S.sales.forEach(function (s) { if (s.no > mx) mx = s.no; }); return mx + 1; }
function sell(lines, customer) {
  var id = uid(), now = Date.now(), items = [], total = 0, ms = [];
  lines.forEach(function (l) {
    var p = S.parts.get(l.partId), label = nameOf(p);
    items.push({ partId: p.id, label: label, code: p.code || '', qty: l.qty, price: l.price, cost: p.buy || 0 });
    total += l.qty * l.price;
    ms.push(mkMove(p.id, 'sale', -l.qty, { t: now, price: l.price, cost: p.buy || 0, saleId: id, label: label }));
  });
  var sale = { id: id, no: nextNo(), t: now, customer: customer || '', items: items, total: r2(total), returned: false };
  S.sales.set(id, sale); addMoves(ms);
  var ops = [['sales', 'put', sale]]; ms.forEach(function (m) { ops.push(['moves', 'put', m]); });
  return persist(ops).then(function () { return sale; });
}
function returnSale(id) {
  var sale = S.sales.get(id); if (!sale || sale.returned) return Promise.resolve();
  sale.returned = true; var ops = [['sales', 'put', sale]], ms = [];
  sale.items.forEach(function (it) { ms.push(mkMove(it.partId, 'ret', it.qty, { price: it.price, cost: it.cost, saleId: id, label: it.label })); });
  addMoves(ms); ms.forEach(function (m) { ops.push(['moves', 'put', m]); });
  return persist(ops);
}
function listAdd(store, name, extra) {
  name = String(name || '').trim(); if (!name) return null;
  var found = null, nn = norm(name);
  S[store].forEach(function (x) { if (norm(x.name) === nn) found = x; });
  if (found) return found;
  var it = Object.assign({ id: uid(), name: name }, extra || {});
  S[store].set(it.id, it); persist([[store, 'put', it]]);
  return it;
}
function usageCount(store, id) {
  var key = store === 'names' ? 'nameId' : store === 'suppliers' ? 'supplierId' : 'vehicleIds', n = 0;
  liveParts().forEach(function (p) { if (key === 'vehicleIds' ? (p.vehicleIds || []).indexOf(id) >= 0 : p[key] === id) n++; });
  return n;
}

/* ============ rendering ============ */
function setTexts() {
  document.documentElement.lang = LANG; document.documentElement.dir = LANG === 'fr' ? 'ltr' : 'rtl';
  document.title = t('app_title');
  $('#syncTxt').textContent = t('sync_local');
  $('#langBtn').textContent = t('lang_other');
  ['stock', 'sell', 'moves', 'more'].forEach(function (k) { $('#l-' + k).textContent = t('tab_' + k); });
  $('#q').placeholder = t('search_ph');
  $('#addBtn').textContent = '+ ' + t('new_part'); $('#fab').textContent = '+ ' + t('new_part');
  $('#sortSel').innerHTML = ['name', 'loc', 'qty'].map(function (k) { return '<option value="' + k + '">' + esc(t('sort_' + k)) + '</option>'; }).join('');
  $('#sortSel').value = ui.sort;
}
function renderAll() {
  var shop = (S.settings.shop || '').trim();
  $('#shopTitle').textContent = shop || t('app_title');
  $('#shopSub').textContent = shop ? t('app_title') : t('app_sub');
  ['stock', 'sell', 'moves', 'more'].forEach(function (k) {
    $('#n-' + k).setAttribute('aria-selected', k === ui.tab ? 'true' : 'false');
    $('#p-' + k).hidden = k !== ui.tab;
  });
  var cb = $('#cartBadge'); cb.hidden = !S.cart.length; cb.textContent = S.cart.length;
  $('#fab').hidden = ui.tab !== 'stock';
  renderBanner();
  if (ui.tab === 'stock') renderStock(); else if (ui.tab === 'sell') renderSell(); else if (ui.tab === 'moves') renderMoves(); else renderMore();
}
function renderBanner() {
  var h = '';
  if (!DBOK) h += '<div class="banner bad"><p>' + esc(t('storage_fail')) + '</p></div>';
  if (liveParts().length || S.sales.size) {
    var lb = S.settings.lastBackup, days = lb ? Math.floor((Date.now() - lb) / 864e5) : null;
    if (lb == null || days >= 7) h += '<div class="banner"><p>' + esc(lb == null ? t('bk_warn_never') : t('bk_warn', { n: days })) + '</p><button class="btn sm" type="button" data-action="backup-now">' + esc(t('bk_now')) + '</button></div>';
  }
  $('#banner').innerHTML = h;
}

function summary() {
  var units = 0, value = 0, low = 0, out = 0, n = 0;
  liveParts().forEach(function (p) { var q = qtyOf(p.id); n++; if (q > 0) { units += q; value += q * (p.buy || 0); } var st = stateOf(p); if (st === 'out') out++; else if (st === 'low') low++; });
  var sales = 0, profit = 0, cnt = 0, today = dayKey(Date.now());
  S.sales.forEach(function (s) { if (!s.returned && dayKey(s.t) === today) { cnt++; s.items.forEach(function (it) { sales += it.qty * it.price; profit += (it.price - it.cost) * it.qty; }); } });
  return { n: n, units: units, value: value, low: low, out: out, sales: sales, profit: profit, cnt: cnt };
}
function renderStats() {
  var s = summary();
  var cell = function (l, v, sub, cls) { return '<div class="stat ' + (cls || '') + '"><span>' + esc(l) + '</span><b>' + v + '</b><em>' + sub + '</em></div>'; };
  $('#stats').innerHTML =
    cell(t('stat_parts'), fmt(s.n), esc(t('stat_units', { n: fmt(s.units) }))) +
    cell(t('stat_value'), money(s.value), esc(t('stat_value_sub'))) +
    cell(t('stat_need'), fmt(s.low + s.out), esc(s.out ? t('stat_out_sub', { n: fmt(s.out) }) : t('stat_none_out')), (s.low + s.out) ? 'warn' : '') +
    cell(t('stat_today'), money(s.sales), esc(t('stat_today_sub', { n: fmt(s.cnt), p: moneyT(s.profit) })));
}
var STATE_KEY = { ok: 'st_ok', low: 'st_low', out: 'st_out' };
function locTags(p) {
  var a = [];
  if (p.shelf) a.push('<span class="bin"><i>' + esc(t('shelf')) + '</i><b>' + esc(p.shelf) + '</b></span>');
  if (p.win) a.push('<span class="bin"><i>' + esc(t('window')) + '</i><b>' + esc(p.win) + '</b></span>');
  return a.length ? a.join('') : '<span class="bin none">' + esc(t('no_shelf')) + '</span>';
}
var IC_BOX = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M3.5 8L12 4l8.5 4v8L12 20l-8.5-4z"/><path d="M3.5 8L12 12l8.5-4M12 12v8"/></svg>';
var IC_EDIT = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>';
function thumb(p, big) {
  return p.photo ? '<div class="thumb' + (big ? ' lg' : '') + '" style="background-image:url(' + p.photo + ')"></div>' : '<div class="thumb' + (big ? ' lg' : '') + '">' + IC_BOX + '</div>';
}
function partRow(p) {
  var st = stateOf(p), q = qtyOf(p.id), sup = supOf(p);
  var meta = (p.code ? '<span class="code">' + esc(p.code) + '</span>' : '') + (vehOf(p).length ? '<span>' + esc(vehOf(p).join(sep())) + '</span>' : '');
  var sub = esc(t('buy_lbl')) + ' ' + money(p.buy || 0) + (sup ? '<br>' + esc(sup) : '');
  return '<article class="part" data-state="' + st + '">' +
    '<div class="p-main">' + thumb(p) + '<div><h3>' + esc(nameOf(p)) + '</h3>' + (meta ? '<p class="meta">' + meta + '</p>' : '') + '</div></div>' +
    '<div class="p-loc">' + locTags(p) + '</div>' +
    '<div class="p-qty"><span class="num">' + fmt(q) + '</span><span class="pill ' + st + '">' + esc(t(STATE_KEY[st])) + '</span></div>' +
    '<div class="p-price"><small>' + sub + '</small></div>' +
    '<div class="p-act"><button class="btn primary" type="button" data-action="to-cart" data-id="' + esc(p.id) + '"' + (st === 'out' ? ' disabled' : '') + '>' + esc(t('add_cart')) + '</button><button class="btn" type="button" data-action="restock" data-id="' + esc(p.id) + '">' + esc(t('restock')) + '</button><button class="btn sq" type="button" data-action="edit-part" data-id="' + esc(p.id) + '" aria-label="' + esc(t('edit')) + '">' + IC_EDIT + '</button></div></article>';
}
function haystack(p) {
  return norm([nameOf(p), p.code, vehOf(p).join(' '), supOf(p), p.shelf, p.win, p.shelf ? 'رف etagere shelf ' + p.shelf : '', p.win ? 'نافذة case ' + p.win : '', p.note].join(' '));
}
function renderStock() {
  renderStats();
  var all = liveParts();
  var vs = [...S.vehicles.values()].filter(function (v) { return usageCount('vehicles', v.id) > 0; }).sort(function (a, b) { return a.name.localeCompare(b.name, LANG); });
  if (ui.veh && !S.vehicles.has(ui.veh)) ui.veh = '';
  $('#vehSel').innerHTML = '<option value="">' + esc(t('all_vehicles')) + '</option>' + vs.map(function (v) { return '<option value="' + esc(v.id) + '"' + (v.id === ui.veh ? ' selected' : '') + '>' + esc(v.name) + '</option>'; }).join('');
  var terms = norm(ui.q).split(' ').filter(Boolean);
  var base = all.filter(function (p) {
    if (ui.veh && (p.vehicleIds || []).indexOf(ui.veh) < 0) return false;
    if (!terms.length) return true;
    var h = haystack(p); return terms.every(function (x) { return h.indexOf(x) >= 0; });
  });
  var cnt = { all: base.length, low: 0, out: 0 };
  base.forEach(function (p) { var s = stateOf(p); if (s === 'low') cnt.low++; if (s === 'out') cnt.out++; });
  $('#chips').innerHTML = [['all', 'f_all'], ['low', 'f_low'], ['out', 'f_out']].map(function (a) { return '<button class="chip" type="button" data-action="chip" data-f="' + a[0] + '" aria-pressed="' + (ui.filter === a[0]) + '">' + esc(t(a[1])) + ' <b>' + fmt(cnt[a[0]]) + '</b></button>'; }).join('');
  if (ui.filter !== 'all') base = base.filter(function (p) { return stateOf(p) === ui.filter; });
  var cmp = function (a, b) { return String(a || '￿').localeCompare(String(b || '￿'), LANG, { numeric: true }); };
  if (ui.sort === 'name') base.sort(function (a, b) { return cmp(nameOf(a), nameOf(b)); });
  else if (ui.sort === 'loc') base.sort(function (a, b) { return cmp(a.shelf, b.shelf) || cmp(a.win, b.win) || cmp(nameOf(a), nameOf(b)); });
  else base.sort(function (a, b) { return qtyOf(a.id) - qtyOf(b.id) || cmp(nameOf(a), nameOf(b)); });
  var L = $('#partList');
  if (!all.length) { L.innerHTML = '<div class="empty"><b>' + esc(t('empty_parts_title')) + '</b><p>' + esc(t('empty_parts_text')) + '</p><button class="btn primary" type="button" data-action="add-part">' + esc(t('new_part')) + '</button></div>'; return; }
  if (!base.length) { L.innerHTML = '<div class="empty"><b>' + esc(t('no_result')) + '</b><p>' + esc(t('no_result_text')) + '</p></div>'; return; }
  L.innerHTML = base.map(partRow).join('');
}

/* ----- cart / sell ----- */
function saveCart() { try { localStorage.setItem('ps_cart', JSON.stringify(S.cart)); } catch (e) {} }
function loadCart() { try { S.cart = (JSON.parse(localStorage.getItem('ps_cart') || '[]') || []).filter(function (l) { var p = S.parts.get(l.partId); return p && !p.deleted; }); } catch (e) { S.cart = []; } }
function addToCart(id) {
  var p = S.parts.get(id); if (!p) return;
  if (qtyOf(id) <= 0) { toast(t('toast_no_stock')); return; }
  var line = S.cart.filter(function (l) { return l.partId === id; })[0];
  if (line) line.qty = Math.min(qtyOf(id), (parseNum(line.qty) || 0) + 1); else S.cart.push({ partId: id, qty: '1', price: '' });
  saveCart(); toast(t('toast_in_cart', { x: nameOf(p) })); renderAll();
}
function lineInfo(l) {
  var p = S.parts.get(l.partId), q = parseNum(l.qty), pr = parseNum(l.price), av = qtyOf(l.partId);
  return { p: p, q: q, pr: pr, av: av, qBad: !(q > 0) || q > av, prEmpty: String(l.price).trim() === '', prBad: !(pr >= 0), below: pr >= 0 && p && pr < (p.buy || 0) };
}
function renderSell() {
  var el = $('#p-sell'), h = '<div class="sec-title"><h2 style="margin:0;font-size:20px">' + esc(t('cart_title')) + '</h2></div>';
  if (!S.cart.length) {
    h += '<div class="empty"><b>' + esc(t('cart_empty')) + '</b><p>' + esc(t('cart_empty_text')) + '</p><button class="btn primary" type="button" data-action="picker">' + esc(t('cart_add')) + '</button></div>';
    el.innerHTML = h; return;
  }
  var total = 0;
  S.cart.forEach(function (l, i) {
    var f = lineInfo(l), p = f.p, last = S.last.get(p.id);
    if (f.q > 0 && f.pr >= 0) total += f.q * f.pr;
    var hint = last ? t('line_hint', { l: moneyT(last.price), b: moneyT(p.buy || 0) }) : t('hint_buy_only', { b: moneyT(p.buy || 0) });
    h += '<div class="cart-line" data-i="' + i + '">' +
      '<div class="cl-head"><div><h3>' + esc(nameOf(p)) + '</h3><p class="meta">' + (p.code ? '<span class="code">' + esc(p.code) + '</span>' : '') + '<span>' + esc(vehOf(p).join(sep())) + '</span><span>' + esc(t('line_avail', { q: fmt(f.av) })) + '</span></p></div><button class="btn sm" type="button" data-action="cart-remove" data-i="' + i + '">' + esc(t('remove')) + '</button></div>' +
      '<div class="p-loc">' + locTags(p) + '</div>' +
      '<div class="cl-grid"><div class="field"><label for="cq' + i + '">' + esc(t('f_qty')) + '</label><div class="stepper"><button class="btn" type="button" data-action="cart-step" data-i="' + i + '" data-d="-1" aria-label="−">−</button><input id="cq' + i + '" data-cart="qty" data-i="' + i + '" inputmode="decimal" value="' + esc(l.qty) + '"><button class="btn" type="button" data-action="cart-step" data-i="' + i + '" data-d="1" aria-label="+">+</button></div></div>' +
      '<div class="field price-in"><label for="cp' + i + '">' + esc(t('line_price')) + ' <small>(' + CUR + ')</small></label><input id="cp' + i + '" data-cart="price" data-i="' + i + '" inputmode="decimal" autocomplete="off" value="' + esc(l.price) + '"></div></div>' +
      '<p class="hint">' + esc(hint) + (last && String(l.price).trim() === '' ? ' <button class="link" type="button" data-action="cart-last" data-i="' + i + '">' + esc(t('use_last', { l: fmt(last.price) })) + '</button>' : '') + '</p>' +
      '<div data-line-msg="' + i + '">' + lineMsg(f) + '</div></div>';
  });
  h += '<div><button class="btn" type="button" data-action="picker">' + esc(t('cart_add')) + '</button></div>' +
    '<div class="field"><label for="cust">' + esc(t('customer')) + '</label><input id="cust" autocomplete="off" value="' + esc(S.customer || '') + '"></div>' +
    '<div class="total"><span>' + esc(t('total')) + '</span><b id="cartTotal">' + money(total) + '</b></div>' +
    '<div id="cartErr" class="err" role="alert"></div>' +
    '<div class="actions"><button class="btn primary" type="button" data-action="confirm-sale">' + esc(t('confirm_sale')) + '</button><button class="btn" type="button" data-action="cart-clear">' + esc(t('clear_cart')) + '</button></div>';
  el.innerHTML = h;
}
function lineMsg(f) {
  var o = '';
  if (f.below && !f.qBad) o += '<div class="warnline">' + esc(t('warn_below', { b: moneyT(f.p.buy || 0) })) + '</div>';
  return o;
}
function refreshCartTotals() {
  var total = 0;
  S.cart.forEach(function (l, i) {
    var f = lineInfo(l); if (f.q > 0 && f.pr >= 0) total += f.q * f.pr;
    var m = $('[data-line-msg="' + i + '"]'); if (m) m.innerHTML = lineMsg(f);
  });
  var tt = $('#cartTotal'); if (tt) tt.innerHTML = money(total);
}
function confirmSale() {
  var err = '', lines = [], bad = {};
  S.cart.forEach(function (l, i) {
    var f = lineInfo(l);
    if (!(f.q > 0)) { err = err || t('err_line_qty'); bad[i] = 1; }
    else if (f.q > f.av) { err = err || t('err_stock', { x: nameOf(f.p), q: fmt(f.av) }); bad[i] = 1; }
    else if (f.prEmpty || f.prBad) { err = err || t('err_price'); bad[i] = 1; }
    else lines.push({ partId: l.partId, qty: r2(f.q), price: r2(f.pr) });
  });
  document.querySelectorAll('.cart-line').forEach(function (el) { el.classList.toggle('bad', !!bad[el.dataset.i]); });
  if (err) { $('#cartErr').textContent = err; return; }
  var cust = (S.customer || '').trim();
  sell(lines, cust).then(function (sale) {
    S.cart = []; S.customer = ''; saveCart();
    toast(t('toast_sold', { x: moneyT(sale.total) })); renderAll(); openInvoice(sale.id);
  });
}

/* ----- moves ----- */
function renderMoves() {
  var el = $('#p-moves');
  var F = [['all', 'mv_all'], ['sale', 'mv_sales'], ['in', 'mv_in'], ['other', 'mv_other']];
  var h = '<div class="chips">' + F.map(function (a) { return '<button class="chip" type="button" data-action="mchip" data-f="' + a[0] + '" aria-pressed="' + (ui.mf === a[0]) + '">' + esc(t(a[1])) + '</button>'; }).join('') + '</div>';
  var entries = [];
  S.sales.forEach(function (s) { entries.push({ t: s.t, sale: s }); });
  S.moves.forEach(function (m) { if (!m.saleId) entries.push({ t: m.t, m: m }); });
  entries.sort(function (a, b) { return b.t - a.t; });
  var pass = function (e) { var k = e.sale ? 'sale' : e.m.kind; return ui.mf === 'all' || (ui.mf === 'sale' && k === 'sale') || (ui.mf === 'in' && k === 'in') || (ui.mf === 'other' && k !== 'sale' && k !== 'in'); };
  entries = entries.filter(pass).slice(0, 400);
  if (!entries.length) { el.innerHTML = h + '<div class="empty"><b>' + esc(t('mv_empty')) + '</b><p>' + esc(t('mv_empty_text')) + '</p></div>'; return; }
  var cur = '', daySales = {}, dayProfit = {}, dayCount = {};
  S.sales.forEach(function (s) { var d = dayKey(s.t); dayCount[d] = (dayCount[d] || 0) + 1; if (!s.returned) { s.items.forEach(function (it) { daySales[d] = (daySales[d] || 0) + it.qty * it.price; dayProfit[d] = (dayProfit[d] || 0) + (it.price - it.cost) * it.qty; }); } });
  entries.forEach(function (e) {
    var d = dayKey(e.t);
    if (d !== cur) { if (cur) h += '</div>'; cur = d; h += '<div class="day"><div class="day-h"><h3>' + esc(dateLabel(d)) + '</h3><span>' + (daySales[d] ? esc(t('day_sales', { s: moneyT(daySales[d]), p: moneyT(dayProfit[d] || 0) })) : '') + '</span></div>'; }
    if (e.sale) {
      var s = e.sale, names = s.items.map(function (it) { return it.label + ' × ' + fmt(it.qty); }).join(sep());
      h += '<div class="mv' + (s.returned ? ' returned' : '') + '"><span class="t">' + timeStr(s.t) + '</span><span class="kind"><span class="pill sale">' + esc(t('k_sale')) + '</span></span>' +
        '<div class="main"><b>' + esc(t('invoice_short', { n: pad(s.no, 4) })) + (s.customer ? ' · ' + esc(s.customer) : '') + '</b><small>' + esc(names) + '</small></div><div class="amt">' + money(s.total) + '</div>' +
        '<div class="act"><button class="btn sm" type="button" data-action="open-invoice" data-id="' + esc(s.id) + '">' + esc(t('mv_open')) + '</button>' + (s.returned ? '<span class="pill adj">' + esc(t('k_returned')) + '</span>' : '<button class="btn sm danger" type="button" data-action="return-sale" data-id="' + esc(s.id) + '">' + esc(t('mv_return')) + '</button>') + '</div></div>';
    } else {
      var m = e.m, sign = m.delta < 0 ? '−' : '+';
      h += '<div class="mv"><span class="t">' + timeStr(m.t) + '</span><span class="kind"><span class="pill ' + m.kind + '">' + esc(t('k_' + m.kind)) + '</span></span>' +
        '<div class="main"><b>' + esc(m.label) + '</b>' + (m.note ? '<small>' + esc(m.note) + '</small>' : '') + '</div><div class="amt">' + sign + fmt(Math.abs(m.delta)) + '</div><div class="act"></div></div>';
    }
  });
  el.innerHTML = h + '</div>';
}

/* ----- more ----- */
function renderMore() {
  var item = function (a, label, c) { return '<button type="button" data-action="' + a + '"><span>' + esc(label) + '</span><span class="c">' + (c || '') + '</span></button>'; };
  var h = '<div class="menu">' +
    item('open-names', t('more_names'), esc(t('list_count', { n: fmt(S.names.size) }))) +
    item('open-vehicles', t('more_vehicles'), esc(t('list_count', { n: fmt(S.vehicles.size) }))) +
    item('open-suppliers', t('more_suppliers'), esc(t('list_count', { n: fmt(S.suppliers.size) }))) +
    item('open-backup', t('more_backup'), '') + item('open-settings', t('more_settings'), esc(t('lang_name'))) +
    (deferredInstall ? item('install', t('more_install'), '') : '') + '</div>' +
    '<p class="verline">' + esc(t('more_version')) + ' · v' + VERSION + '</p>';
  $('#p-more').innerHTML = h;
}

/* ============ sheets ============ */
var sheetSubmit = null, lastFocus = null, F = null;
function openSheet(title, html, onSubmit, focusSel) {
  lastFocus = document.activeElement;
  $('#sheetTitle').textContent = title; $('#sheetBody').innerHTML = html; sheetSubmit = onSubmit;
  $('#overlay').hidden = false; document.body.classList.add('lock');
  var f = focusSel && $(focusSel); if (f) { try { f.focus(); } catch (e) {} }
}
function closeSheet() {
  $('#overlay').hidden = true; document.body.classList.remove('lock'); $('#sheetBody').innerHTML = ''; sheetSubmit = null; F = null;
  if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch (e) {} }
}
var setErr = function (m) { var e = $('#f-err'); if (e) e.textContent = m || ''; };
var val = function (id) { var e = $('#f-' + id); return e ? e.value.trim() : ''; };

/* ----- combo (autocomplete over a managed list) ----- */
function comboMatches(store, q) {
  var nq = norm(q), starts = [], has = [];
  S[store].forEach(function (x) { var n = norm(x.name); if (!nq || n.indexOf(nq) === 0) starts.push(x); else if (n.indexOf(nq) > 0) has.push(x); });
  var c = function (a, b) { return a.name.localeCompare(b.name, LANG); };
  return starts.sort(c).concat(has.sort(c)).slice(0, 8);
}
function hl(name, q) { var l = name.toLowerCase(), qq = q.trim().toLowerCase(); if (qq && l.indexOf(qq) === 0) return '<mark>' + esc(name.slice(0, qq.length)) + '</mark>' + esc(name.slice(qq.length)); return esc(name); }
function renderCombo(field) {
  var cfg = { name: 'names', vehicle: 'vehicles', supplier: 'suppliers' }[field], input = $('#f-' + field), dd = $('#dd-' + field);
  if (!input || !dd) return;
  var q = input.value, items = comboMatches(cfg, q), exact = false, nq = norm(q);
  S[cfg].forEach(function (x) { if (norm(x.name) === nq) exact = true; });
  var h = items.map(function (x) { return '<button type="button" class="dr" data-action="pick" data-field="' + field + '" data-id="' + esc(x.id) + '">' + hl(x.name, q) + '</button>'; }).join('');
  if (q.trim() && !exact) h += '<button type="button" class="dr add" data-action="pick-new" data-field="' + field + '">' + esc(t('combo_add', { x: q.trim() })) + '</button>';
  dd.innerHTML = h; dd.hidden = !h;
}
function chooseFromCombo(field, id) {
  var cfg = { name: 'names', vehicle: 'vehicles', supplier: 'suppliers' }[field], item = S[cfg].get(id);
  if (!item) return;
  if (field === 'vehicle') { if (F.vehicleIds.indexOf(id) < 0) F.vehicleIds.push(id); $('#f-vehicle').value = ''; renderVehChips(); }
  else { F[field === 'name' ? 'nameId' : 'supplierId'] = id; $('#f-' + field).value = item.name; }
  $('#dd-' + field).hidden = true;
}
function renderVehChips() {
  var el = $('#vehChips'); if (!el) return;
  el.innerHTML = F.vehicleIds.map(function (id) { var v = S.vehicles.get(id); return v ? '<span class="chip x">' + esc(v.name) + '<button type="button" data-action="veh-remove" data-id="' + esc(id) + '" aria-label="remove">×</button></span>' : ''; }).join('');
}
function comboBlock(field, label, req) {
  return '<div class="field"><label for="f-' + field + '">' + esc(label) + (req ? ' <em class="req">*</em>' : ' <small>(' + esc(t('opt')) + ')</small>') + '</label>' +
    (field === 'vehicle' ? '<div class="sel-chips" id="vehChips"></div>' : '') +
    '<input id="f-' + field + '" data-combo="' + field + '" autocomplete="off" enterkeyhint="done"><div class="dd" id="dd-' + field + '" hidden></div></div>';
}

/* ----- part form ----- */
function findExisting(d, excludeId) {
  var byCode = null, byKey = null;
  liveParts().forEach(function (p) {
    if (p.id === excludeId) return;
    if (d.code && norm(p.code) === norm(d.code)) byCode = p;
    else if (p.nameId === d.nameId && sameSet(p.vehicleIds || [], d.vehicleIds)) byKey = p;
  });
  return byCode || byKey;
}
function sameSet(a, b) { if (a.length !== b.length) return false; return a.every(function (x) { return b.indexOf(x) >= 0; }); }
function openPart(id) {
  var p = id ? S.parts.get(id) : null;
  F = { id: id || '', nameId: p ? p.nameId : '', vehicleIds: p ? (p.vehicleIds || []).slice() : [], supplierId: p ? (p.supplierId || '') : '', photo: p ? (p.photo || '') : '' };
  var v = p || {};
  var html = '<form id="sheetForm" class="form" novalidate>' +
    comboBlock('name', t('f_name'), true) +
    '<div class="grid2"><div class="field"><label for="f-code">' + esc(t('f_code')) + ' <small>(' + esc(t('opt')) + ')</small></label><input id="f-code" autocomplete="off" value="' + esc(v.code || '') + '" style="font-family:var(--f-mono)"></div>' +
    '<div class="field"><label for="f-qty">' + esc(t('f_qty')) + ' <em class="req">*</em></label><input id="f-qty" inputmode="decimal" autocomplete="off" value="' + (p ? esc(qtyOf(p.id)) : '') + '"></div>' +
    '<div class="field span2"><label for="f-buy">' + esc(t('f_buy')) + ' <small>(' + CUR + ')</small> <em class="req">*</em></label><input id="f-buy" inputmode="decimal" autocomplete="off" value="' + (p ? esc(p.buy) : '') + '"></div></div>' +
    comboBlock('vehicle', t('f_vehicle'), true) +
    '<fieldset class="loc"><legend>' + esc(t('loc_legend')) + ' (' + esc(t('opt')) + ')</legend><div class="grid2"><div class="field"><label for="f-shelf">' + esc(t('f_shelf')) + '</label><input id="f-shelf" autocomplete="off" value="' + esc(v.shelf || '') + '"></div><div class="field"><label for="f-win">' + esc(t('f_window')) + '</label><input id="f-win" autocomplete="off" value="' + esc(v.win || '') + '"></div></div></fieldset>' +
    '<div class="field"><label>' + esc(t('f_photo')) + ' <small>(' + esc(t('opt')) + ')</small></label><div class="photo-row"><div id="photoPrev"></div><div class="row"><label class="btn sm" for="f-photo" style="cursor:pointer;margin:0" id="photoBtn"></label><button type="button" class="btn sm" data-action="photo-remove" id="photoRm"></button></div><input id="f-photo" type="file" accept="image/*" hidden></div></div>' +
    comboBlock('supplier', t('f_supplier'), false) +
    '<div class="field"><label for="f-min">' + esc(t('f_min')) + ' <small>(' + esc(t('opt')) + ')</small></label><input id="f-min" inputmode="decimal" autocomplete="off" value="' + (p && p.min ? esc(p.min) : '') + '"></div>' +
    '<div class="field"><label for="f-note">' + esc(t('f_note')) + ' <small>(' + esc(t('opt')) + ')</small></label><textarea id="f-note">' + esc(v.note || '') + '</textarea></div>' +
    '<div id="mergeBox"></div><div id="f-err" class="err" role="alert"></div>' +
    '<div class="actions" id="partActions"><button class="btn primary" type="submit">' + esc(p ? t('save_changes') : t('save_part')) + '</button>' +
    (p ? '<button class="btn danger" type="button" data-action="askdel" data-id="' + esc(id) + '">' + esc(t('delete_part')) + '</button>' : '') +
    '<button class="btn" type="button" data-action="close">' + esc(t('cancel')) + '</button></div></form>';
  openSheet(p ? t('part_edit_title') : t('part_new_title'), html, submitPart, '#f-name');
  if (p) { var n = S.names.get(p.nameId); $('#f-name').value = n ? n.name : ''; var s = S.suppliers.get(p.supplierId); $('#f-supplier').value = s ? s.name : ''; }
  renderVehChips(); renderPhoto();
}
function renderPhoto() {
  var pv = $('#photoPrev'); if (!pv) return;
  pv.innerHTML = F.photo ? '<div class="thumb lg" style="background-image:url(' + F.photo + ')"></div>' : '<div class="thumb lg">' + IC_BOX + '</div>';
  $('#photoBtn').textContent = F.photo ? t('photo_change') : t('photo_add');
  $('#photoRm').textContent = t('photo_remove'); $('#photoRm').hidden = !F.photo;
}
function resizeImage(file, max) {
  return new Promise(function (res, rej) {
    var img = new Image(), url = URL.createObjectURL(file);
    img.onload = function () {
      var r = Math.min(1, max / Math.max(img.width, img.height)), c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.width * r)); c.height = Math.max(1, Math.round(img.height * r));
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url); res(c.toDataURL('image/jpeg', 0.72));
    };
    img.onerror = function () { URL.revokeObjectURL(url); rej(new Error('img')); }; img.src = url;
  });
}
function submitPart() {
  var nameTxt = val('name'), nn = norm(nameTxt);
  if (!F.nameId || !S.names.get(F.nameId) || norm(S.names.get(F.nameId).name) !== nn) {
    var hit = null; S.names.forEach(function (x) { if (norm(x.name) === nn && nn) hit = x; });
    if (hit) F.nameId = hit.id; else return setErr(t('err_pick'));
  }
  var qty = val('qty') === '' ? NaN : parseNum(val('qty'));
  if (!(qty >= 0)) return setErr(t('err_qty'));
  var buy = val('buy') === '' ? NaN : parseNum(val('buy'));
  if (!(buy >= 0)) return setErr(t('err_buy'));
  if (!F.vehicleIds.length) return setErr(t('err_vehicle'));
  var supTxt = val('supplier'), supId = '';
  if (supTxt) { var sh = null; S.suppliers.forEach(function (x) { if (norm(x.name) === norm(supTxt)) sh = x; }); if (!sh) return setErr(t('err_pick')); supId = sh.id; }
  var min = val('min') === '' ? 0 : parseNum(val('min')); if (!(min >= 0)) return setErr(t('err_num'));
  var d = { nameId: F.nameId, code: val('code'), vehicleIds: F.vehicleIds.slice(), buy: r2(buy), shelf: val('shelf'), win: val('win'), supplierId: supId, min: r2(min), note: val('note'), photo: F.photo || '' };
  var other = findExisting(d, F.id);
  if (F.id) {
    if (other && d.code && norm(other.code) === norm(d.code)) return setErr(t('err_code_used', { x: nameOf(other) }));
    var nm = nameOf(Object.assign({}, d)); updatePart(F.id, d, r2(qty)); closeSheet(); toast(t('toast_saved')); renderAll(); return;
  }
  if (other) {
    var q0 = r2(qty), nowQ = qtyOf(other.id);
    $('#mergeBox').innerHTML = '<div class="merge"><b>' + esc(t('exists_title')) + '</b><span>' + esc(t('exists_text', { x: nameOf(other), q: fmt(nowQ) })) + '</span>' +
      (q0 > 0 ? '<button class="btn primary" type="button" data-action="merge" data-id="' + esc(other.id) + '">' + esc(t('exists_add', { n: fmt(q0), m: fmt(nowQ + q0) })) + '</button>' : '<span class="hint">' + esc(t('exists_zero')) + '</span>') + '</div>';
    F.pending = { qty: q0, buy: d.buy }; setErr(''); return;
  }
  createPart(d, r2(qty)); var nmx = nameTxt; closeSheet(); toast(t('toast_part_added', { x: nmx })); renderAll();
}
function mergeInto(id) {
  var pend = F.pending, p = S.parts.get(id); if (!pend || !p) return;
  var q = pend.qty, buy = pend.buy; closeSheet();
  restock(id, q, buy, '').then(function () { toast(t('toast_added_qty', { n: fmt(q), x: nameOf(p), m: fmt(qtyOf(id)) })); renderAll(); });
}

/* ----- restock ----- */
function openRestock(id) {
  var p = S.parts.get(id); if (!p) return;
  F = { restockId: id };
  var html = '<form id="sheetForm" class="form" novalidate><div class="sheet-part"><div><b>' + esc(nameOf(p)) + '</b><div class="meta">' + (p.code ? '<span class="code">' + esc(p.code) + '</span>' : '') + '<span>' + esc(t('current_qty', { q: fmt(qtyOf(id)) })) + '</span></div></div><div class="p-loc">' + locTags(p) + '</div></div>' +
    '<div class="grid2"><div class="field"><label for="f-qty">' + esc(t('restock_qty')) + '</label><div class="stepper"><button class="btn" type="button" data-step="-1">−</button><input id="f-qty" inputmode="decimal" value="1" autocomplete="off"><button class="btn" type="button" data-step="1">+</button></div></div>' +
    '<div class="field"><label for="f-buy">' + esc(t('restock_buy')) + ' <small>(' + CUR + ')</small></label><input id="f-buy" inputmode="decimal" autocomplete="off" value="' + esc(p.buy || '') + '"></div></div>' +
    '<div class="field"><label for="f-note">' + esc(t('restock_note')) + '</label><input id="f-note" autocomplete="off"></div>' +
    '<div class="sheet-part"><span>' + esc(t('restock_cost')) + '</span><b id="f-total"></b></div>' +
    '<div id="f-err" class="err" role="alert"></div><div class="actions"><button class="btn primary" type="submit">' + esc(t('restock_btn')) + '</button><button class="btn" type="button" data-action="close">' + esc(t('cancel')) + '</button></div></form>';
  openSheet(t('restock_title'), html, function () {
    var q = parseNum(val('qty')), b = val('buy') === '' ? 0 : parseNum(val('buy'));
    if (!(q > 0)) return setErr(t('err_qty')); if (!(b >= 0)) return setErr(t('err_num'));
    var note = val('note'); closeSheet();
    restock(id, r2(q), r2(b), note).then(function () { toast(t('toast_added_qty', { n: fmt(q), x: nameOf(p), m: fmt(qtyOf(id)) })); renderAll(); });
  }, '#f-qty');
  updateTotal();
}
function updateTotal() { var el = $('#f-total'); if (!el) return; var q = parseNum(val('qty')), b = val('buy') === '' ? 0 : parseNum(val('buy')); el.textContent = (q > 0 && b >= 0 ? fmt(q * b) : '—') + ' ' + CUR; }

/* ----- picker for cart ----- */
function openPicker() {
  var html = '<div class="form"><input id="pk-q" type="search" autocomplete="off" placeholder="' + esc(t('picker_search')) + '"><div id="pk-list" class="list"></div></div>';
  openSheet(t('picker_title'), html, null, '#pk-q'); renderPicker();
}
function renderPicker() {
  var q = norm(($('#pk-q') || {}).value || ''), terms = q.split(' ').filter(Boolean);
  var arr = liveParts().filter(function (p) { if (qtyOf(p.id) <= 0) return false; var h = haystack(p); return terms.every(function (x) { return h.indexOf(x) >= 0; }); })
    .sort(function (a, b) { return nameOf(a).localeCompare(nameOf(b), LANG); }).slice(0, 40);
  $('#pk-list').innerHTML = arr.map(function (p) {
    return '<button type="button" class="part" style="width:100%;text-align:start;grid-template-columns:minmax(0,1fr) auto;grid-template-areas:\'main qty\';cursor:pointer;background:var(--surface)" data-action="pick-part" data-id="' + esc(p.id) + '"><div class="p-main">' + thumb(p) + '<div><h3>' + esc(nameOf(p)) + '</h3><p class="meta">' + (p.code ? '<span class="code">' + esc(p.code) + '</span>' : '') + '<span>' + esc(vehOf(p).join(sep())) + '</span></p></div></div><div class="p-qty" style="min-width:0"><span class="num">' + fmt(qtyOf(p.id)) + '</span></div></button>';
  }).join('') || '<div class="empty"><b>' + esc(t('no_result')) + '</b></div>';
}

/* ----- invoice ----- */
function invoiceHTML(s) {
  var rows = s.items.map(function (it) { return '<tr><td>' + esc(it.label) + (it.code ? ' <span class="code">' + esc(it.code) + '</span>' : '') + '</td><td class="n">' + fmt(it.qty) + '</td><td class="n">' + fmt(it.price) + '</td><td class="n">' + fmt(it.qty * it.price) + '</td></tr>'; }).join('');
  return '<div class="inv"><div class="h"><b>' + esc(S.settings.shop || t('app_title')) + '</b><span>' + esc(t('invoice_short', { n: pad(s.no, 4) })) + ' · ' + esc(dayKey(s.t)) + ' ' + timeStr(s.t) + '</span></div>' +
    (s.customer ? '<div>' + esc(t('inv_customer', { x: s.customer })) + '</div>' : '') +
    '<table><thead><tr><th>' + esc(t('inv_col_item')) + '</th><th class="n">' + esc(t('inv_col_qty')) + '</th><th class="n">' + esc(t('inv_col_price')) + '</th><th class="n">' + esc(t('inv_col_total')) + '</th></tr></thead><tbody>' + rows + '</tbody></table>' +
    '<div class="tt"><span>' + esc(t('total')) + '</span>' + money(s.total) + '</div></div>';
}
function invoiceText(s) {
  var o = [S.settings.shop || t('app_title'), t('invoice_short', { n: pad(s.no, 4) }) + ' · ' + dayKey(s.t) + ' ' + timeStr(s.t)];
  if (s.customer) o.push(t('inv_customer', { x: s.customer }));
  s.items.forEach(function (it) { o.push('- ' + it.label + ' × ' + fmt(it.qty) + ' = ' + moneyT(it.qty * it.price)); });
  o.push(t('total') + ': ' + moneyT(s.total)); return o.join('\n');
}
function openInvoice(id) {
  var s = S.sales.get(id); if (!s) return;
  F = { invoiceId: id };
  var html = '<div class="form">' + invoiceHTML(s) + '<div class="actions"><button class="btn primary" type="button" data-action="inv-copy">' + esc(t('inv_copy')) + '</button>' +
    (navigator.share ? '<button class="btn" type="button" data-action="inv-share">' + esc(t('inv_share')) + '</button>' : '') +
    '<button class="btn" type="button" data-action="inv-print">' + esc(t('inv_print')) + '</button></div><button class="btn" type="button" data-action="close">' + esc(t('close')) + '</button></div>';
  openSheet(t('inv_title', { n: pad(s.no, 4) }), html, null);
}
function copyText(text) {
  var fb = function () { var ta = document.createElement('textarea'); ta.value = text; ta.style.cssText = 'position:fixed;opacity:0;top:0'; document.body.appendChild(ta); ta.select(); var ok = false; try { ok = document.execCommand('copy'); } catch (e) {} ta.remove(); toast(ok ? t('toast_copied') : t('toast_copy_fail')); };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { toast(t('toast_copied')); }, fb); else fb();
}

/* ----- list manager (names / vehicles) ----- */
function openList(store) {
  F = { list: store, q: '' };
  var ph = t('list_add_ph_' + store);
  var html = '<div class="form"><div class="row" style="flex-wrap:nowrap"><input id="lm-new" placeholder="' + esc(ph) + '" autocomplete="off"><button class="btn primary" type="button" data-action="list-add">' + esc(t('list_add')) + '</button></div><div id="f-err" class="err" role="alert"></div>' +
    '<input id="lm-q" type="search" placeholder="' + esc(t('list_search')) + '" autocomplete="off"><div id="lm-list"></div></div>';
  openSheet(t(store === 'names' ? 'list_names_title' : 'list_vehicles_title'), html, function () { listAddFromInput(); }, '#lm-new');
  renderList();
}
function renderList() {
  var store = F.list, q = norm(($('#lm-q') || {}).value || '');
  var arr = [...S[store].values()].filter(function (x) { return !q || norm(x.name).indexOf(q) >= 0; }).sort(function (a, b) { return a.name.localeCompare(b.name, LANG); });
  $('#lm-list').innerHTML = arr.map(function (x) {
    var n = usageCount(store, x.id);
    return '<div class="lm-row" data-id="' + esc(x.id) + '"><div class="nm">' + esc(x.name) + '<small>' + esc(n ? t('list_used', { n: fmt(n) }) : t('list_unused')) + '</small></div><div class="row"><button class="btn sm" type="button" data-action="list-rename" data-id="' + esc(x.id) + '">' + esc(t('rename')) + '</button><button class="btn sm danger" type="button" data-action="list-del" data-id="' + esc(x.id) + '">' + esc(t('remove')) + '</button></div></div>';
  }).join('') || '<p class="hint">' + esc(t('list_empty')) + '</p>';
}
function listAddFromInput() {
  var inp = $('#lm-new'), v = inp.value.trim(); if (!v) return;
  var nn = norm(v), dup = false; S[F.list].forEach(function (x) { if (norm(x.name) === nn) dup = true; });
  if (dup) return setErr(t('list_dup'));
  listAdd(F.list, v); inp.value = ''; setErr(''); renderList(); renderAll();
}

/* ----- suppliers ----- */
function openSuppliers() {
  F = { sup: true };
  var groups = new Map();
  liveParts().forEach(function (p) { var k = p.supplierId || ''; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(p); });
  S.suppliers.forEach(function (s) { if (!groups.has(s.id)) groups.set(s.id, []); });
  var keys = [...groups.keys()].sort(function (a, b) { if (!a) return 1; if (!b) return -1; return S.suppliers.get(a).name.localeCompare(S.suppliers.get(b).name, LANG); });
  var h = '<div class="form"><div class="grid2"><div class="field"><label for="sp-name">' + esc(t('sup_name')) + '</label><input id="sp-name" autocomplete="off"></div><div class="field"><label for="sp-phone">' + esc(t('sup_phone')) + ' <small>(' + esc(t('opt')) + ')</small></label><input id="sp-phone" inputmode="tel" autocomplete="off"></div></div>' +
    '<button class="btn primary" type="button" data-action="sup-add">' + esc(t('sup_add')) + '</button><div id="f-err" class="err" role="alert"></div>';
  keys.forEach(function (k) {
    var s = S.suppliers.get(k), parts = groups.get(k), need = parts.filter(function (p) { return stateOf(p) !== 'ok'; }).sort(function (a, b) { return qtyOf(a.id) - qtyOf(b.id); });
    if (!k && !parts.length) return;
    h += '<div class="sup"><div><b>' + esc(s ? s.name : t('sup_none')) + '</b>' + (s && s.phone ? '<div class="meta"><span class="code">' + esc(s.phone) + '</span></div>' : '') + '<div class="hint">' + esc(t('items_n', { n: fmt(parts.length) })) + '</div></div>' +
      (need.length ? '<div><div class="hint" style="font-weight:600">' + esc(t('sup_need', { n: fmt(need.length) })) + '</div><ul class="need">' + need.map(function (p) { return '<li><span>' + esc(nameOf(p)) + '</span><span class="n">' + fmt(qtyOf(p.id)) + ' / ' + fmt(p.min || 0) + '</span></li>'; }).join('') + '</ul></div>' : '<p class="hint">' + esc(t('sup_ok')) + '</p>') +
      '<div class="row">' + (need.length ? '<button class="btn sm" type="button" data-action="sup-copy" data-id="' + esc(k) + '">' + esc(t('sup_copy')) + '</button>' : '') +
      (k && !parts.length ? '<button class="btn sm danger" type="button" data-action="sup-del" data-id="' + esc(k) + '">' + esc(t('sup_delete')) + '</button>' : '') + '</div></div>';
  });
  if (!keys.length) h += '<p class="hint">' + esc(t('sup_empty')) + '</p>';
  openSheet(t('sup_title'), h + '</div>', null, '#sp-name');
}
function orderText(k) {
  var s = S.suppliers.get(k), need = liveParts().filter(function (p) { return (p.supplierId || '') === k && stateOf(p) !== 'ok'; });
  return [s ? t('order_head', { x: s.name }) : t('order_head_plain')].concat(need.map(function (p) { return t('order_line', { name: nameOf(p) + (p.code ? ' (' + p.code + ')' : ''), q: fmt(qtyOf(p.id)), n: fmt(needQty(p)) }); })).join('\n');
}

/* ----- settings / backup ----- */
function openSettings() {
  var html = '<form id="sheetForm" class="form" novalidate><div class="field"><label for="f-shop">' + esc(t('set_shop')) + '</label><input id="f-shop" autocomplete="off" value="' + esc(S.settings.shop || '') + '"></div>' +
    '<div class="field"><label>' + esc(t('set_lang')) + '</label><div class="chips"><button class="chip" type="button" data-action="setlang" data-l="ar" aria-pressed="' + (LANG === 'ar') + '">العربية</button><button class="chip" type="button" data-action="setlang" data-l="fr" aria-pressed="' + (LANG === 'fr') + '">Français</button></div></div>' +
    '<div class="actions"><button class="btn primary" type="submit">' + esc(t('save')) + '</button><button class="btn" type="button" data-action="close">' + esc(t('cancel')) + '</button></div></form>';
  openSheet(t('set_title'), html, function () { S.settings.shop = val('shop'); persist([settingsPut()]); closeSheet(); renderAll(); }, '#f-shop');
}
function openBackup() {
  var lb = S.settings.lastBackup;
  var html = '<div class="form"><p class="hint">' + esc(t('bk_note')) + '</p><p class="hint"><b>' + esc(lb ? t('bk_last', { d: dayKey(lb) + ' ' + timeStr(lb) }) : t('bk_never')) + '</b></p>' +
    '<button class="btn primary" type="button" data-action="bk-export">' + esc(t('bk_export')) + '</button>' +
    '<label class="btn" for="bk-file" style="cursor:pointer">' + esc(t('bk_import')) + '</label><input id="bk-file" type="file" accept="application/json,.json" hidden>' +
    '<div id="bk-confirm"></div><div id="f-err" class="err" role="alert"></div>' +
    '<button class="btn" type="button" data-action="csv-inv">' + esc(t('bk_csv_inv')) + '</button><button class="btn" type="button" data-action="csv-mov">' + esc(t('bk_csv_mov')) + '</button></div>';
  openSheet(t('bk_title'), html, null);
}
function download(name, data, type) {
  var blob = new Blob([data], { type: type }), url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
}
function exportBackup() {
  S.settings.lastBackup = Date.now(); persist([settingsPut()]);
  var data = { app: 'partstock', version: 1, exported: new Date().toISOString(), data: snapshot() };
  download('stock-backup-' + dayKey(Date.now()) + '.json', JSON.stringify(data), 'application/json');
  toast(t('bk_saved')); renderBanner();
}
var csvCell = function (v) { var s = String(v == null ? '' : v); return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
var toCsv = function (rows) { return '﻿sep=,\r\n' + rows.map(function (r) { return r.map(csvCell).join(','); }).join('\r\n'); };
function exportCsvInv() {
  var rows = [[t('f_name'), t('f_code'), t('f_vehicle'), t('f_shelf'), t('f_window'), t('f_supplier'), t('f_qty'), t('f_min'), t('f_buy'), t('stat_value')]];
  liveParts().sort(function (a, b) { return nameOf(a).localeCompare(nameOf(b), LANG); }).forEach(function (p) { rows.push([nameOf(p), p.code, vehOf(p).join(' / '), p.shelf, p.win, supOf(p), qtyOf(p.id), p.min || '', p.buy, r2(qtyOf(p.id) * (p.buy || 0))]); });
  download('stock-' + dayKey(Date.now()) + '.csv', toCsv(rows), 'text/csv');
}
function exportCsvMov() {
  var rows = [['date', 'time', 'type', t('f_name'), t('f_qty'), 'price', 'total', 'invoice', 'note']];
  S.moves.slice().sort(function (a, b) { return a.t - b.t; }).forEach(function (m) {
    var s = m.saleId ? S.sales.get(m.saleId) : null;
    rows.push([dayKey(m.t), timeStr(m.t), t('k_' + (m.kind === 'ret' ? 'returned' : m.kind)), m.label, m.delta, m.price || '', m.price ? r2(Math.abs(m.delta) * m.price) : '', s ? pad(s.no, 4) : '', m.note]);
  });
  download('movements-' + dayKey(Date.now()) + '.csv', toCsv(rows), 'text/csv');
}
function importBackup(file) {
  var rd = new FileReader();
  rd.onload = function () {
    var j; try { j = JSON.parse(rd.result); } catch (e) { return setErr(t('bk_bad')); }
    if (!j || j.app !== 'partstock' || !j.data || !Array.isArray(j.data.parts)) return setErr(t('bk_bad'));
    F = { backup: j.data }; setErr('');
    $('#bk-confirm').innerHTML = '<div class="merge"><span>' + esc(t('bk_confirm_import', { p: fmt(j.data.parts.length) })) + '</span><button class="btn danger" type="button" data-action="bk-restore">' + esc(t('bk_confirm')) + '</button></div>';
  };
  rd.readAsText(file);
}
function restoreBackup() {
  var data = F && F.backup; if (!data) return;
  var ops = STORES.map(function (s) { return [s, 'clear']; });
  loadState(data); if (!S.settings.id) S.settings.id = 'main';
  var snap = snapshot(); STORES.forEach(function (s) { snap[s].forEach(function (x) { ops.push([s, 'put', x]); }); });
  persist(ops).then(function () { var lang = S.settings.lang; if (lang && lang !== LANG) { LANG = lang; setTexts(); } loadCart(); closeSheet(); toast(t('bk_done_imp')); renderAll(); });
}

/* ============ toast ============ */
var toastT = 0;
function toast(m) { var el = $('#toast'); el.textContent = m; el.hidden = false; clearTimeout(toastT); toastT = setTimeout(function () { el.hidden = true; }, 3400); }

/* ============ events ============ */
function setLang(l) {
  LANG = l; S.settings.lang = l; persist([settingsPut()]); setTexts();
  if (!$('#overlay').hidden) { var a = F; closeSheet(); }
  renderAll();
}
document.addEventListener('click', function (ev) {
  var st = ev.target.closest('[data-step]');
  if (st) { var i = $('#f-qty'); if (!i) return; var n = parseNum(i.value); if (!(n >= 0)) n = 0; i.value = r2(Math.max(1, n + Number(st.dataset.step))); updateTotal(); return; }
  if (ev.target.id === 'overlay') { closeSheet(); return; }
  var el = ev.target.closest('[data-action]'); if (!el) return;
  var a = el.dataset.action, id = el.dataset.id;
  switch (a) {
    case 'tab': ui.tab = el.dataset.tab; renderAll(); window.scrollTo(0, 0); break;
    case 'lang': setLang(LANG === 'ar' ? 'fr' : 'ar'); break;
    case 'setlang': setLang(el.dataset.l); openSettings(); break;
    case 'add-part': openPart(''); break;
    case 'edit-part': openPart(id); break;
    case 'restock': openRestock(id); break;
    case 'to-cart': addToCart(id); break;
    case 'chip': ui.filter = el.dataset.f; renderStock(); break;
    case 'mchip': ui.mf = el.dataset.f; renderMoves(); break;
    case 'close': closeSheet(); break;
    case 'pick': chooseFromCombo(el.dataset.field, id); break;
    case 'pick-new': {
      var field = el.dataset.field, store = { name: 'names', vehicle: 'vehicles', supplier: 'suppliers' }[field];
      var it = listAdd(store, $('#f-' + field).value); if (it) chooseFromCombo(field, it.id); break;
    }
    case 'veh-remove': F.vehicleIds = F.vehicleIds.filter(function (x) { return x !== id; }); renderVehChips(); break;
    case 'photo-remove': F.photo = ''; renderPhoto(); break;
    case 'merge': mergeInto(id); break;
    case 'askdel':
      if (!el.classList.contains('armed')) { el.classList.add('armed'); el.textContent = t('confirm_again'); setTimeout(function () { if (el.isConnected) { el.classList.remove('armed'); el.textContent = t('delete_part'); } }, 4000); }
      else { var nm = nameOf(S.parts.get(id)); deletePart(id); S.cart = S.cart.filter(function (l) { return l.partId !== id; }); saveCart(); closeSheet(); toast(t('toast_deleted', { x: nm })); renderAll(); }
      break;
    case 'picker': openPicker(); break;
    case 'pick-part': closeSheet(); addToCart(id); break;
    case 'cart-remove': S.cart.splice(Number(el.dataset.i), 1); saveCart(); renderAll(); break;
    case 'cart-clear': S.cart = []; saveCart(); renderAll(); break;
    case 'cart-step': { var l = S.cart[Number(el.dataset.i)], f = lineInfo(l), n2 = (parseNum(l.qty) || 0) + Number(el.dataset.d); l.qty = String(r2(Math.min(f.av, Math.max(1, n2)))); saveCart(); renderSell(); break; }
    case 'cart-last': { var l2 = S.cart[Number(el.dataset.i)], la = S.last.get(l2.partId); if (la) { l2.price = String(la.price); saveCart(); renderSell(); } break; }
    case 'confirm-sale': confirmSale(); break;
    case 'open-invoice': openInvoice(id); break;
    case 'return-sale': returnSale(id).then(function () { toast(t('toast_returned')); renderAll(); }); break;
    case 'inv-copy': copyText(invoiceText(S.sales.get(F.invoiceId))); break;
    case 'inv-share': navigator.share({ text: invoiceText(S.sales.get(F.invoiceId)) }).catch(function () {}); break;
    case 'inv-print': $('#printArea').innerHTML = invoiceHTML(S.sales.get(F.invoiceId)); window.print(); break;
    case 'open-names': openList('names'); break;
    case 'open-vehicles': openList('vehicles'); break;
    case 'open-suppliers': openSuppliers(); break;
    case 'open-backup': openBackup(); break;
    case 'open-settings': openSettings(); break;
    case 'backup-now': exportBackup(); break;
    case 'bk-export': exportBackup(); break;
    case 'bk-restore': restoreBackup(); break;
    case 'csv-inv': exportCsvInv(); break;
    case 'csv-mov': exportCsvMov(); break;
    case 'list-add': listAddFromInput(); break;
    case 'list-rename': {
      var row = el.closest('.lm-row'), item = S[F.list].get(id);
      if (el.dataset.editing) {
        var v = row.querySelector('input').value.trim(), nn = norm(v), dup = false; S[F.list].forEach(function (x) { if (x.id !== id && norm(x.name) === nn) dup = true; });
        if (!v) return; if (dup) return setErr(t('list_dup'));
        item.name = v; persist([[F.list, 'put', item]]); setErr(''); renderList(); renderAll();
      } else {
        row.querySelector('.nm').innerHTML = '<input value="' + esc(item.name) + '" autocomplete="off">'; el.dataset.editing = '1'; el.textContent = t('save'); row.querySelector('input').focus();
      }
      break;
    }
    case 'list-del': { var n3 = usageCount(F.list, id); if (n3) return setErr(t('list_in_use', { n: fmt(n3) })); S[F.list].delete(id); persist([[F.list, 'del', id]]); setErr(''); renderList(); renderAll(); break; }
    case 'sup-add': {
      var nmv = $('#sp-name').value.trim(); if (!nmv) return;
      var ex = null; S.suppliers.forEach(function (x) { if (norm(x.name) === norm(nmv)) ex = x; }); if (ex) return setErr(t('list_dup'));
      listAdd('suppliers', nmv, { phone: $('#sp-phone').value.trim() }); openSuppliers(); renderAll(); break;
    }
    case 'sup-copy': copyText(orderText(id || '')); break;
    case 'sup-del': S.suppliers.delete(id); persist([['suppliers', 'del', id]]); openSuppliers(); renderAll(); break;
    case 'install': if (deferredInstall) { deferredInstall.prompt(); deferredInstall.userChoice.then(function () { deferredInstall = null; renderAll(); }); } break;
  }
});
document.addEventListener('input', function (ev) {
  var e = ev.target;
  if (e.id === 'q') { ui.q = e.value; renderStock(); }
  else if (e.dataset && e.dataset.combo) {
    var f = e.dataset.combo;
    if (f === 'name') F.nameId = ''; if (f === 'supplier') F.supplierId = '';
    renderCombo(f);
  }
  else if (e.dataset && e.dataset.cart) {
    var l = S.cart[Number(e.dataset.i)]; l[e.dataset.cart] = e.value; saveCart(); refreshCartTotals();
  }
  else if (e.id === 'cust') { S.customer = e.value; }
  else if (e.id === 'pk-q') renderPicker();
  else if (e.id === 'lm-q') renderList();
  else if (e.closest && e.closest('#sheetForm') && F && F.restockId) updateTotal();
});
document.addEventListener('focusin', function (ev) {
  var e = ev.target;
  if (e.dataset && e.dataset.combo) renderCombo(e.dataset.combo);
  else document.querySelectorAll('.dd').forEach(function (d) { if (!d.contains(e)) d.hidden = true; });
});
document.addEventListener('change', function (ev) {
  var e = ev.target;
  if (e.id === 'vehSel') { ui.veh = e.value; renderStock(); }
  else if (e.id === 'sortSel') { ui.sort = e.value; renderStock(); }
  else if (e.id === 'f-photo' && e.files && e.files[0]) { resizeImage(e.files[0], 720).then(function (u) { F.photo = u; renderPhoto(); }, function () {}); e.value = ''; }
  else if (e.id === 'bk-file' && e.files && e.files[0]) { importBackup(e.files[0]); e.value = ''; }
});
document.addEventListener('submit', function (ev) { if (ev.target.id === 'sheetForm') { ev.preventDefault(); if (sheetSubmit) sheetSubmit(); } });
document.addEventListener('keydown', function (ev) {
  if (ev.key === 'Escape' && !$('#overlay').hidden) closeSheet();
  if (ev.key === 'Enter' && ev.target.id === 'lm-new') { ev.preventDefault(); listAddFromInput(); }
  if (ev.key === 'Enter' && ev.target.dataset && ev.target.dataset.combo) ev.preventDefault();
});
window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); deferredInstall = e; if (ui.tab === 'more') renderMore(); });

/* ============ start ============ */
function init() {
  try { var l = localStorage.getItem('ps_lang'); if (l === 'fr') LANG = 'fr'; } catch (e) {}
  openDB().then(function (db) { IDB = db; DBOK = true; return Promise.all(STORES.map(getAll)); })
    .then(function (rs) { var d = {}; STORES.forEach(function (s, i) { d[s] = rs[i]; }); loadState(d); })
    .catch(function (e) { try { console.error(e); } catch (x) {} DBOK = false; })
    .then(function () {
      if (S.settings.lang) LANG = S.settings.lang;
      if (!S.settings.deviceId) { S.settings.deviceId = uid(); persist([settingsPut()]); }
      loadCart(); setTexts(); renderAll();
      if (navigator.storage && navigator.storage.persist) { try { navigator.storage.persist(); } catch (e) {} }
    });
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(function () {});
  window.__app = { S: S, t: t };
}
init();
})();
