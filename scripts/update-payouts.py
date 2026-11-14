"""Best-effort update of explicitly published CZK Eurojackpot prize tables.
Never fabricate prizes or overwrite a verified conflicting amount.
"""
import json
import re
from datetime import date
from pathlib import Path

import requests
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'euro-vyhry.js'
URL = 'https://vyhraj.cz/loterie/eurojackpot/archiv-vysledku/'
MONTHS = {'ledna':1,'února':2,'března':3,'dubna':4,'května':5,'června':6,
          'července':7,'srpna':8,'září':9,'října':10,'listopadu':11,'prosince':12}
DATE_RE = re.compile(r'(?:pondělí|úterý|středa|čtvrtek|pátek|sobota|neděle)\s+(\d{1,2})\.\s*([a-zá-ž]+),?\s*(20\d{2})', re.I)
RANK_RE = re.compile(r'^(\d{1,2})\.\s*pořadí', re.I)
AMOUNT_RE = re.compile(r'^([\d\s\u00a0]+)\s*Kč', re.I)


def _money(value):
    value = re.sub(r'\s+', '', value.replace('\xa0', ''))
    if value in ('-', '–', '—', ''):
        return None
    m = re.fullmatch(r'(\d[\d.]*)Kč', value, re.I)
    if not m:
        return None
    return int(m.group(1).replace('.', ''))


def parse(html):
    """Extract complete, date-bound 12-rank CZK payout tables.

    Read individual rank rows rather than relying on one exact HTML layout.
    An absent amount ('-') is retained as null, never fabricated as zero.
    """
    soup = BeautifulSoup(html, 'html.parser')
    text = soup.get_text('\n', strip=True).replace('\u202f', ' ')
    dates = list(DATE_RE.finditer(text))
    found = {}
    incomplete = 0
    for i, match in enumerate(dates):
        month = MONTHS.get(match.group(2).lower())
        if not month:
            continue
        try:
            day = date(int(match.group(3)), month, int(match.group(1))).isoformat()
        except ValueError:
            continue
        block = text[match.end():dates[i + 1].start() if i + 1 < len(dates) else len(text)]
        heading = re.search(r'(?:Výherní\s+pořadí|Tabulka\s+výher)', block, re.I)
        if not heading:
            continue
        block = block[heading.end():]
        # Each rank is a separately identified row. The source may place
        # its amount, slash and winner count in different HTML elements.
        markers = list(re.finditer(r'(?<!\d)(1[0-2]|[1-9])\.\s*pořadí\b', block, re.I))
        prizes = {}
        invalid = False
        for j, marker in enumerate(markers):
            rank = int(marker.group(1))
            if rank in prizes:
                invalid = True
                break
            segment = block[marker.end():markers[j + 1].start() if j + 1 < len(markers) else len(block)]
            # Bound the row to the first winner count; reject unrelated text.
            row = re.search(r'(?P<amount>-|[\d\s\u00a0.]+\s*Kč)\s*/\s*(?P<count>\d[\d\s\u00a0]*)\s*x\b', segment, re.I)
            if not row:
                invalid = True
                break
            raw = row.group('amount').strip()
            amount = None if raw == '-' else _money(raw)
            if raw != '-' and amount is None:
                invalid = True
                break
            prizes[rank] = amount
        if not invalid and set(prizes) == set(range(1, 13)):
            found[day] = {'prizes': [prizes[n] for n in range(1, 13)], 'source': URL}
        else:
            incomplete += 1
    print(f'CZK source parsed: {len(dates)} date sections, {len(found)} complete 12-rank tables, {incomplete} incomplete tables.')
    return found


def existing():
    if not OUTPUT.exists():
        print('CZK archive absent: starting with empty verified cache.')
        return {}
    raw = OUTPUT.read_text(encoding='utf-8')
    match = re.search(r'window\.EURO_PAYOUTS\s*=\s*(\{.*\})\s*;', raw, re.S)
    if not match:
        raise ValueError('Cannot safely read existing euro-vyhry.js')
    return json.loads(match.group(1))


def main():
    old = existing()
    try:
        r = requests.get(URL, timeout=20, headers={'User-Agent':'Mozilla/5.0 (compatible; EurojackpotArchiveUpdater/1.0)'})
        r.raise_for_status()
        new = parse(r.text)
    except (requests.RequestException, ValueError) as e:
        print(f'CZ source unavailable: {e}. Existing verified payout data preserved.')
        return
    if not new:
        print('WARNING: No complete CZK prize tables recognized; existing data preserved. Check source HTML/layout.')
        return
    added = 0
    conflicts = 0
    for d, entry in new.items():
        if d in old:
            if old[d]['prizes'] != entry['prizes']:
                conflicts += 1
            continue
        old[d] = entry
        added += 1
    if added:
        OUTPUT.write_text('/* Czech Eurojackpot prize tables (CZK); verified published rows only. */\nwindow.EURO_PAYOUTS=' + json.dumps(dict(sorted(old.items())), ensure_ascii=False, indent=2) + ';\n', encoding='utf-8')
    print(f'CZK payout archive: {len(new)} recognized, {added} added, {conflicts} conflicts skipped.')

if __name__ == '__main__':
    main()
