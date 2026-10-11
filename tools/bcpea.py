"""Daily update of bailiff (ЧСИ) public property sales for the Varna court region.

Reads https://sales.bcpea.org/properties?court=3 (robots.txt allows it; /upload/ is not fetched),
opens only listings it has not seen before, and keeps facts only: type, area, price, dates, place,
bailiff, cadastral ids found in the text, and links to the original. The free-text description is
read to find cadastral ids and УПИ/кв. numbers, but is never stored: it can name debtors.

Usage: python3 tools/bcpea.py data/auctions.json
Standard library only, so it runs on GitHub Actions as is.
"""
import html
import json
import os
import re
import sys
import time
import urllib.request
from datetime import date, datetime
from zoneinfo import ZoneInfo

BASE = 'https://sales.bcpea.org'
COURT = 3  # Окръжен съд Варна
UA = 'parceli-varna/1.0 (+https://kalinvasilev.github.io/parceli-varna/)'
PAUSE = 1.5  # seconds between requests
CAD_RE = re.compile(r'(?<![\d.])(\d{5})\.(\d{1,5})\.(\d{1,4})((?:\.\d{1,3}){0,2})(?![\d])')
SOFIA = ZoneInfo('Europe/Sofia')  # GitHub runners use UTC
TODAY = datetime.now(SOFIA).date().isoformat()


def get(url):
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept-Language': 'bg'})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read().decode('utf-8', 'replace')
        except Exception:
            if attempt == 2:
                raise
            time.sleep(5 * (attempt + 1))


def text(fragment):
    return re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', fragment))).strip()


def money(s):
    s = s.replace('\xa0', ' ')
    m = re.search(r'([\d\s]+(?:[.,]\d+)?)', s)
    return float(m.group(1).replace(' ', '').replace(',', '.')) if m else None


def bg_date(s):
    m = re.search(r'(\d{2})\.(\d{2})\.(\d{4})', s or '')
    return f'{m.group(3)}-{m.group(2)}-{m.group(1)}' if m else None


def list_ids():
    ids, page, last = [], 1, 1
    while page <= last:
        t = get(f'{BASE}/properties?perpage=36&court={COURT}&p={page}')
        if page == 1:
            pages = [int(x) for x in re.findall(r'court=%d&amp;p=(\d+)' % COURT, t)]
            last = max(pages) if pages else 1
        for i in re.findall(r'href="/properties/(\d+)"', t):
            if i not in ids:
                ids.append(i)
        page += 1
        time.sleep(PAUSE)
    return ids


MONTHS = {'януари': 1, 'февруари': 2, 'март': 3, 'април': 4, 'май': 5, 'юни': 6, 'юли': 7,
          'август': 8, 'септември': 9, 'октомври': 10, 'ноември': 11, 'декември': 12}


