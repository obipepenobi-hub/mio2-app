#!/usr/bin/env python3
"""Mio² Server: liefert die App aus und löst TikTok-/Instagram-Links auf.

Start:   python server.py            (http://127.0.0.1:5183)
         python server.py 8080 0.0.0.0   (Port, Host)

Optional: ANTHROPIC_API_KEY setzen -> Orte werden per Claude aus Beschreibung,
Hashtags und Standort-Tag extrahiert (deutlich genauer als die Heuristik).
"""
import html, http.server, ipaddress, json, os, re, socket, sys, urllib.parse, urllib.request, base64

ROOT = os.path.dirname(os.path.abspath(__file__))
ALLOWED = ('tiktok.com', 'instagram.com', 'instagr.am', 'cdninstagram.com', 'fbcdn.net',
           'tiktokcdn.com', 'tiktokcdn-us.com', 'tiktokv.com', 'tiktokv.us', 'byteimg.com', 'ibyteimg.com', 'ibytedtos.com')
UA = 'Mio2-LinkReader/1.0 (personal travel notes app)'
GENERIC_TAGS = {'fyp', 'foryou', 'foryoupage', 'viral', 'trending', 'reels', 'reel', 'tiktok', 'explore', 'travel', 'travelgram', 'instagood',
                'love', 'follow', 'like', 'photooftheday', 'travelling', 'traveltok', 'traveltiktok', 'wanderlust', 'vacation', 'holiday',
                'food', 'foodie', 'foodtok', 'fy', 'xyzbca', 'capcut', 'tiktoktravel', 'tips', 'hiddengem', 'hiddengems', 'mustvisit'}
CATS = ['Attraction', 'Restaurant', 'Cafe', 'Bar', 'Hotel', 'Nature', 'Shopping']


def host_ok(host):
    host = (host or '').lower().split(':')[0]
    if re.fullmatch(r'([\w-]+\.)*tiktokcdn[\w-]*\.com', host):
        return True
    return any(host == d or host.endswith('.' + d) for d in ALLOWED)


def public_ip(host):
    try:
        for fam, _, _, _, sa in socket.getaddrinfo(host, None):
            ip = ipaddress.ip_address(sa[0])
            if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast:
                return False
        return True
    except Exception:
        return False


class SafeRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        u = urllib.parse.urlparse(newurl)
        if u.scheme != 'https' or not host_ok(u.hostname) or not public_ip(u.hostname):
            raise urllib.error.URLError('redirect target not allowed')
        return super().redirect_request(req, fp, code, msg, headers, newurl)


OPENER = urllib.request.build_opener(SafeRedirect)


def fetch(url, ua=UA, accept='text/html,*/*', limit=3_000_000, timeout=15):
    u = urllib.parse.urlparse(url)
    if u.scheme != 'https' or not host_ok(u.hostname) or not public_ip(u.hostname):
        raise ValueError('URL nicht erlaubt')
    req = urllib.request.Request(url, headers={'User-Agent': ua, 'Accept': accept, 'Accept-Language': 'en-US,en;q=0.9'})
    with OPENER.open(req, timeout=timeout) as r:
        return r.read(limit), r.geturl(), r.headers.get('Content-Type', '')


def meta(doc, prop):
    for pat in (r'<meta[^>]+(?:property|name)=["\']%s["\'][^>]*content=["\']([^"\']*)["\']',
                r'<meta[^>]+content=["\']([^"\']*)["\'][^>]*(?:property|name)=["\']%s["\']'):
        m = re.search(pat % re.escape(prop), doc, re.I)
        if m:
            return html.unescape(m.group(1)).strip()
    return ''


def jstr(s):
    try:
        return json.loads('"' + s + '"')
    except Exception:
        return s


def find_key(obj, key, depth=0):
    if depth > 12:
        return None
    if isinstance(obj, dict):
        if key in obj and obj[key]:
            return obj[key]
        for v in obj.values():
            r = find_key(v, key, depth + 1)
            if r:
                return r
    elif isinstance(obj, list):
        for v in obj[:50]:
            r = find_key(v, key, depth + 1)
            if r:
                return r
    return None


def hashtags(text):
    return list(dict.fromkeys(re.findall(r'#([\wÀ-ɏ]+)', text or '')))


def mentions(text):
    return list(dict.fromkeys(re.findall(r'@([\w.]+)', text or '')))


