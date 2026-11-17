/* Mio² – Link-Leser im Browser/der Android-App (Port von server.py).
   Holt TikTok-/Instagram-Seiten über den nativen Proxy (/proxy?url=…, nur Android)
   und erkennt Orte per Heuristik. Wird nur benutzt, wenn window.MioNative existiert. */
(function () {
  const GENERIC = new Set('fyp foryou foryoupage viral trending reels reel tiktok explore travel travelgram instagood love follow like photooftheday travelling traveltok traveltiktok wanderlust vacation holiday food foodie foodtok fy xyzbca capcut tiktoktravel tips hiddengem hiddengems mustvisit'.split(' '));
  const CATS = ['Attraction', 'Restaurant', 'Cafe', 'Bar', 'Hotel', 'Nature', 'Shopping'];
  const EMOJI = /[\u{1F300}-\u{1FAFF}☀-➿️]/gu;
  const CAPW = "[A-ZÀ-Ý][\\wÀ-ÿ'’-]+";
  const KW = '(?:Beach|Strand|Bay|Cafe|Café|Coffee|Restaurant|Bar|Pub|Hotel|Hostel|Resort|Park|Museum|Temple|Tempel|Falls|Waterfall|Lake|See|Castle|Schloss|Burg|Market|Markt|Palace|Cathedral|Church|Kirche|Bridge|Brücke|Tower|Turm|Island|Insel|Garden|Playa|Mirador|Mercado|Bistro|Bakery|Pizzeria|Trattoria|Viewpoint|Cave|Canyon|Mountain|Berg|Pass|Pier|Fort|Zoo)';
  const NAMEP = `(${CAPW}(?:\\s+(?:de|del|della|di|da|of|the|la|le|el|y|&|am|im|von|${CAPW})){0,4}(?:\\s+${CAPW})*)`;

  const proxy = (url, accept) => fetch('/proxy?url=' + encodeURIComponent(url) + (accept ? '&accept=' + encodeURIComponent(accept) : ''));
  const uniq = a => [...new Set(a)];
  const hashtags = t => uniq([...(t || '').matchAll(/#([\wÀ-ɏ]+)/g)].map(m => m[1]));
  const mentions = t => uniq([...(t || '').matchAll(/@([\w.]+)/g)].map(m => m[1]));
  const unesc = s => { const d = document.createElement('textarea'); d.innerHTML = s; return d.value; };
  function meta(doc, prop) {
    const e = prop.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = doc.match(new RegExp(`<meta[^>]+(?:property|name)=["']${e}["'][^>]*content=["']([^"']*)["']`, 'i')) ||
      doc.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${e}["']`, 'i'));
    return m ? unesc(m[1]).trim() : '';
  }
  function findKey(o, key, d = 0) {
    if (d > 12 || !o || typeof o !== 'object') return null;
    if (!Array.isArray(o) && o[key]) return o[key];
    for (const v of (Array.isArray(o) ? o.slice(0, 50) : Object.values(o))) { const r = findKey(v, key, d + 1); if (r) return r; }
    return null;
  }

  async function tiktok(url) {
    const out = { platform: 'tiktok', url, author: '', caption: '', thumb: '', location: '', hashtags: [] };
    try {
      const j = await (await proxy('https://www.tiktok.com/oembed?url=' + encodeURIComponent(url), 'application/json')).json();
      out.caption = j.title || '';
      out.author = j.author_unique_id ? '@' + j.author_unique_id : (j.author_name || '');
      out.thumb = j.thumbnail_url || '';
    } catch { }
    try {
      const doc = await (await proxy(url)).text();
      const m = doc.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/);
      if (m) {
        const item = findKey(JSON.parse(m[1]), 'itemStruct') || {};
        if (item.desc) out.caption = item.desc;
        if (item.author && item.author.uniqueId) out.author = '@' + item.author.uniqueId;
        const poi = item.poi || findKey(item, 'poi') || {};
        if (poi && typeof poi === 'object') {
          out.location = poi.name || poi.poiName || '';
          out.location_context = [poi.cityName || poi.city, poi.countryName || poi.country].filter(Boolean).join(', ');
        }
        out.hashtags = (item.textExtra || []).map(t => t.hashtagName).filter(Boolean);
        if (!out.thumb) out.thumb = (item.video || {}).cover || '';
      }
      if (!out.caption) out.caption = meta(doc, 'og:description') || meta(doc, 'og:title');
      if (!out.thumb) out.thumb = meta(doc, 'og:image');
    } catch { }
    return out;
  }

  async function instagram(url) {
    const out = { platform: 'instagram', url, author: '', caption: '', thumb: '', location: '', hashtags: [] };
    try {
      const doc = await (await proxy(url)).text();
      const title = meta(doc, 'og:title'), desc = meta(doc, 'og:description');
      let m = desc.match(/-\s+([\w.]+)\s+on\s+[^:]+:\s*["“]([\s\S]*)["”]\.?\s*$/);
      if (m) { out.author = '@' + m[1]; out.caption = m[2]; }
      else if ((m = title.match(/^(.*?) on Instagram:\s*["“]([\s\S]*)["”]\s*$/))) { out.author = '@' + m[1].trim(); out.caption = m[2]; }
      else out.caption = desc || title;
      out.thumb = meta(doc, 'og:image');
      const l = doc.match(/"location"\s*:\s*\{[^{}]*?"name"\s*:\s*"((?:[^"\\]|\\.)+)"/);
      if (l) { try { out.location = JSON.parse('"' + l[1] + '"'); } catch { out.location = l[1]; } }
    } catch { }
    out.caption = unesc(out.caption);
    out.needs_text = !out.caption;
    return out;
  }

  const cleanName = s => {
    s = s.replace(EMOJI, '').split(/\s[-–—|:]\s|\s\(|:\s/)[0];
    return s.replace(/^[\s\d.)\-•*#@]+/, '').replace(/^[\s.,;!?"'“”]+|[\s.,;!?"'“”]+$/g, '');
  };

  function candidates(info) {
    const cap = info.caption || '', out = [], seen = new Set();
    const add = (name, conf, extra) => {
      name = name.trim(); const k = name.toLowerCase();
      if (name.length > 2 && name.length <= 70 && !seen.has(k)) { seen.add(k); out.push({ name, conf, ...extra }); }
    };
    if (info.location) add(info.location, 'high', { context: info.location_context || '' });
    for (const line of cap.split(/\r?\n/)) {
      if (/[📍📌🗺🏨🍽🍴☕🍸🍷🏖⛰]/u.test(line) || /^\s*(\d+[.)]|[•\-*])\s+\S/.test(line)) {
        if (/📍|📌|🗺/u.test(line)) add(cleanName(line.split(/📍|📌|🗺/u).slice(1).join(' ')), 'high');
        else add(cleanName(line), 'medium');
      }
    }
    for (const t of (info.hashtags || []).slice(0, 10)) {
      if (GENERIC.has(t.toLowerCase()) || t.length < 4) continue;
      add(t.replace(/([a-z])(?=[A-Z])/g, '$1 '), 'low');
      if (out.length > 12) break;
    }
    const text = cap.replace(/https?:\/\/\S+|[#@][\w.]+/g, ' ');
    for (const m of text.matchAll(new RegExp(`\\b(?:in|at|im|bei|nach|near|en|à)\\s+${NAMEP}`, 'g'))) {
      const w = m[1].trim();
      if (['The', 'This', 'My', 'Our', 'Der', 'Die', 'Das'].includes(w.split(/\s+/)[0])) continue;
      add(w, 'medium');
      if (!info.location_context) info.location_context = w;
    }
    for (const m of text.matchAll(new RegExp(`\\b${NAMEP}`, 'g'))) {
      const w = m[1].trim();
      if (new RegExp(`\\b${KW}\\b`).test(w)) add(w, 'medium');
      else if (w.split(/\s+/).length >= 2) add(w, 'low');
    }
    for (const m of text.matchAll(new RegExp(`\\b((?:${CAPW}\\s+)+${KW}|${KW}(?:\\s+${CAPW})+)\\b`, 'g'))) add(m[1].trim(), 'medium');
    return out.slice(0, 12);
  }

  async function embedThumb(url) {
    if (!url) return '';
    try {
      const b = await (await proxy(url, 'image/*')).blob();
      if (!b.type.startsWith('image/') || b.size > 450000) return url;
      return await new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(b); });
    } catch { return url; }
  }

  window.MioResolve = async function (url, text) {
    const host = new URL(url).hostname;
    if (!/(tiktok\.com|instagram\.com|instagr\.am)$/.test(host)) throw new Error('Nur TikTok- und Instagram-Links werden unterstützt.');
    url = url.replace(/^http:/, 'https:');
    const info = /instagram|instagr\.am/.test(host) ? await instagram(url) : await tiktok(url);
    if (text && !info.caption) { info.caption = text.slice(0, 6000); info.needs_text = false; info.caption_from_user = true; }
    info.hashtags = uniq([...(info.hashtags || []), ...hashtags(info.caption)]);
    info.mentions = mentions(info.caption);
    info.ai = false;
    info.candidates = candidates(info);
    info.thumb = await embedThumb(info.thumb);
    return info;
  };
  void CATS;
})();

// Android: Tippen auf den Avatar sucht nach App-Updates (und zeigt die Version)
document.addEventListener("DOMContentLoaded", () => {
  const a = document.getElementById("avatar");
  if (a && window.MioNative) { a.title = "Mio² " + MioNative.version(); a.onclick = () => MioNative.checkUpdate(); }
});
