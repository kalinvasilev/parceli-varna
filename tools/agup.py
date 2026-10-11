"""ПУП activity in Varna from agup.varna.bg registers: requested plans and approved plans.

- Requested (Заповеди за разрешаване изработване на устройствени планове, чл. 124а ЗУТ): a clean table
  with the plot's cadastral id — the earliest public sign that someone is preparing a plot for building.
- Approved (Заповеди за одобряване на ПУП, чл. 129, ал. 2 ЗУТ): order number, date, title (often with the
  cadastral id) and the folder with the order and the drawing.

The yearly pages are found from the site menu, so new years are picked up without code changes.
Usage: python3 tools/agup.py data/pup.json      (standard library only)
"""
import html
import json
import os
import re
import sys
import time
import urllib.request
from datetime import datetime
from zoneinfo import ZoneInfo

BASE = 'https://agup.varna.bg'
UA = 'parceli-varna/1.0 (+https://kalinvasilev.github.io/parceli-varna/)'
PAUSE = 1.5
SOFIA = ZoneInfo('Europe/Sofia')
ID_RE = re.compile(r'10135\.\d{3,4}\.\d{1,4}')


def get(url):
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=90) as r:
                return r.read().decode('utf-8', 'replace')
        except Exception:
            if attempt == 2:
                raise
            time.sleep(5 * (attempt + 1))


def clean(s):
    return re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', s))).strip()


def iso(s):
    m = re.search(r'(\d{1,2})\.(\d{1,2})\.(\d{4})', s or '')
    return f'{m.group(3)}-{int(m.group(2)):02d}-{int(m.group(1)):02d}' if m else None


def year_pages(menu_html):
    """{'requests': {year: url}, 'approvals': {year: url}} from the site menu."""
    found = {'requests': {}, 'approvals': {}}
    for href, label in re.findall(r'<a[^>]+href="([^"]+)"[^>]*>(.*?)</a>', menu_html, re.S):
        label = clean(label)
        year = re.search(r'(20\d\d)', label)
        if not year:
            continue
        url = href if href.startswith('http') else BASE + href
        if 'zapovedi-pup-' in href and 'разрешаване изработване' in label.lower():
            found['requests'][year.group(1)] = url
        elif 'odobryavane-na-pup' in href and 'одобряване на пуп' in label.lower():
            found['approvals'][year.group(1)] = url
    return found


def rows(page):
    for r in re.findall(r'<tr[^>]*>(.*?)</tr>', page, re.S):
        cells = re.findall(r'<td[^>]*>(.*?)</td>', r, re.S)
        if cells:
            yield r, [clean(c) for c in cells]


PLAN_RE = re.compile(r'ПУП|ПРЗ|\bПР\b|\bПЗ\b|РУП|ПП\b|парцеларен|изменение на (?:плана|ПУП)', re.I)


def parse_requests(page, year):
    """2025+ tables start with the order number then the date; 2020–2024 have a running number first
    and also list orders that are not plans (e.g. acceptance commissions), which are skipped."""
    out = []
    for _, c in rows(page):
        if len(c) < 7:
            continue
        di = 1 if iso(c[1]) else 2 if len(c) > 2 and iso(c[2]) else None
        if di is None:
            continue
        # The plan-type column moves between years (an "issued by" column was added in 2023);
        # find it by content and read the other columns relative to it.
        pi = next((i for i in (di + 2, di + 3) if i < len(c) and PLAN_RE.search(c[i])), None)
        if pi is None:
            continue
        col = lambda k: c[pi + k] if pi + k < len(c) else ''
        ids = list(dict.fromkeys(ID_RE.findall(col(2))))
        place = col(5)
        out.append({
            'kind': 'pup_request', 'year': year, 'order': c[di - 1], 'date': iso(c[di]),
            'plan': c[pi], 'district': col(1).title() if col(1) != '-' else '', 'target': col(2), 'plot_ids': ids,
            'kv': col(3), 'place': place.title() if place.isupper() else place,
        })
    return out


def parse_approvals(page, year):
    out = []
    for raw, c in rows(page):
        if len(c) < 2 or not c[0] or not iso(c[0]):
            continue
        folder = re.search(r'href="([^"]*/pup/[^"]+)"', raw) or re.search(r'(/pup/\d{4}/[^\s<"]+)', c[2] if len(c) > 2 else '')
        url = None
        if folder:
            url = folder.group(1)
            url = (BASE + url if url.startswith('/') else url).replace('http://', 'https://')
        out.append({
            'kind': 'pup_approved', 'year': year, 'order': c[0].split('/')[0].strip(), 'date': iso(c[0]),
            'title': c[1], 'plot_ids': list(dict.fromkeys(ID_RE.findall(c[1]))), 'url': url,
        })
    return out


def main(path):
    pages = year_pages(get(BASE + '/'))
    print('years found:', {k: sorted(v) for k, v in pages.items()}, flush=True)
    data = {'requests': [], 'approvals': []}
    for year, url in sorted(pages['requests'].items()):
        time.sleep(PAUSE)
        data['requests'] += parse_requests(get(url + ('&' if '?' in url else '?') + 'limit=0'), year)
    for year, url in sorted(pages['approvals'].items()):
        time.sleep(PAUSE)
        data['approvals'] += parse_approvals(get(url + ('&' if '?' in url else '?') + 'limit=0'), year)
    if not data['requests'] and not data['approvals']:
        sys.exit('nothing parsed — the site layout may have changed; keeping the old file')
    data['updated'] = datetime.now(SOFIA).strftime('%Y-%m-%d %H:%M')
    data['source'] = BASE
    os.makedirs(os.path.dirname(path) or '.', exist_ok=True)
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
    os.replace(tmp, path)
    for k in ('requests', 'approvals'):
        n = len(data[k])
        print(f'{k}: {n}, with plot id: {sum(1 for r in data[k] if r["plot_ids"])}')


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'data/pup.json')
