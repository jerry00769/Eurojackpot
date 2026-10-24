import os
import requests
from bs4 import BeautifulSoup
from datetime import datetime

# =============================
# NASTAVENÍ
# =============================
CILOVA_SLOZKA = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOUBOR = os.path.join(CILOVA_SLOZKA, "eurojackpot.csv")

START_ROK = 2012
AKTUALNI_ROK = datetime.now().year

HLAVICKA = "datum;rok;1;2;3;4;5;euro1;euro2\n"

HEADERS = {
    "User-Agent": "Mozilla/5.0"
}

# =============================
# FUNKCE: STAŽENÍ DAT
# =============================
def stahni_rok(rok):
    url = f"https://euroj.eu/en/eurojackpot-archive.aspx?year={rok}"
    print(f"\n🔄 Stahuji rok {rok}...")

    try:
        r = requests.get(url, headers=HEADERS, timeout=10)
        r.raise_for_status()
    except Exception as e:
        print(f"❌ Chyba: {e}")
        return []

    soup = BeautifulSoup(r.text, "html.parser")

    tabulka = soup.find("table")
    if not tabulka:
        print("❌ Tabulka nenalezena")
        return []

    radky = tabulka.find_all("tr")[1:]  # přeskočit hlavičku

    vystup = []

    for r in radky:
        bunky = r.find_all("td")

        if len(bunky) < 4:
            continue

        try:
            datum = bunky[0].text.strip()

            main_raw = bunky[2].text.strip()
            euro_raw = bunky[3].text.strip()

            main = [x.strip() for x in main_raw.split(",")]
            euro = [x.strip() for x in euro_raw.split(",")]

            if len(main) == 5 and len(euro) == 2:
                radek = (
                    f"{datum};{rok};"
                    + ";".join(main)
                    + ";"
                    + ";".join(euro)
                )
                vystup.append(radek)

        except:
            continue

    print(f"✅ Načteno z webu: {len(vystup)} řádků")
    return vystup


# =============================
# VYTVOŘENÍ SLOŽKY
# =============================
os.makedirs(CILOVA_SLOZKA, exist_ok=True)

# =============================
# NAČTENÍ EXISTUJÍCÍCH DAT
# =============================
existujici = set()
existujici_roky = set()

if os.path.exists(SOUBOR):
    print("📂 Načítám existující data...")

    with open(SOUBOR, "r", encoding="utf-8") as f:
        lines = f.readlines()[1:]

        for l in lines:
            l = l.strip()
            existujici.add(l)

            try:
                rok = int(l.split(";")[1])
                existujici_roky.add(rok)
            except:
                pass
else:
    print("📁 Soubor neexistuje – vytvoří se nový.")

# =============================
# STAŽENÍ DAT (CHYTRÁ LOGIKA)
# =============================
nova_data = []

for rok in range(START_ROK, AKTUALNI_ROK + 1):

    # 🔥 staré roky nech být
    if rok in existujici_roky and rok != AKTUALNI_ROK:
        print(f"⏩ Rok {rok} už existuje → SKIP")
        continue

    data = stahni_rok(rok)

    # 🔥 přidat jen nové řádky
    for r in data:
        if r not in existujici:
            nova_data.append(r)

# =============================
# SLOUČENÍ
# =============================
vse = list(existujici) + nova_data

# =============================
# SEŘAZENÍ OD NEJNOVĚJŠÍCH
# =============================
def sort_key(r):
    try:
        return datetime.strptime(r.split(";")[0], "%d.%m.%Y")
    except:
        return datetime(1900, 1, 1)

vse.sort(key=sort_key, reverse=True)

# =============================
# ULOŽENÍ
# =============================
with open(SOUBOR, "w", encoding="utf-8") as f:
    f.write(HLAVICKA)
    for r in vse:
        f.write(r + "\n")

print("\n✅ HOTOVO")
print(f"➕ Přidáno nových řádků: {len(nova_data)}")
print(f"📂 Soubor: {SOUBOR}")
