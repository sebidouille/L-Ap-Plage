#!/usr/bin/env python3
"""
Télécharge les tuiles Litto3D Bretagne pour Île de Groix,
extrait les MNT1m et fusionne en un seul GeoTIFF.

Usage : python3 scripts/06_download_litto3d.py
"""

import os
import subprocess
import sys
import time
from pathlib import Path

import requests

BASE_URL  = 'https://services.data.shom.fr/INSPIRE/telechargement/prepackageGroup/LITTO3D_BZH_2018_2021_PACK_DL'
OUT_DIR   = Path('/home/sebastien/data/litto3d-groix')
ARCH_DIR  = OUT_DIR / 'archives'
MNT_DIR   = OUT_DIR / 'mnt1m'
MERGE_OUT = OUT_DIR / 'groix_litto3d_1m.tif'

# Tuiles couvrant Groix (X≈211-227km, Y≈6740-6750km)
TILES = [
    '0210_6745',   # côte ouest —  48 MB
    '0215_6745',   # île principale — 664 MB
    '0220_6745',   # côte est — 297 MB
    '0215_6740',   # pointe sud —   8 MB
    '0220_6740',   # pointe sud-est — 4 MB
    '0210_6750',   # côte nord-ouest — 338 MB
    '0215_6750',   # côte nord — 341 MB
    '0220_6750',   # côte nord-est — 331 MB
]

def download_tile(tile: str) -> Path:
    arch_path = ARCH_DIR / f'{tile}.7z'
    if arch_path.exists():
        print(f'  [déjà téléchargé] {tile}')
        return arch_path

    url = f'{BASE_URL}/prepackage/{tile}/file/{tile}.7z'
    print(f'  Téléchargement {tile}...', end=' ', flush=True)
    r = requests.get(url, stream=True, timeout=300)
    r.raise_for_status()

    total = int(r.headers.get('Content-Length', 0))
    downloaded = 0
    with open(arch_path, 'wb') as f:
        for chunk in r.iter_content(chunk_size=1 << 20):  # 1 MB chunks
            f.write(chunk)
            downloaded += len(chunk)
            if total:
                pct = downloaded / total * 100
                print(f'\r  Téléchargement {tile}... {pct:.0f}%', end='', flush=True)
    print(f'\r  ✓ {tile} ({arch_path.stat().st_size / 1e6:.1f} MB)            ')
    return arch_path


def extract_mnt1m(arch_path: Path, tile: str) -> list[Path]:
    """Extrait uniquement les fichiers MNT1m ASC de l'archive."""
    out_dir = MNT_DIR / tile
    if out_dir.exists() and any(out_dir.rglob('*.asc')):
        asc_files = list(out_dir.rglob('*.asc'))
        print(f'  [déjà extrait] {tile} → {len(asc_files)} ASC')
        return asc_files

    out_dir.mkdir(parents=True, exist_ok=True)
    print(f'  Extraction MNT1m de {tile}...', flush=True)
    cmd = [
        '7z', 'e', str(arch_path),
        f'-o{out_dir}',
        '*/MNT1m/*.asc',
        '-r', '-y', '-bso0', '-bsp1'
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode not in (0, 1):
        print(f'    Erreur 7z: {result.stderr[:200]}')

    asc_files = list(out_dir.rglob('*.asc'))
    print(f'  ✓ {len(asc_files)} fichiers MNT1m extraits')
    return asc_files


def merge_to_tiff(asc_files: list[Path]) -> Path:
    """Fusionne tous les ASC en un seul GeoTIFF via gdal_merge."""
    print(f'\nFusion de {len(asc_files)} tuiles MNT1m → {MERGE_OUT}')
    file_list = OUT_DIR / 'mnt1m_files.txt'
    with open(file_list, 'w') as f:
        for p in sorted(asc_files):
            f.write(str(p) + '\n')

    cmd = [
        'gdal_merge.py',
        '-o', str(MERGE_OUT),
        '-of', 'GTiff',
        '-a_nodata', '-9999',
        '--optfile', str(file_list)
    ]
    result = subprocess.run(cmd, capture_output=False)
    if result.returncode == 0:
        size_mb = MERGE_OUT.stat().st_size / 1e6
        print(f'✅ Fusionné : {MERGE_OUT} ({size_mb:.0f} MB)')
    else:
        print('❌ Erreur lors de la fusion')
    return MERGE_OUT


def main():
    ARCH_DIR.mkdir(parents=True, exist_ok=True)
    MNT_DIR.mkdir(parents=True, exist_ok=True)

    all_asc = []
    for tile in TILES:
        print(f'\n=== {tile} ===')
        try:
            arch = download_tile(tile)
            asc_files = extract_mnt1m(arch, tile)
            all_asc.extend(asc_files)
        except Exception as e:
            print(f'  ❌ Erreur : {e}')

    if not all_asc:
        print('Aucun fichier MNT extrait.')
        sys.exit(1)

    if not MERGE_OUT.exists():
        merge_to_tiff(all_asc)
    else:
        print(f'\n{MERGE_OUT} déjà présent — supprime-le pour refaire la fusion.')

    print(f'\nTerminé. MNT Litto3D disponible dans :\n  {MERGE_OUT}')


if __name__ == '__main__':
    main()
