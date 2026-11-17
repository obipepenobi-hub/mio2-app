/* Mio² – Spots aus Social-Media-Links oder Ortsnamen sammeln, ordnen und zu Trips planen.
   Geocoding: OpenStreetMap Nominatim · Fotos/Texte: Wikipedia · Karte: Leaflet + OSM */
(() => {
  const $ = s => document.querySelector(s);
  const KEY = 'mio.v1';
  const CATS = { Attraction: '🏛', Restaurant: '🍽', Cafe: '☕', Bar: '🍸', Hotel: '🛏', Nature: '🌿', Shopping: '🛍' };
  // Anzeige auf Deutsch (gespeichert bleiben die englischen Schlüssel)
  const CATD = { Attraction: 'Sehenswürdigkeit', Restaurant: 'Restaurant', Cafe: 'Café', Bar: 'Bar', Hotel: 'Hotel', Nature: 'Natur', Shopping: 'Shopping', 'Must Do': 'Favoriten' };
  const GROUPD = { Any: 'Alle', Eat: 'Essen', 'Night out': 'Ausgehen', Adventure: 'Abenteuer', Shopping: 'Shoppen', Sights: 'Sehenswertes' };
  const dc = c => CATD[c] || c;
  const TAGD = { restaurant: 'Restaurant', cafe: 'Café', bar: 'Bar', pub: 'Kneipe', hotel: 'Hotel', hostel: 'Hostel', attraction: 'Attraktion', museum: 'Museum', viewpoint: 'Aussichtspunkt', beach: 'Strand', park: 'Park', peak: 'Gipfel', castle: 'Burg', church: 'Kirche', 'place of worship': 'Gotteshaus', theatre: 'Theater', gallery: 'Galerie', zoo: 'Zoo', artwork: 'Kunstwerk', monument: 'Denkmal', memorial: 'Gedenkstätte', waterfall: 'Wasserfall', 'nature reserve': 'Naturschutzgebiet', 'fast food': 'Fast Food', 'fast_food': 'Fast Food', nightclub: 'Nachtclub', bakery: 'Bäckerei', marketplace: 'Markt', mall: 'Einkaufszentrum', supermarket: 'Supermarkt', 'guest house': 'Pension', motel: 'Motel', island: 'Insel', lake: 'See', water: 'Wasser', cave: 'Höhle', ruins: 'Ruine', fort: 'Festung', tower: 'Turm', bridge: 'Brücke', garden: 'Garten', italian: 'italienisch', pizza: 'Pizza', sushi: 'Sushi', burger: 'Burger', japanese: 'japanisch', chinese: 'chinesisch', indian: 'indisch', mexican: 'mexikanisch', thai: 'thailändisch', greek: 'griechisch', french: 'französisch', spanish: 'spanisch', german: 'deutsch', turkish: 'türkisch', vietnamese: 'vietnamesisch', seafood: 'Meeresfrüchte', 'steak house': 'Steakhaus', 'coffee shop': 'Kaffeehaus', regional: 'regional', local: 'lokal', international: 'international', vegan: 'vegan', vegetarian: 'vegetarisch', kebab: 'Kebab', 'ice cream': 'Eis' };
  const tagDe = t => TAGD[String(t).toLowerCase()] || t;
  const GERMAN_RE = /\b(und|der|die|das|ist|nicht|mit|ein|eine|für|auf|zu|im|den|von|wir|ich|auch|sehr)\b/gi;
  const isGerman = t => ((t || '').match(GERMAN_RE) || []).length >= 3;
  // Automatische Übersetzung nach Deutsch (MyMemory, ohne Schlüssel); bei Fehlern bleibt der Originaltext
  const trCache = new Map();
  async function toDe(text) {
    text = (text || '').trim();
    if (!text || isGerman(text)) return text;
    if (trCache.has(text)) return trCache.get(text);
    const parts = text.match(/[^.!?\n]+[.!?]*\s*|\n+/g) || [text], chunks = [''];
    for (const p of parts) { if ((chunks[chunks.length - 1] + p).length > 420) chunks.push(''); chunks[chunks.length - 1] += p; }
    let out = '';
    for (const c of chunks) {
      if (!c.trim()) { out += c; continue; }
      try {
        const r = await fetch('https://api.mymemory.translated.net/get?langpair=Autodetect|de&q=' + encodeURIComponent(c.slice(0, 450)));
        const j = await r.json(); const t = j.responseData?.translatedText;
        out += (j.responseStatus == 200 && t && !/MYMEMORY WARNING|QUERY LENGTH/i.test(t)) ? t + (/\s$/.test(c) ? ' ' : '') : c;
      } catch { out += c; }
    }
    out = out.trim(); trCache.set(text, out); return out;
  }
  const GROUPS = { Eat: ['Restaurant', 'Cafe'], 'Night out': ['Bar'], Adventure: ['Nature'], Shopping: ['Shopping'], Sights: ['Attraction', 'Hotel'] };

  // ---------- State ----------
  let db = JSON.parse(localStorage.getItem(KEY) || 'null') || {};
  db.spots ||= []; db.collections ||= []; db.trips ||= []; db.streak ||= { day: '', n: 0 };
  const save = () => localStorage.setItem(KEY, JSON.stringify(db));
  const today = () => new Date().toISOString().slice(0, 10);
  const yesterday = () => new Date(Date.now() - 864e5).toISOString().slice(0, 10);
  let selectedId = null, filter = null, region = null, countryMode = false;
  let pending = null, loadToken = 0;
  let libView = { v: 'home' }, libQuery = '';
  let tripId = null, tripTab = 'it', tripDay = 0, routeLayer = null;
  let rollGroup = 'Any', orgSpot = null;

  // ---------- Helpers ----------
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toast = msg => { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('on'), 2200); };
  const spotById = id => db.spots.find(s => s.id === id);
  const uid = () => 'x' + Math.random().toString(36).slice(2, 9);
  const host = u => { try { return new URL(u).hostname.replace('www.', ''); } catch { return ''; } };
  const icon = {
    heart: '<svg viewBox="0 0 24 24"><path d="M12 20s-7-4.4-7-10a4 4 0 017-2.6A4 4 0 0119 10c0 5.600-7 10-7 10z"/></svg>',
    nav: '<svg viewBox="0 0 24 24"><path d="M21 3L3 11l7 3 3 7z"/></svg>',
    check: '<svg viewBox="0 0 24 24"><path d="M5 12l5 5 9-10"/></svg>',
    chev: '<svg viewBox="0 0 24 24" class="chev"><path d="M9 5l7 7-7 7"/></svg>',
    dots: '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/></svg>'
  };
  $('#mascot').innerHTML = '<svg viewBox="0 0 90 68"><path d="M18 52c-6-2-8-12-2-16 2-12 12-16 22-12 8-6 20-4 24 6 6 4 8 14 2 20" /><path d="M24 30l-3-12 10 6M52 24l8-10 2 12"/><circle cx="34" cy="38" r="1.6" fill="#2a2a28"/><circle cx="48" cy="38" r="1.6" fill="#2a2a28"/><path d="M38 44q3 3 6 0M16 52c10 8 40 8 58-2 6-4 8-10 4-14M72 50c8 2 12-4 8-10"/></svg>';
  const dirUrl = s => `https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lon}`;
  const flagUrl = cc => `https://flagcdn.com/w80/${(cc || 'xx').toLowerCase()}.png`;
  const fmtDate = d => d ? new Date(d + 'T00:00').toLocaleDateString('de-DE', { day: 'numeric', month: 'short', year: '2-digit' }) : '';

  function guessCat(r) {
    const c = r.class, t = r.type;
    if (['restaurant', 'fast_food', 'food_court'].includes(t)) return 'Restaurant';
    if (t === 'cafe') return 'Cafe';
    if (['bar', 'pub', 'nightclub'].includes(t)) return 'Bar';
    if (c === 'shop' || ['marketplace', 'mall', 'supermarket'].includes(t)) return 'Shopping';
    if (c === 'tourism' && ['hotel', 'hostel', 'guest_house', 'motel'].includes(t)) return 'Hotel';
    if (c === 'natural' || c === 'leisure' || ['park', 'beach', 'peak', 'water'].includes(t)) return 'Nature';
    return 'Attraction';
  }

  async function wiki(name, lang) {
    try {
      const r = await fetch(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(name)}`);
      if (!r.ok) return null;
      const j = await r.json();
      return { img: j.thumbnail?.source || null, orig: j.originalimage?.source || null, desc: j.extract || '' };
    } catch { return null; }
  }
  async function enrich(spot) {
    const names = [spot.name, spot.short];
    let best = null;
    outer: for (const lang of ['de', 'en', 'es']) for (const n of names) {
      const w = await wiki(n, lang);
      if (!w) continue;
      w.lang = lang;
      if (w.img) { best = { ...w, desc: w.desc || best?.desc, lang: w.desc ? lang : best?.lang }; break outer; }
      if (w.desc && !best) best = w;
    }
    if (best) {
      spot.img = best.img; spot.hero = best.orig || best.img;
      spot.desc = best.desc && best.lang !== 'de' ? await toDe(best.desc) : best.desc;
    }
    spot.dl = 1;
    return spot;
  }
  async function geocode(q) {
    const u = `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&extratags=1&limit=5&accept-language=de&q=${encodeURIComponent(q)}`;
    const r = await fetch(u); if (!r.ok) throw new Error('geocode');
    return (await r.json()).map(r => {
      const a = r.address || {};
      const city = a.city || a.town || a.village || a.municipality || a.county || '';
      const name = r.name || r.display_name.split(',')[0];
      const cat = guessCat(r);
      return {
        id: 's' + r.place_id, name: `${name}${a.country ? ', ' + a.country : ''}`, short: name, lat: +r.lat, lon: +r.lon, cat,
        region: a.state || a.region || a.county || a.country || name, country: a.country || '', cc: a.country_code || '',
        city: city || a.state || '', hours: r.extratags?.opening_hours || '',
        tags: [...new Set([r.type, r.extratags?.cuisine].filter(Boolean).flatMap(x => String(x).split(';')).map(x => x.replace(/_/g, ' ').trim()).filter(x => x && x.toLowerCase() !== cat.toLowerCase()).map(tagDe))].slice(0, 3), dl: 1
      };
    });
  }
  async function readSource(url, text) {
    if (window.MioNative && window.MioResolve) return window.MioResolve(url, text);
    const r = await fetch('/api/resolve?url=' + encodeURIComponent(url) + (text ? '&text=' + encodeURIComponent(text) : ''));
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'resolve failed');
    return j;
  }
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const urlIn = t => (t.match(/https?:\/\/[^\s<>"']+/i) || [''])[0].replace(/[).,;!?]+$/, '');

  // ---------- Map ----------
  const map = L.map('map', { zoomControl: false, attributionControl: false, minZoom: 2 }).setView([20, 0], 2);
  L.tileLayer('https://tile.openstreetmap.de/{z}/{x}/{y}.png', { maxZoom: 18, className: 'soft-tiles' }).addTo(map);
  let markers = {};
  const visibleSpots = () => db.spots.filter(s => !filter || (filter === 'Must Do' ? s.fav : s.cat === filter));

  function renderMarkers() {
    Object.values(markers).forEach(m => m.remove()); markers = {};
    if (countryMode) {
      const by = {};
      db.spots.forEach(s => { const k = s.cc || '??'; (by[k] ||= []).push(s); });
      Object.entries(by).forEach(([cc, l]) => {
        const lat = l.reduce((a, s) => a + s.lat, 0) / l.length, lon = l.reduce((a, s) => a + s.lon, 0) / l.length;
        const html = `<div class="flag"><img src="${flagUrl(cc)}" alt=""><b>${l.length}</b></div>`;
        const m = L.marker([lat, lon], { icon: L.divIcon({ html, className: '', iconSize: [54, 40], iconAnchor: [14, 34] }) }).addTo(map);
        m.on('click', () => { countryMode = false; setRegion(l[0].country); map.flyToBounds(l.map(s => [s.lat, s.lon]), { padding: [70, 70], maxZoom: 12, duration: 1.2 }); refresh(); });
        markers['c' + cc] = m;
      });
      return;
    }
    visibleSpots().forEach(s => {
      const html = `<div class="pin ${s.id === selectedId ? 'sel' : ''}">${CATS[s.cat] || '📍'}</div><div class="pin-l">${esc(s.short)}</div>`;
      const m = L.marker([s.lat, s.lon], { icon: L.divIcon({ html, className: '', iconSize: [34, 34], iconAnchor: [17, 17] }) }).addTo(map);
      m.on('click', () => select(s.id));
      markers[s.id] = m;
    });
  }
  function renderChips() {
    const cats = [...new Set(db.spots.map(s => s.cat))];
    const items = [['Must Do', '❤️']].concat(cats.map(c => [c, CATS[c] || '📍']));
    $('#chips').innerHTML = items.map(([n, e]) => `<button class="chip ${filter === n ? 'on' : ''}" data-f="${esc(n)}">${e} ${esc(dc(n))}</button>`).join('');
    $('#chips').style.display = db.spots.length && !countryMode ? '' : 'none';
  }
  function renderPreview() {
    const s = spotById(selectedId), w = $('#previewWrap');
    if (countryMode) { w.innerHTML = `<div class="empty">${new Set(db.spots.map(s => s.cc)).size} Länder · tippe auf eine Flagge</div>`; return; }
    if (!db.spots.length) { w.innerHTML = `<div class="empty">Noch keine Spots. Tippe auf <b>+</b> und füge einen Link oder Ort hinzu.</div>`; return; }
    if (!s) { w.innerHTML = `<div class="empty">${visibleSpots().length} Spots · tippe auf einen Pin</div>`; return; }
    w.innerHTML = `<button class="preview" id="pv">${s.img ? `<img src="${esc(s.img)}" alt="">` : '<div class="ph"></div>'}
      <div class="pt"><b>${esc(s.short)}</b><span class="pd">${esc(s.desc || s.name)}</span></div>
      <div class="acts"><span class="${s.fav ? 'on' : ''}" id="pvFav">${icon.heart}</span><a href="${dirUrl(s)}" target="_blank" rel="noopener" id="pvDir" style="color:inherit">${icon.nav}</a></div></button>`;
    $('#pv').onclick = e => { if (e.target.closest('#pvFav')) { toggleFav(s.id); return; } if (e.target.closest('#pvDir')) return; openDetail(s.id); };
  }
  function setRegion(r) { region = r; $('#regionTitle').textContent = r || 'Mio²'; }
  function select(id, fly = true) {
    countryMode = false; selectedId = id; const s = spotById(id);
    if (s) { setRegion(s.region); if (fly) map.flyTo([s.lat, s.lon], Math.max(map.getZoom(), 15), { duration: 1.4 }); }
    refresh();
  }
  function refresh() { renderChips(); renderMarkers(); renderPreview(); positionTools(); }
  function positionTools() { $('#mapTools').style.bottom = ($('#bottom').offsetHeight + 12) + 'px'; }
  function toggleFav(id) { const s = spotById(id); s.fav = !s.fav; save(); refresh(); if ($('#sheetDetail').classList.contains('open')) openDetail(id); }

  // ---------- Sheets ----------
  const sheets = ['#sheetAdd', '#sheetLoading', '#sheetFound', '#sheetDetail', '#sheetLibrary', '#sheetTrip', '#sheetRoll'];
  function syncScrim() { $('#scrim').classList.toggle('on', ['#sheetAdd', '#sheetLoading', '#sheetFound', '#sheetLibrary', '#sheetRoll', '#sheetPick'].some(s => $(s).classList.contains('open')) || $('#orgMenu').classList.contains('open')); }
  function openSheet(sel) { sheets.forEach(s => s !== sel && $(s).classList.remove('open')); $(sel).classList.add('open'); if (sel !== '#sheetTrip') clearRoute(); syncScrim(); }
  function closeSheets() { [...sheets, '#sheetPick'].forEach(s => $(s).classList.remove('open')); $('#orgMenu').classList.remove('open'); loadToken++; clearRoute(); tripId = null; syncScrim(); }
  $('#scrim').onclick = () => { if ($('#orgMenu').classList.contains('open')) { $('#orgMenu').classList.remove('open'); syncScrim(); } else if ($('#sheetPick').classList.contains('open')) closePick(); else closeSheets(); };
  document.querySelectorAll('[data-close]').forEach(b => b.onclick = closeSheets);

  // generic picker
  let pickRender = null;
  function openPick(title, render) {
    pickRender = render; $('#pickTitle').textContent = title; drawPick(); $('#sheetPick').classList.add('open'); syncScrim();
  }
  function drawPick() {
    const items = pickRender();
    $('#pickBody').innerHTML = items.map((it, i) => `<button class="pick-row ${it.plus ? 'plus' : ''}" data-i="${i}">${esc(it.label)}${it.on !== undefined ? `<span class="check ${it.on ? 'on' : ''}">${icon.check}</span>` : (it.sub ? `<small>${esc(it.sub)}</small>` : '')}</button>`).join('') || '<div class="empty">Nichts vorhanden</div>';
    $('#pickBody').onclick = e => { const b = e.target.closest('.pick-row'); if (!b) return; const r = items[+b.dataset.i].fn(); if (r !== false) closePick(); else drawPick(); };
  }
  function closePick() { $('#sheetPick').classList.remove('open'); syncScrim(); }
  $('#pickClose').onclick = closePick;

  // ---------- Add flow ----------
  $('#btnAdd').onclick = () => { $('#addInput').value = ''; $('#addText').value = ''; $('#addText').style.display = 'none'; openSheet('#sheetAdd'); setTimeout(() => $('#addInput').focus({ preventScroll: true }), 350); };
  $('#addInput').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); startFind(); } });
  $('#btnFind').onclick = startFind;
  $('#btnLoadCancel').onclick = closeSheets;
  $('#btnFoundCancel').onclick = closeSheets;

  async function startFind() {
    const raw = $('#addInput').value.trim(); if (!raw) return;
    const link = urlIn(raw), isLink = !!link;
    const pastedText = $('#addText').value.trim() || (isLink ? raw.replace(link, '').trim() : '');
    const token = ++loadToken;
    $('#loadSub').textContent = isLink ? 'Video wird gelesen' : 'Karte wird durchsucht';
    openSheet('#sheetLoading');
    try {
      let source = { url: '', title: raw, author: '', caption: '', hashtags: [] };
      let cands = [{ name: raw, conf: 'high' }];
      if (isLink) {
        try { source = await readSource(link, pastedText); }
        catch (e) {
          if (token !== loadToken) return;
          closeSheets(); openSheet('#sheetAdd');
          return toast(/Failed to fetch|NetworkError|Unexpected token/.test(e.message) ? 'Server nicht erreichbar – starte „python server.py“' : e.message);
        }
        if (token !== loadToken) return;
        if (source.needs_text) {
          openSheet('#sheetAdd'); $('#addText').style.display = ''; $('#addText').focus({ preventScroll: true });
          return toast('Ohne Login gibt Instagram nichts preis – füge die Beschreibung unten ein');
        }
        cands = source.candidates || [];
        if (source.caption && !isGerman(source.caption)) { $('#loadSub').textContent = 'Beschreibung wird übersetzt'; source.caption_de = await toDe(source.caption); }
        for (const c of cands) if (c.note && !isGerman(c.note)) c.note = await toDe(c.note);
      }
      // Kandidaten in Orte umwandeln (Nominatim: max. 1 Anfrage pro Sekunde)
      const strong = cands.filter(c => c.conf !== 'low'), usable = (strong.length ? strong : cands.slice(0, 3)).slice(0, 8);
      const found = [], ctxHint = source.location_context || '';
      for (let i = 0; i < usable.length; i++) {
        const c = usable[i];
        $('#loadSub').textContent = isLink ? `Suche ${c.name}` : 'Karte wird durchsucht';
        if (i) await sleep(1100);
        if (token !== loadToken) return;
        const q = [c.name, c.context || (c.conf === 'high' || c.conf === 'medium' ? ctxHint : '')].filter(Boolean).join(', ');
        let hits = []; try { hits = await geocode(q); } catch { }
        if (!hits.length && c.context) { await sleep(1100); try { hits = await geocode(c.name); } catch { } }
        const take = isLink ? hits.slice(0, 1) : hits.slice(0, 5);
        take.forEach((h, k) => { if (!found.some(f => f.id === h.id)) found.push({ ...h, cat: c.category || h.cat, tip: c.note || '', conf: c.conf, from: c.name, picked: isLink ? (c.conf !== 'low') : k === 0 }); });
      }
      if (token !== loadToken) return;
      await Promise.all(found.map(enrich));
      if (token !== loadToken) return;
      showFound(isLink ? source : { url: '', title: raw, author: '' }, found, '');
    } catch (e) {
      if (token !== loadToken) return;
      closeSheets(); toast('Suche fehlgeschlagen – bist du online?');
    }
  }

  function showFound(source, results, noText) {
    pending = { source, results: results.map((r, i) => ({ ...r, picked: r.picked ?? (r.conf ? false : i === 0) })), colls: new Set() };
    const n = results.length;
    $('#foundTitle').innerHTML = n ? `Mio² hat <span>${n}</span> ${n === 1 ? 'Spot' : 'Spots'} gefunden!` : 'Noch nichts gefunden';
    $('#sharedToday').textContent = `${db.spots.filter(s => s.added === today()).length} heute geteilt`;
    const st = db.streak.day === today() ? db.streak.n : (db.streak.day === yesterday() ? db.streak.n + 1 : 1);
    $('#streak').textContent = `${st} 🔥`;
    $('#sourceCard').style.display = source.url ? '' : 'none';
    $('#sourceCard').innerHTML = `${source.thumb ? `<img class="ph" src="${esc(source.thumb)}" alt="">` : '<div class="ph"></div>'}
      <div class="t"><div>${esc((source.caption_de || source.caption || source.title || source.url).replace(/\s+/g, ' '))}</div><div class="a">${source.platform === 'instagram' ? '◎' : '♪'} ${esc(source.author || host(source.url))}</div>${(source.hashtags || []).length ? `<div class="h">${esc(source.hashtags.slice(0, 5).map(h => '#' + h).join(' '))}</div>` : ''}</div>`;
    renderFound(source.url ? 'Mio² hat in dem Post keinen eindeutigen Ort gefunden. Füge die Beschreibung ein oder suche den Ort direkt.' : '');
    renderCollChips();
    openSheet('#sheetFound');
  }
  function renderFound(msg) {
    const l = $('#foundList');
    if (!pending.results.length) l.innerHTML = `<div class="empty">${esc(msg || 'Kein Ort gefunden. Versuche einen genaueren Namen.')}</div>`;
    else l.innerHTML = pending.results.map((r, i) => `<button class="found-item" data-i="${i}">
      ${r.img ? `<img src="${esc(r.img)}" alt="">` : '<div class="ph"></div>'}
      <div class="n"><b>${esc(r.name)}</b><small>${CATS[r.cat] || ''} ${esc(dc(r.cat))}${r.conf === 'low' ? ' · vage' : ''}${r.tip ? ' · ' + esc(r.tip) : ''}</small></div>
      <span class="check ${r.picked ? 'on' : ''}">${icon.check}</span></button>`).join('');
    const c = pending.results.filter(r => r.picked).length;
    $('#saveCount').textContent = c; $('#btnSave').disabled = !c; $('#btnSave').style.opacity = c ? 1 : .4;
  }
  $('#foundList').onclick = e => { const b = e.target.closest('.found-item'); if (!b) return; const r = pending.results[+b.dataset.i]; r.picked = !r.picked; renderFound(); };
  function renderCollChips() {
    $('#collChips').innerHTML = db.collections.map(c => `<button class="cchip ${pending.colls.has(c) ? 'on' : ''}" data-c="${esc(c)}">${esc(c)}</button>`).join('') + `<button class="cchip new" data-new>+ Neue Sammlung</button>`;
  }
  $('#collChips').onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.new !== undefined) { const n = (prompt('Name der Sammlung') || '').trim(); if (n) { if (!db.collections.includes(n)) db.collections.push(n); pending.colls.add(n); save(); } }
    else { const c = b.dataset.c; pending.colls.has(c) ? pending.colls.delete(c) : pending.colls.add(c); }
    renderCollChips();
  };
  $('#btnSave').onclick = () => {
    const picks = pending.results.filter(r => r.picked); if (!picks.length) return;
    let last = null;
    picks.forEach(r => {
      let s = spotById(r.id);
      if (!s) {
        const { picked, ...rest } = r;
        s = { ...rest, fav: false, added: today(), collections: [], sources: [], note: r.tip || '' };
        db.spots.push(s);
      }
      pending.colls.forEach(c => !s.collections.includes(c) && s.collections.push(c));
      if (pending.source.url && !s.sources.some(x => x.url === pending.source.url)) { const p = pending.source; s.sources.push({ url: p.url, platform: p.platform, author: p.author, caption: p.caption || p.title || '', caption_de: p.caption_de || '', hashtags: p.hashtags || [], mentions: p.mentions || [], location: p.location || '', thumb: p.thumb || '' }); }
      last = s;
    });
    db.streak = { day: today(), n: parseInt($('#streak').textContent) || 1 };
    save(); closeSheets(); filter = null; select(last.id);
    toast(`${picks.length} Spot${picks.length > 1 ? 's' : ''} gespeichert`);
  };

  // ---------- Detail ----------
  function openDetail(id) {
    const s = spotById(id); if (!s) return;
    selectedId = id;
    $('#detailHero').style.backgroundImage = s.hero || s.img ? `url("${s.hero || s.img}")` : 'linear-gradient(135deg,#55531a,#c9a45a)';
    $('#dThumb').src = s.img || ''; $('#dThumb').style.visibility = s.img ? 'visible' : 'hidden';
    $('#dName').textContent = s.short;
    $('#dSub').textContent = [s.city, s.country].filter(Boolean).join(', ') || s.region;
    $('#dHours').textContent = s.hours ? `🕒 ${s.hours}` : '';
    $('#dTags').innerHTML = `<span class="tag cat">${CATS[s.cat] || ''} ${esc(dc(s.cat))}</span>` + (s.tags || []).map(t => `<span class="tag">${esc(t)}</span>`).join('');
    const first = (s.desc || '').split(/(?<=[.!?])\s/)[0] || '';
    $('#dTldr').innerHTML = first ? `<b>Kurz gesagt:</b>${esc(first.length > 170 ? first.slice(0, 167) + '…' : first)}` : '';
    $('#dDesc').textContent = (s.desc || '').slice(first.length).trim();
    $('#dNote').value = s.note || '';
    const imgs = [...new Set([s.hero, s.img].filter(Boolean))].concat((s.sources || []).map(x => x.thumb).filter(Boolean));
    $('#dGallery').innerHTML = imgs.map(u => `<img src="${esc(u)}" alt="">`).join('');
    const trips = db.trips.filter(t => t.items.some(i => i.spotId === s.id)).map(t => `✈️ ${esc(t.name)}`);
    $('#dColls').innerHTML = s.collections.map(c => `<span class="cchip on">${esc(c)}</span>`).join('') + trips.map(t => `<span class="cchip">${t}</span>`).join('');
    $('#dPost').innerHTML = (s.sources || []).map(p => `<div class="post"><div class="ph-row">${p.thumb ? `<img src="${esc(p.thumb)}" alt="">` : ''}<div><a href="${esc(p.url)}" target="_blank" rel="noopener">${p.platform === 'instagram' ? '◎' : '♪'} ${esc(p.author || host(p.url))}</a>${p.location ? `<div class="loc">📍 ${esc(p.location)}</div>` : ''}</div></div>${p.caption ? `<p>${esc(p.caption_de || p.caption)}</p>${p.caption_de && p.caption_de !== p.caption ? `<details class="orig"><summary>Original anzeigen</summary><p>${esc(p.caption)}</p></details>` : ''}` : ''}${(p.hashtags || []).length ? `<div class="tags">${p.hashtags.map(h => `<span class="tag">#${esc(h)}</span>`).join('')}</div>` : ''}</div>`).join('');
    $('#dFav').classList.toggle('on', s.fav);
    const src = (s.sources || [])[0];
    $('#dSource').style.display = src ? '' : 'none'; if (src) { $('#dSource').href = src.url; $('#dSource').textContent = (src.platform === 'instagram' || host(src.url).includes('instagram')) ? '◎ Quelle' : '♪ Quelle'; }
    $('#dDirections').href = dirUrl(s);
    openSheet('#sheetDetail');
  }
  $('#dNote').oninput = e => { const s = spotById(selectedId); s.note = e.target.value; save(); };
  $('#dFav').onclick = () => toggleFav(selectedId);
  $('#dOrganise').onclick = () => openOrg(selectedId);
  $('#dShare').onclick = async () => {
    const s = spotById(selectedId); const url = `https://www.openstreetmap.org/?mlat=${s.lat}&mlon=${s.lon}#map=16/${s.lat}/${s.lon}`;
    if (navigator.share) { try { await navigator.share({ title: s.short, text: s.name, url }); } catch { } }
    else { await navigator.clipboard?.writeText(url); toast('Link kopiert'); }
  };
  $('#dEdit').onclick = () => {
    const s = spotById(selectedId);
    const n = prompt('Name ändern', s.short); if (n === null || !n.trim()) return;
    s.short = n.trim(); save(); refresh(); openDetail(s.id);
  };

  // ---------- Organise (Collection / Trip / Remove) ----------
  function openOrg(id) { orgSpot = id; $('#orgMenu').classList.add('open'); $('#scrim').classList.add('on'); }
  $('#orgMenu').onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    $('#orgMenu').classList.remove('open'); syncScrim();
    const s = spotById(orgSpot); if (!s) return;
    if (b.dataset.o === 'coll') pickCollections(s);
    if (b.dataset.o === 'trip') pickTrip(s);
    if (b.dataset.o === 'rm') {
      if (!confirm(`„${s.short}“ wirklich entfernen?`)) return;
      db.spots = db.spots.filter(x => x.id !== s.id); db.trips.forEach(t => t.items = t.items.filter(i => i.spotId !== s.id));
      if (selectedId === s.id) selectedId = null; save(); closeSheets(); refresh(); toast('Spot entfernt');
    }
  };
  function pickCollections(s) {
    openPick('Zu Sammlung hinzufügen', () => db.collections.map(c => ({
      label: c, on: s.collections.includes(c),
      fn: () => { s.collections = s.collections.includes(c) ? s.collections.filter(x => x !== c) : [...s.collections, c]; save(); refreshOpen(s); return false; }
    })).concat([{ label: '+ Neue Sammlung', plus: true, fn: () => { const n = (prompt('Name der Sammlung') || '').trim(); if (n) { if (!db.collections.includes(n)) db.collections.push(n); if (!s.collections.includes(n)) s.collections.push(n); save(); refreshOpen(s); } return false; } }]));
  }
  function pickTrip(s) {
    openPick('Zu Trip hinzufügen', () => db.trips.map(t => {
      const has = t.items.some(i => i.spotId === s.id);
      return { label: t.name, on: has, fn: () => { t.items = has ? t.items.filter(i => i.spotId !== s.id) : [...t.items, { id: uid(), spotId: s.id, day: null, time: '' }]; save(); refreshOpen(s); return false; } };
    }).concat([{ label: '+ Neuer Trip', plus: true, fn: () => { const t = newTrip(); if (t) { t.items.push({ id: uid(), spotId: s.id, day: null, time: '' }); save(); refreshOpen(s); } return false; } }]));
  }
  function refreshOpen(s) { drawPick(); if ($('#sheetDetail').classList.contains('open')) openDetail(s.id); if ($('#sheetLibrary').classList.contains('open')) renderLibrary(); }

  // ---------- Library ----------
  $('#tabLibrary').onclick = () => { libView = { v: 'home' }; libQuery = ''; renderLibrary(); openSheet('#sheetLibrary'); };
  const NAV = [
    ['trips', '✈️', () => `Trips (${db.trips.length})`], ['colls', '🗂', () => `Deine Sammlungen (${db.collections.length})`],
    ['countries', '🗺', () => `Länder (${new Set(db.spots.map(s => s.cc).filter(Boolean)).size})`],
    ['all', '🔖', () => `Alle Spots (${db.spots.length})`], ['favs', '🧡', () => `Favoriten (${db.spots.filter(s => s.fav).length})`]
  ];
  const cover = s => s?.img ? `background-image:url('${esc(s.img)}')` : '';
  function cardHtml(s) { return `<button class="card" data-id="${s.id}" style="${cover(s)}">${s.fav ? '<i>♥</i>' : ''}<span>${esc(s.short)}</span></button>`; }
  function renderLibrary() {
    const head = $('#libHead'), body = $('#libBody');
    const v = libView.v;
    if (v === 'home') {
      head.innerHTML = `<div class="logo small">Mio²</div><input class="lib-search" id="libSearch" placeholder="Suchen" value="${esc(libQuery)}"><button class="round" data-close aria-label="Schließen"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>`;
      head.querySelector('[data-close]').onclick = closeSheets;
      const q = libQuery.trim().toLowerCase();
      if (q) {
        const l = db.spots.filter(s => (s.name + ' ' + (s.city || '') + ' ' + s.cat).toLowerCase().includes(q));
        body.innerHTML = l.length ? `<div class="grid" style="margin-top:14px">${l.map(cardHtml).join('')}</div>` : '<div class="empty big">Nichts gefunden</div>';
      } else {
        const recents = db.spots.slice().reverse().slice(0, 12);
        body.innerHTML = `<div class="lib-nav">${NAV.map(([k, e, t]) => `<button data-nav="${k}"><span class="ico">${e}</span>${t()}${icon.chev}</button>`).join('')}</div>
          <div class="tiles"><button class="tile new" data-newcoll><div class="cv"><span><b>+</b>Neue<br>Sammlung</span></div></button>
          ${db.collections.map(c => { const f = db.spots.find(s => s.collections.includes(c) && s.img); return `<button class="tile" data-coll="${esc(c)}"><div class="cv" style="${cover(f)}"></div>${esc(c)}</button>`; }).join('')}</div>
          <h2 class="sec-t">Zuletzt hinzugefügt</h2>${recents.length ? `<div class="grid">${recents.map(cardHtml).join('')}</div>` : '<div class="empty big">Noch nichts gespeichert. Tippe auf +.</div>'}`;
      }
      const si = $('#libSearch'); si.oninput = e => { libQuery = e.target.value; const pos = e.target.selectionStart; renderLibrary(); const n = $('#libSearch'); n.focus({ preventScroll: true }); n.setSelectionRange(pos, pos); };
      return;
    }
    const titles = { trips: 'Trips', colls: 'Deine Sammlungen', all: 'Alle Spots', favs: 'Favoriten', coll: libView.name };
    head.innerHTML = `<button class="round" id="libBack" aria-label="Zurück"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg></button><div class="sub-title">${esc(titles[v] || '')}</div>${v === 'trips' ? '<button class="btn orange" id="libNewTrip">+ Trip</button>' : ''}`;
    $('#libBack').onclick = () => { libView = v === 'coll' && libView.from === 'colls' ? { v: 'colls' } : { v: 'home' }; renderLibrary(); };
    if (v === 'trips') {
      body.innerHTML = db.trips.map(t => `<button class="lib-row" data-trip="${t.id}"><div class="ph" style="background:var(--soft);display:grid;place-items:center;font-size:22px">✈️</div><div><b>${esc(t.name)}</b><small>${t.items.length} Spots${t.start ? ' · ' + fmtDate(t.start) : ''}</small></div></button>`).join('') || '<div class="empty big">Noch keine Trips.</div>';
      $('#libNewTrip').onclick = () => { const t = newTrip(); if (t) { renderLibrary(); } };
    } else if (v === 'colls') {
      body.innerHTML = db.collections.map(c => `<button class="lib-row" data-coll="${esc(c)}"><div class="ph" style="${cover(db.spots.find(s => s.collections.includes(c) && s.img))}"></div><div><b>${esc(c)}</b><small>${db.spots.filter(s => s.collections.includes(c)).length} Spots</small></div></button>`).join('') || '<div class="empty big">Noch keine Sammlungen.</div>';
    } else {
      const l = v === 'all' ? db.spots : v === 'favs' ? db.spots.filter(s => s.fav) : db.spots.filter(s => s.collections.includes(libView.name));
      body.innerHTML = l.length ? `<div class="grid" style="margin-top:14px">${l.map(cardHtml).join('')}</div>` : '<div class="empty big">Hier ist noch nichts.</div>';
    }
  }
  function newTrip() {
    const name = (prompt('Name des Trips, z. B. „Japan 2026 🍣“') || '').trim(); if (!name) return null;
    const t = { id: uid(), name, start: '', end: '', days: 5, items: [] }; db.trips.push(t); save(); return t;
  }
  $('#libBody').onclick = e => {
    const nav = e.target.closest('[data-nav]');
    if (nav) {
      const k = nav.dataset.nav;
      if (k === 'countries') { if (!db.spots.length) return toast('Noch keine Spots'); closeSheets(); countryMode = true; setRegion('Länder'); map.fitBounds(db.spots.map(s => [s.lat, s.lon]), { padding: [70, 70], maxZoom: 5 }); refresh(); return; }
      libView = { v: k }; renderLibrary(); return;
    }
    if (e.target.closest('[data-newcoll]')) { const n = (prompt('Name der Sammlung') || '').trim(); if (n && !db.collections.includes(n)) { db.collections.push(n); save(); renderLibrary(); } return; }
    const c = e.target.closest('[data-coll]'); if (c) { libView = { v: 'coll', name: c.dataset.coll, from: libView.v }; renderLibrary(); return; }
    const t = e.target.closest('[data-trip]'); if (t) { openTrip(t.dataset.trip); return; }
    const card = e.target.closest('.card'); if (card) { if (card.dataset.held) { delete card.dataset.held; return; } closeSheets(); select(card.dataset.id); openDetail(card.dataset.id); }
  };
  // Long-press -> organise
  let lp = null;
  $('#libBody').addEventListener('pointerdown', e => { const c = e.target.closest('.card'); if (!c) return; lp = setTimeout(() => { c.dataset.held = '1'; if (navigator.vibrate) navigator.vibrate(20); openOrg(c.dataset.id); }, 500); });
  ['pointerup', 'pointermove', 'pointercancel', 'pointerleave'].forEach(ev => $('#libBody').addEventListener(ev, () => clearTimeout(lp)));
  $('#libBody').addEventListener('contextmenu', e => { if (e.target.closest('.card')) e.preventDefault(); });

  // ---------- Trips ----------
  const trip = () => db.trips.find(t => t.id === tripId);
  function dayCount(t) { if (t.start && t.end) { const n = Math.round((new Date(t.end) - new Date(t.start)) / 864e5) + 1; if (n > 0) return Math.min(n, 60); } return t.days || 5; }
  function openTrip(id) { tripId = id; tripTab = 'it'; tripDay = 0; renderTrip(); openSheet('#sheetTrip'); renderTrip(); }
  function clearRoute() { routeLayer?.remove(); routeLayer = null; }
  function drawRoute(pts) {
    clearRoute(); if (!pts.length) return;
    routeLayer = L.layerGroup().addTo(map);
    if (pts.length > 1) L.polyline(pts, { color: '#e2362b', weight: 3, dashArray: '9 8' }).addTo(routeLayer);
    pts.forEach(p => L.circleMarker(p, { radius: 6, color: '#fff', weight: 2, fillColor: '#e2362b', fillOpacity: 1 }).addTo(routeLayer));
    map.fitBounds(pts, { paddingTopLeft: [40, 80], paddingBottomRight: [40, window.innerHeight * 0.55], maxZoom: 14 });
  }
  function renderTrip() {
    const t = trip(); if (!t) return;
    $('#tName').textContent = t.name;
    const cities = [...new Set(t.items.map(i => spotById(i.spotId)?.city).filter(Boolean))];
    $('#tCities').textContent = cities.slice(0, 4).join(', ') || 'Noch keine Orte';
    $('#tStart').value = t.start || ''; $('#tEnd').value = t.end || '';
    $('#tabIt').classList.toggle('on', tripTab === 'it'); $('#tabUn').classList.toggle('on', tripTab === 'un');
    const n = dayCount(t); if (tripDay >= n) tripDay = n - 1;
    const dc = $('#dayChips'); dc.style.display = tripTab === 'it' ? '' : 'none';
    dc.innerHTML = Array.from({ length: n }, (_, i) => `<button class="chip ${i === tripDay ? 'on' : ''}" data-d="${i}">Tag ${i + 1}</button>`).join('') + `<button class="chip" data-d="add">+</button>`;
    const body = $('#tripBody');
    const row = i => {
      const s = spotById(i.spotId);
      if (!i.spotId) return `<div class="ev custom"><div class="tx"><b>${esc(i.title)}</b></div><span class="tm"><input type="time" value="${i.time || ''}" data-time="${i.id}"></span><button class="more" data-more="${i.id}">${icon.dots}</button></div>`;
      if (!s) return '';
      return `<div class="ev"><div class="th" style="${cover(s)}">${s.fav ? '<i>♥</i>' : ''}</div><div class="tx" data-open="${s.id}"><div class="tm"><input type="time" value="${i.time || ''}" data-time="${i.id}"></div><b>${esc(s.short)}</b><small>${CATS[s.cat] || ''} ${esc(dc(s.cat))} • ${esc([s.city, s.country].filter(Boolean).join(', '))}</small></div><button class="more" data-more="${i.id}">${icon.dots}</button></div>`;
    };
    if (tripTab === 'it') {
      const items = t.items.filter(i => i.day === tripDay).sort((a, b) => (a.time || '99') < (b.time || '99') ? -1 : (a.time || '99') > (b.time || '99') ? 1 : 0);
      body.innerHTML = `<div class="addline"><button id="addCustom">+ Eigenen Termin hinzufügen</button></div>` + (items.map(row).join('') || '<div class="empty">Noch nichts für diesen Tag. Plane Spots aus „Unscheduled“ ein.</div>');
      const sp = items.map(i => spotById(i.spotId)).filter(Boolean);
      drawRoute(sp.map(s => [s.lat, s.lon]));
      let u = ''; if (sp.length) { const d = sp[sp.length - 1]; u = `https://www.google.com/maps/dir/?api=1&destination=${d.lat},${d.lon}`; if (sp.length > 1) u += `&origin=${sp[0].lat},${sp[0].lon}` + (sp.length > 2 ? `&waypoints=${sp.slice(1, -1).map(s => s.lat + ',' + s.lon).join('|')}` : ''); }
      u ? $('#tDirections').href = u : $('#tDirections').removeAttribute('href');
    } else {
      const items = t.items.filter(i => i.day === null);
      body.innerHTML = `<div class="addline"><button id="addSpotToTrip">+ Gespeicherten Spot hinzufügen</button></div>` + (items.map(row).join('') || '<div class="empty">Alles eingeplant 🎉</div>');
      drawRoute(t.items.filter(i => i.day !== null).sort((a, b) => a.day - b.day).map(i => spotById(i.spotId)).filter(Boolean).map(s => [s.lat, s.lon]));
      $('#tDirections').removeAttribute('href');
    }
  }
  $('#tabIt').onclick = () => { tripTab = 'it'; renderTrip(); };
  $('#tabUn').onclick = () => { tripTab = 'un'; renderTrip(); };
  $('#btnTripClose').onclick = closeSheets;
  $('#dayChips').onclick = e => {
    const b = e.target.closest('.chip'); if (!b) return; const t = trip();
    if (b.dataset.d === 'add') { t.days = dayCount(t) + 1; if (t.end) t.end = new Date(new Date(t.end).getTime() + 864e5).toISOString().slice(0, 10); tripDay = dayCount(t) - 1; save(); }
    else tripDay = +b.dataset.d;
    renderTrip();
  };
  $('#tStart').onchange = e => { const t = trip(); t.start = e.target.value; if (t.start && (!t.end || t.end < t.start)) t.end = t.start; save(); renderTrip(); };
  $('#tEnd').onchange = e => { const t = trip(); t.end = e.target.value; if (!t.start) t.start = t.end; save(); renderTrip(); };
  $('#tName').onclick = () => { const t = trip(); const n = (prompt('Trip umbenennen', t.name) || '').trim(); if (n) { t.name = n; save(); renderTrip(); } };
  $('#tMenu').onclick = () => openPick('Trip', () => [
    { label: 'Umbenennen', fn: () => { setTimeout(() => $('#tName').click(), 50); } },
    { label: 'Trip löschen', fn: () => { if (!confirm('Trip wirklich löschen?')) return false; db.trips = db.trips.filter(t => t.id !== tripId); save(); closeSheets(); } }
  ]);
  $('#tripBody').addEventListener('change', e => { const id = e.target.dataset.time; if (!id) return; trip().items.find(x => x.id === id).time = e.target.value; save(); renderTrip(); });
  $('#tripBody').addEventListener('click', e => {
    const t = trip();
    if (e.target.closest('#addCustom')) { const title = (prompt('Titel des Events, z. B. „Mala Spa“') || '').trim(); if (title) { t.items.push({ id: uid(), spotId: null, title, day: tripDay, time: '' }); save(); renderTrip(); } return; }
    if (e.target.closest('#addSpotToTrip')) {
      openPick('Spot hinzufügen', () => db.spots.filter(s => !t.items.some(i => i.spotId === s.id)).map(s => ({ label: s.short, sub: dc(s.cat), fn: () => { t.items.push({ id: uid(), spotId: s.id, day: null, time: '' }); save(); renderTrip(); } })));
      return;
    }
    const more = e.target.closest('[data-more]');
    if (more) {
      const it = t.items.find(x => x.id === more.dataset.more); const n = dayCount(t);
      openPick('Termin', () => Array.from({ length: n }, (_, d) => ({ label: `Auf Tag ${d + 1} legen`, fn: () => { it.day = d; save(); renderTrip(); } }))
        .concat([{ label: 'Nicht eingeplant', fn: () => { it.day = null; save(); renderTrip(); } }, { label: 'Entfernen', fn: () => { t.items = t.items.filter(x => x.id !== it.id); save(); renderTrip(); } }]));
      return;
    }
    const open = e.target.closest('[data-open]'); if (open && !e.target.closest('input')) { const id = open.dataset.open; selectedId = id; setRegion(spotById(id).region); refresh(); openDetail(id); }
  });
  $('#btnPlan').onclick = () => {
    const t = trip(); const todo = t.items.filter(i => i.spotId && i.day === null && spotById(i.spotId));
    if (!todo.length) return toast('Keine Spots zum Einplanen');
    // Nearest-Neighbour-Reihenfolge, dann gleichmäßig auf die Tage verteilen
    const left = todo.slice(), ordered = [left.shift()];
    while (left.length) {
      const a = spotById(ordered[ordered.length - 1].spotId); let bi = 0, bd = Infinity;
      left.forEach((i, k) => { const b = spotById(i.spotId); const d = (a.lat - b.lat) ** 2 + (a.lon - b.lon) ** 2; if (d < bd) { bd = d; bi = k; } });
      ordered.push(left.splice(bi, 1)[0]);
    }
    const n = dayCount(t), per = Math.ceil(ordered.length / n);
    ordered.forEach((i, k) => { i.day = Math.min(n - 1, Math.floor(k / per)); });
    save(); tripTab = 'it'; tripDay = 0; renderTrip(); toast('Trip nach Nähe geplant');
  };

  // ---------- Randomize ----------
  $('#tabRandom').onclick = () => { if (!db.spots.length) return toast('Erst ein paar Spots speichern'); rollGroup = 'Any'; renderRoll(); openSheet('#sheetRoll'); };
  const inView = () => { const b = map.getBounds(); const l = db.spots.filter(s => b.contains([s.lat, s.lon])); return l.length ? l : db.spots; };
  function renderRoll() {
    const l = inView();
    $('#rollLoc').textContent = `📍 ${region || 'Überall'} · ${l.length} im Kartenausschnitt`;
    const cnt = g => l.filter(s => GROUPS[g].includes(s.cat)).length;
    $('#rollChips').innerHTML = `<button class="chip ${rollGroup === 'Any' ? 'on' : ''}" data-g="Any">Alle</button>` +
      Object.keys(GROUPS).map(g => `<button class="chip ${rollGroup === g ? 'on' : ''}" data-g="${g}">${GROUPD[g] || g} <small>${cnt(g)}</small></button>`).join('');
  }
  $('#rollChips').onclick = e => { const b = e.target.closest('.chip'); if (!b) return; rollGroup = b.dataset.g; renderRoll(); };
  $('#btnRoll').onclick = () => {
    const l = inView().filter(s => rollGroup === 'Any' || GROUPS[rollGroup].includes(s.cat));
    if (!l.length) return toast('Dafür gibt es hier nichts');
    const sheet = $('#sheetRoll'); sheet.classList.add('rolling');
    setTimeout(() => { sheet.classList.remove('rolling'); const s = l[Math.floor(Math.random() * l.length)]; closeSheets(); select(s.id); openDetail(s.id); toast(`🎲 ${s.short}!`); }, 1100);
  };

  // ---------- Misc ----------
  $('#chips').onclick = e => { const b = e.target.closest('.chip'); if (!b) return; filter = filter === b.dataset.f ? null : b.dataset.f; refresh(); };
  $('#btnLocate').onclick = () => navigator.geolocation?.getCurrentPosition(p => map.flyTo([p.coords.latitude, p.coords.longitude], 15), () => toast('Standort nicht verfügbar'));
  $('#btnSearch').onclick = () => { if (!db.spots.length) return $('#btnAdd').click(); $('#tabLibrary').click(); setTimeout(() => $('#libSearch')?.focus({ preventScroll: true }), 400); };
  $('#btnBack').onclick = () => {
    countryMode = false; selectedId = null; setRegion(null); filter = null;
    if (db.spots.length) map.fitBounds(db.spots.map(s => [s.lat, s.lon]), { padding: [60, 60], maxZoom: 12 });
    refresh();
  };
  document.addEventListener('keydown', e => e.key === 'Escape' && closeSheets());
  window.addEventListener('resize', positionTools);

  // bereits gespeicherte Spots nach und nach auf Deutsch umstellen
  (async function localizeOld() {
    for (const sp of db.spots) {
      if (sp.dl) continue;
      try {
        await enrich(sp);
        await sleep(1100);
        const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=14&addressdetails=1&accept-language=de&lat=${sp.lat}&lon=${sp.lon}`);
        const a = (await r.json()).address || {};
        if (a.country) { sp.country = a.country; sp.name = `${sp.short}, ${a.country}`; }
        sp.city = a.city || a.town || a.village || a.municipality || a.county || sp.city;
        sp.region = a.state || a.region || a.county || a.country || sp.region;
        sp.tags = (sp.tags || []).map(tagDe);
        for (const so of sp.sources || []) if (so.caption && !so.caption_de && !isGerman(so.caption)) so.caption_de = await toDe(so.caption);
        sp.dl = 1; save(); refresh();
      } catch { }
    }
  })();
  refresh();
  if (db.spots.length) { const s = db.spots[db.spots.length - 1]; map.setView([s.lat, s.lon], 13); setRegion(s.region); }
  setTimeout(() => { map.invalidateSize(); positionTools(); }, 100);
  // Android-Teilen-Menü: geteilter Text/Link landet direkt im Finden-Dialog
  window.MioShare = t => { $('#btnAdd').click(); $('#addInput').value = String(t || '').trim(); startFind(); };
})();