# ---------- Plattformen ----------
def tiktok(url):
    out = {'platform': 'tiktok', 'url': url, 'author': '', 'caption': '', 'thumb': '', 'location': '', 'hashtags': []}
    try:  # oEmbed (zuverlässig für Titel/Autor/Thumbnail)
        raw, _, _ = fetch('https://www.tiktok.com/oembed?url=' + urllib.parse.quote(url, safe=''), accept='application/json')
        j = json.loads(raw)
        out['caption'] = j.get('title', '')
        out['author'] = '@' + j['author_unique_id'] if j.get('author_unique_id') else j.get('author_name', '')
        out['thumb'] = j.get('thumbnail_url', '')
        out['url'] = url
    except Exception as e:
        out['oembed_error'] = str(e)[:120]
    try:  # Seite: Standort-Tag (POI), vollständige Beschreibung, Hashtags
        raw, final, _ = fetch(url)
        doc = raw.decode('utf-8', 'ignore')
        out['url'] = final.split('?')[0] if 'tiktok.com' in final else url
        m = re.search(r'<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>(.*?)</script>', doc, re.S)
        if m:
            data = json.loads(m.group(1))
            item = find_key(data, 'itemStruct') or {}
            if item.get('desc'):
                out['caption'] = item['desc']
            a = item.get('author') or {}
            if a.get('uniqueId'):
                out['author'] = '@' + a['uniqueId']
            poi = item.get('poi') or find_key(item, 'poi') or {}
            if isinstance(poi, dict):
                name = poi.get('name') or poi.get('poiName') or ''
                extra = ', '.join(x for x in (poi.get('cityName') or poi.get('city'), poi.get('countryName') or poi.get('country')) if x)
                out['location'] = name
                out['location_context'] = extra
                out['poi_address'] = poi.get('address') or ''
            tags = [t.get('hashtagName') for t in item.get('textExtra', []) if t.get('hashtagName')]
            out['hashtags'] = tags
            if not out['thumb']:
                out['thumb'] = (item.get('video') or {}).get('cover', '')
        if not out['caption']:
            out['caption'] = meta(doc, 'og:description') or meta(doc, 'og:title')
        if not out['thumb']:
            out['thumb'] = meta(doc, 'og:image')
    except Exception as e:
        out['page_error'] = str(e)[:120]
    return out


def instagram(url):
    out = {'platform': 'instagram', 'url': url, 'author': '', 'caption': '', 'thumb': '', 'location': '', 'hashtags': []}
    token = os.environ.get('INSTAGRAM_OEMBED_TOKEN')  # "APP_ID|CLIENT_TOKEN" einer Meta-App (oEmbed Read)
    if token:
        try:
            raw, _, _ = fetch('https://graph.facebook.com/v19.0/instagram_oembed?omitscript=true&url=%s&access_token=%s'
                              % (urllib.parse.quote(url, safe=''), urllib.parse.quote(token, safe='|')), accept='application/json')
            j = json.loads(raw)
            out['author'] = '@' + j.get('author_name', '') if j.get('author_name') else ''
            out['caption'] = html.unescape(re.sub(r'<[^>]+>', ' ', j.get('title') or '')).strip()
            out['thumb'] = j.get('thumbnail_url', '')
        except Exception as e:
            out['oembed_error'] = str(e)[:120]
    if not out['caption']:
        try:  # normale Seite (ohne Login oft nur Teilinfos oder gar nichts)
            raw, final, _ = fetch(url)
            doc = raw.decode('utf-8', 'ignore')
            title, desc = meta(doc, 'og:title'), meta(doc, 'og:description')
            m = re.search(r'-\s+([\w.]+)\s+on\s+[^:]+:\s*["“](.*)["”]\.?\s*$', desc, re.S)
            if m:
                out['author'] = '@' + m.group(1); out['caption'] = m.group(2)
            else:
                m2 = re.search(r'^(.*?) on Instagram:\s*["“](.*)["”]\s*$', title, re.S)
                if m2:
                    out['author'] = '@' + m2.group(1).strip(); out['caption'] = m2.group(2)
                else:
                    out['caption'] = desc or title
            out['thumb'] = out['thumb'] or meta(doc, 'og:image')
            for pat in (r'"location"\s*:\s*\{[^{}]*?"name"\s*:\s*"((?:[^"\\]|\\.)+)"', r'"locationName"\s*:\s*"((?:[^"\\]|\\.)+)"'):
                m = re.search(pat, doc)
                if m:
                    out['location'] = jstr(m.group(1)); break
        except Exception as e:
            out['page_error'] = str(e)[:120]
    out['caption'] = html.unescape(out['caption'])
    out['needs_text'] = not out['caption']
    return out


