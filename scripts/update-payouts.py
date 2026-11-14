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


def parse(html):
    soup = BeautifulSoup(html, 'html.parser')
    found = {}
    active = None
    prizes = {}
    def flush():
        if active and len(prizes) == 12 and all(i in prizes for i in range(1, 13)):
            found[active] = {'prizes': [prizes[i] for i in range(1, 13)], 'source': URL}
    for item in soup.find_all(string=True):
        t = ' '.join(str(item).split())
        m = DATE_RE.search(t)
        if m and m.group(2).lower() in MONTHS:
            flush()
            try:
                active = date(int(m.group(3)), MONTHS[m.group(2).lower()], int(m.group(1))).isoformat()
            except ValueError:
                active = None
            prizes = {}
            continue
        row = item.find_parent('tr')
        if not active or row is None:
            continue
        cells = [' '.join(x.get_text(' ', strip=True).split()) for x in row.find_all(['th', 'td'])]
        if len(cells) < 2:
            continue
        rank = RANK_RE.match(cells[0])
        if not rank:
            continue
        n = int(rank.group(1))
        if not 1 <= n <= 12:
            continue
        amount = AMOUNT_RE.match(cells[1])
        if amount:
            prizes[n] = int(re.sub(r'\s+', '', amount.group(1)))
        elif re.match(r'^[-–]\s*/', cells[1]):
            prizes[n] = None
    flush()
    return found


def existing():
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
        print('No complete CZK prize tables recognized; existing data preserved.')
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