def parse_listing(pid, t):
    fields = {}
    for label, info in re.findall(r'<div class="label">(.*?)</div>\s*<div class="info">(.*?)</div>\s*</div>', t, re.S):
        fields[text(label).upper()] = info
    get_f = lambda k: text(fields.get(k, ''))
    title = re.search(r'<div class="title">(.*?)</div>', t, re.S)
    published = re.search(r'Публикувано на (\d{1,2}) (\S+) (\d{4})', text(t))
    prices = re.search(r'<div class="price">(.*?)</div>(?:\s*<div class="price--alternative">(.*?)</div>)?', t, re.S)
    period = get_f('СРОК')
    desc = text(fields.get('ОПИСАНИЕ', ''))
    cad = []
    for m in CAD_RE.finditer(desc + ' ' + get_f('АДРЕС')):
        full = '.'.join(x for x in m.group(1, 2, 3)) + (m.group(4) or '')
        if full not in cad:
            cad.append(full)
    plots = []
    for c in cad:
        p = '.'.join(c.split('.')[:3])
        if p not in plots:
            plots.append(p)
    upi = re.search(r'(?:УПИ|урегулиран поземлен имот)\s+([IVXLCDMХ]+(?:\s*[-–]\s*[\d,\s]+)?)', desc, re.I)
    kv = re.search(r'кв(?:артал)?\.?\s*(\d+)', desc)
    first_price = text(prices.group(1)) if prices else ''
    alt_price = text(prices.group(2)) if prices and prices.group(2) else ''
    eur = money(first_price) if 'EUR' in first_price or '€' in first_price else (money(alt_price) if 'EUR' in alt_price else None)
    bgn = money(first_price) if 'лв' in first_price else (money(alt_price) if 'лв' in alt_price else None)
    pdfs = [BASE + h for h in re.findall(r'href="(/upload/[^"]+\.pdf)"', fields.get('СКАНИРАНИ ОБЯВЛЕНИЯ', ''), re.I)]
    images = len(re.findall(r'class="item-image"', t))
    return {
        'id': pid,
        'url': f'{BASE}/properties/{pid}',
        'type': text(title.group(1)) if title else '',
        'published': f'{published.group(3)}-{MONTHS.get(published.group(2).lower(), 1):02d}-{int(published.group(1)):02d}' if published else None,
        'price_eur': eur,
        'price_bgn': bgn,
        'area_m2': money(get_f('ПЛОЩ')) if get_f('ПЛОЩ') else None,
        'settlement': get_f('НАСЕЛЕНО МЯСТО'),
        'address': get_f('АДРЕС'),
        'district': get_f('КВАРТАЛ') or None,
        'construction': get_f('ТИП СТРОИТЕЛСТВО') or None,
        'floor': get_f('ЕТАЖ') or None,
        'bailiff': get_f('ЧАСТЕН СЪДЕБЕН ИЗПЪЛНИТЕЛ'),
        'period_from': bg_date(period.split('до')[0]) if period else None,
        'period_to': bg_date(period.split('до')[-1]) if 'до' in period else None,
        'announce': bg_date(get_f('ОБЯВЯВАНЕ НА')),
        'announce_time': (re.search(r'\d{1,2}:\d{2}', get_f('ОБЯВЯВАНЕ НА')) or [None])[0],
        'cad_ids': cad,
        'plot_ids': plots,
        'upi': upi.group(1).strip() if upi else None,
        'kv': kv.group(1) if kv else None,
        'pdfs': pdfs,
        'images': images,
    }


def same_property(a, b):
    if set(a['plot_ids']) & set(b['plot_ids']):
        return True
    return (not a['plot_ids'] and not b['plot_ids'] and a['type'] == b['type'] and a['area_m2'] == b['area_m2']
            and a['address'] == b['address'] and a['address'])


def main(path):
    store = {'updated': None, 'listings': {}}
    if os.path.exists(path):
        store = json.load(open(path, encoding='utf-8'))
    listings = store['listings']
    current = list_ids()
    print(f'{len(current)} listings on the site', flush=True)
    new = 0
    for pid in current:
        if pid in listings:
            listings[pid]['last_seen'] = TODAY
            listings[pid].pop('removed', None)
            continue
        time.sleep(PAUSE)
        try:
            rec = parse_listing(pid, get(f'{BASE}/properties/{pid}'))
        except Exception as e:  # one bad listing must not stop the run
            print(f'skip {pid}: {e}', flush=True)
            continue
        rec['first_seen'] = rec['last_seen'] = TODAY
        # An earlier sale of the same property (bailiffs re-offer unsold property, usually cheaper).
        earlier = [o for o in listings.values() if o['id'] != pid and same_property(rec, o)]
        if earlier:
            prev = max(earlier, key=lambda o: o.get('announce') or '')
            rec['previous_id'] = prev['id']
            if prev.get('price_eur') and rec.get('price_eur'):
                rec['price_change_pct'] = round(100 * (rec['price_eur'] - prev['price_eur']) / prev['price_eur'], 1)
        listings[pid] = rec
        new += 1
    for pid, rec in listings.items():
        if pid not in current and not rec.get('removed'):
            rec['removed'] = TODAY
    store['updated'] = datetime.now(SOFIA).strftime('%Y-%m-%d %H:%M')
    store['source'] = f'{BASE}/properties?court={COURT}'
    os.makedirs(os.path.dirname(path) or '.', exist_ok=True)
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(store, f, ensure_ascii=False, indent=0, sort_keys=True)
    os.replace(tmp, path)
    active = sum(1 for r in listings.values() if not r.get('removed'))
    linked = sum(1 for r in listings.values() if not r.get('removed') and r['plot_ids'])
    print(f'new: {new}, active: {active}, with cadastral id: {linked}, stored: {len(listings)}')


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'data/auctions.json')