# ---------- Orte erkennen ----------
EMOJI = r'[\U0001F300-\U0001FAFF☀-➿️]'


def clean_name(s):
    s = re.sub(EMOJI, '', s)
    s = re.split(r'\s[-–—|:]\s|\s\(|:\s', s)[0]
    s = re.sub(r'^[\s\d.)\-•*#@]+', '', s)
    return s.strip(' .,;!?"\'“”')


def heuristic_candidates(info):
    cap = info.get('caption', '')
    out, seen = [], set()

    def add(name, conf, **kw):
        name = name.strip()
        k = name.lower()
        if 2 < len(name) <= 70 and k not in seen:
            seen.add(k); out.append({'name': name, 'conf': conf, **kw})
    if info.get('location'):
        add(info['location'], 'high', context=info.get('location_context', ''))
    for line in cap.splitlines():
        if re.search('[📍📌🗺🏨🍽🍴☕🍸🍷🏖⛰]', line) or re.match(r'^\s*(\d+[.)]|[•\-*])\s+\S', line):
            if re.search('📍|📌|🗺', line):
                n = clean_name(re.split('📍|📌|🗺', line, 1)[1])
                add(n, 'high')
            else:
                add(clean_name(line), 'medium')
    for t in info.get('hashtags', [])[:10]:
        if t.lower() in GENERIC_TAGS or len(t) < 4:
            continue
        spaced = re.sub(r'(?<=[a-z])(?=[A-Z])', ' ', t)
        add(spaced, 'low')
        if len(out) > 12:
            break
    # Fließtext: Hashtags/Mentions/Links entfernen, dann Namen suchen
    text = re.sub(r'https?://\S+|[#@][\w.]+', ' ', cap)
    cap_word = r'[A-ZÀ-Ý][\wÀ-ÿ\'’-]+'
    name_pat = r'(%s(?:\s+(?:de|del|della|di|da|of|the|la|le|el|y|&|am|im|von|%s)){0,4}(?:\s+%s)*)' % (cap_word, cap_word, cap_word)
    kw = (r'(?:Beach|Strand|Bay|Cafe|Café|Coffee|Restaurant|Bar|Pub|Hotel|Hostel|Resort|Park|Museum|Temple|Tempel|Falls|Waterfall|'
          r'Lake|See|Castle|Schloss|Burg|Market|Markt|Palace|Cathedral|Church|Kirche|Bridge|Brücke|Tower|Turm|Island|Insel|Garden|'
          r'Playa|Mirador|Mercado|Bistro|Bakery|Pizzeria|Trattoria|Viewpoint|Cave|Canyon|Mountain|Berg|Pass|Pier|Fort|Zoo)')
    # Stadt/Land-Kontext: "in Lisbon", "at Cafe X", "nach Rom"
    for m in re.finditer(r'(?:\b(?:in|at|im|bei|nach|near|en|à)\s+)' + name_pat, text):
        w = m.group(1).strip()
        if w.split()[0] in ('The', 'This', 'My', 'Our', 'Der', 'Die', 'Das'):
            continue
        add(w, 'medium')
        if not info.get('location_context'):
            info['location_context'] = w
    for m in re.finditer(name_pat, text):
        w = m.group(1).strip()
        words = w.split()
        if re.search(r'\b' + kw + r'\b', w):
            add(w, 'medium')
        elif len(words) >= 2:
            add(w, 'low')
    # einzelne Stichwort-Orte: "Pink Beach", "Cafe Central"
    for m in re.finditer(r'\b((?:%s\s+)+%s|%s(?:\s+%s)+)\b' % (cap_word, kw, kw, cap_word), text):
        add(m.group(1).strip(), 'medium')
    return out[:12]


