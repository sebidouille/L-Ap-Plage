#!/usr/bin/env python3
"""
Récupère les prédictions de marée pour Île de Groix (Port-Tudy)
depuis maree.info et génère data/marees.json (49 jours)

Usage : python3 scripts/05_fetch_marees.py
Cron  : 0 6 * * 1 cd /home/sebastien/L-Ap-Plage && python3 scripts/05_fetch_marees.py
"""

import json
import re
import time
from datetime import datetime, timedelta
from pathlib import Path

import requests

PORT_ID  = 98       # maree.info/98 = Île de Groix (Port-Tudy)
NB_WEEKS = 7        # 7 semaines × 7 jours = 49 jours
OUT_FILE = Path(__file__).parent.parent / 'data' / 'marees.json'

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
    'Referer':    f'https://maree.info/{PORT_ID}',
}

AJAX_URL = f'https://maree.info/do/load-maree-jours.php'


def init_session() -> requests.Session:
    """Crée une session avec cookie PHPSESSID via la page principale."""
    session = requests.Session()
    session.headers.update(HEADERS)
    session.get(f'https://maree.info/{PORT_ID}', timeout=15)
    return session


def fetch_week(session: requests.Session, start_date: datetime) -> str:
    date_str = start_date.strftime('%Y%m%d')
    r = session.get(AJAX_URL, params={'p': PORT_ID, 'd': date_str, 'j': 0}, timeout=15)
    r.raise_for_status()
    return r.text


def parse_week(js_html: str):
    rows = []

    m = re.search(r'Marees\.Dates\s*=\s*\[([0-9,]+)\]', js_html)
    if not m:
        return rows, None

    dates = m.group(1).split(',')

    # La réponse est du JS avec le HTML inline échappé (\")
    html = js_html.replace('\\"', '"').replace("\\'", "'")

    tr_matches = re.findall(r'<tr class="MJ [^"]*"[^>]*>([\s\S]*?)</tr>', html)

    for idx, tr_html in enumerate(tr_matches):
        if idx >= len(dates):
            break

        raw = dates[idx]
        date_fmt = f'{raw[:4]}-{raw[4:6]}-{raw[6:8]}'

        tds = re.findall(r'<td>([\s\S]*?)</td>', tr_html)
        if len(tds) < 2:
            continue

        times   = re.findall(r'\d{2}h\d{2}', tds[0])
        heights = re.findall(r'\d+,\d+(?=m)',  tds[1])

        # Identifier BM/PM via les balises <b> (PM = en gras)
        # Structure maree.info : alterne BM et PM, PM toujours en <b>
        # Extraire avec <b> pour distinguer PM et BM
        bold_times   = re.findall(r'<b>(\d{2}h\d{2})</b>', tds[0])
        bold_heights = re.findall(r'<b>(\d+,\d+)(?=m)', tds[1])

        # Reconstituer BM1/PM1/BM2/PM2 depuis la séquence
        bm1 = times[0] if len(times) > 0 else ''
        pm1 = times[1] if len(times) > 1 else ''
        bm2 = times[2] if len(times) > 2 else ''
        pm2 = times[3] if len(times) > 3 else ''

        if not pm1:
            continue

        # Hauteur max = max des PM
        h_bold = [float(h.replace(',', '.')) for h in bold_heights] if bold_heights else []
        h_max  = max(h_bold) if h_bold else 0
        h_max_str = f'{h_max:.2f}'.replace('.', ',') if h_max > 0 else ''

        rows.append({
            'date':        date_fmt,
            'bm1_heure':   bm1,
            'pm1_heure':   pm1,
            'bm2_heure':   bm2,
            'pm2_heure':   pm2,
            'hauteur_max': h_max_str,
        })

    last_raw  = dates[-1]
    last_date = datetime(int(last_raw[:4]), int(last_raw[4:6]), int(last_raw[6:8]))
    next_start = last_date + timedelta(days=1)

    return rows, next_start


def main():
    print('Initialisation session maree.info…')
    session = init_session()

    all_rows   = []
    next_start = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
    # Reculer au début de la semaine maree.info (jeudi précédent ou actuel)
    # maree.info utilise des semaines démarrant le jeudi
    weekday = next_start.weekday()   # 0=lun … 6=dim
    # jeudi = 3; reculer jusqu'au jeudi précédent
    days_back = (weekday - 3) % 7
    next_start -= timedelta(days=days_back)

    for week in range(NB_WEEKS):
        date_str = next_start.strftime('%Y%m%d')
        print(f'Semaine {week+1}/{NB_WEEKS} → {date_str}')
        try:
            js_html = fetch_week(session, next_start)
            rows, next_start = parse_week(js_html)
            all_rows.extend(rows)
            print(f'  → {len(rows)} jours (jusqu\'au {rows[-1]["date"] if rows else "?"})')
        except Exception as e:
            print(f'  Erreur : {e}')
            next_start += timedelta(days=7)

        if week < NB_WEEKS - 1:
            time.sleep(1.0)

    if not all_rows:
        print('Aucune donnée récupérée.')
        return

    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT_FILE, 'w', encoding='utf-8') as f:
        json.dump(all_rows, f, separators=(',', ':'), ensure_ascii=False)

    print(f'\n✅ {len(all_rows)} jours écrits dans {OUT_FILE}')
    print(f'   Du {all_rows[0]["date"]} au {all_rows[-1]["date"]}')


if __name__ == '__main__':
    main()