def ai_candidates(info):
    key = os.environ.get('ANTHROPIC_API_KEY')
    if not key:
        return None
    prompt = (
        'Aus diesem Social-Media-Post (Reel/TikTok) sollst du ALLE konkreten, besuchbaren Orte extrahieren '
        '(Sehenswürdigkeiten, Restaurants, Cafés, Bars, Hotels, Natur, Läden, Städte nur wenn kein genauerer Ort genannt wird). '
        'Antworte NUR mit einem JSON-Array. Jedes Element: {"name": offizieller Ortsname, "city": Stadt, "country": Land, '
        '"category": eine von %s, "note": kurzer Tipp aus dem Text oder ""}. Nichts erfinden.\n\n'
        'Beschreibung:\n%s\n\nStandort-Tag: %s\nHashtags: %s\nAutor: %s'
        % (', '.join(CATS), info.get('caption', '')[:4000], info.get('location', ''), ' '.join(info.get('hashtags', [])), info.get('author', '')))
    body = json.dumps({'model': os.environ.get('MIO_MODEL', 'claude-sonnet-5-5'), 'max_tokens': 1500, 'messages': [{'role': 'user', 'content': prompt}]}).encode()
    req = urllib.request.Request('https://api.anthropic.com/v1/messages', data=body, method='POST',
                                 headers={'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=40) as r:
            txt = ''.join(b.get('text', '') for b in json.load(r)['content'])
        arr = json.loads(re.search(r'\[.*\]', txt, re.S).group(0))
        res = []
        for p in arr[:12]:
            if isinstance(p, dict) and p.get('name'):
                res.append({'name': str(p['name']), 'conf': 'ai', 'context': ', '.join(x for x in (p.get('city'), p.get('country')) if x),
                            'category': p.get('category') if p.get('category') in CATS else '', 'note': p.get('note', '')})
        return res
    except Exception as e:
        print('AI-Extraktion fehlgeschlagen:', e)
        return None


def embed_thumb(url):
    if not url:
        return ''
    try:
        raw, _, ctype = fetch(url, accept='image/*', limit=600_000, timeout=12)
        if len(raw) < 450_000 and ctype.startswith('image/'):
            return 'data:%s;base64,%s' % (ctype.split(';')[0], base64.b64encode(raw).decode())
    except Exception:
        pass
    return url


def resolve(url, text=''):
    u = urllib.parse.urlparse(url)
    if u.scheme not in ('http', 'https') or not host_ok(u.hostname):
        raise ValueError('Nur TikTok- und Instagram-Links werden unterstützt.')
    url = url.replace('http://', 'https://', 1)
    info = instagram(url) if 'instagram.com' in u.hostname or 'instagr.am' in u.hostname else tiktok(url)
    if text and not info.get('caption'):
        info['caption'] = text[:6000]; info['needs_text'] = False; info['caption_from_user'] = True
    info['hashtags'] = list(dict.fromkeys((info.get('hashtags') or []) + hashtags(info.get('caption', ''))))
    info['mentions'] = mentions(info.get('caption', ''))
    ai = ai_candidates(info)
    info['ai'] = ai is not None
    info['candidates'] = ai if ai else heuristic_candidates(info)
    if info.get('location') and not any(c['name'].lower() == info['location'].lower() for c in info['candidates']):
        info['candidates'].insert(0, {'name': info['location'], 'conf': 'high', 'context': info.get('location_context', '')})
    info['thumb'] = embed_thumb(info.get('thumb'))
    return info


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=ROOT, **k)

    def do_GET(self):
        p = urllib.parse.urlparse(self.path)
        if p.path == '/api/resolve':
            q = urllib.parse.parse_qs(p.query)
            try:
                data = resolve((q.get('url') or [''])[0].strip(), (q.get('text') or [''])[0])
                code = 200
            except Exception as e:
                data, code = {'error': str(e)}, 400
            body = json.dumps(data, ensure_ascii=False).encode()
            self.send_response(code)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if p.path == '/api/ping':
            body = b'{"ok":true}'
            self.send_response(200); self.send_header('Content-Type', 'application/json'); self.send_header('Content-Length', str(len(body))); self.end_headers(); self.wfile.write(body)
            return
        super().do_GET()

    def log_message(self, fmt, *args):
        pass


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5183
    host = sys.argv[2] if len(sys.argv) > 2 else '127.0.0.1'
    print(f'Mio² läuft auf http://{host}:{port}  (KI-Extraktion: {"an" if os.environ.get("ANTHROPIC_API_KEY") else "aus – setze ANTHROPIC_API_KEY"})')
    http.server.ThreadingHTTPServer((host, port), Handler).serve_forever()
