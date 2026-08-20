#!/usr/bin/env python3
"""
Calcul des zones inondées par la marée (modèle "baignoire") pour Île de Groix.
Source MNT : Litto3D Bretagne 2018-2021 (1m, NGF-IGN69, Lambert-93)
ZH Port-Tudy : -2.742 m NGF-IGN69 (RAM SHOM 2025)

Usage :
  python3 scripts/07_compute_tidal_zones.py --test   # 3 niveaux de test
  python3 scripts/07_compute_tidal_zones.py --all    # tous les niveaux

Sortie : data/marees_niveaux/maree_groix_NNNcm.geojson
         data/marees_niveaux/index.json
"""

import argparse
import json
import os
import sys
import tempfile
import time
from pathlib import Path

import numpy as np
from osgeo import gdal, ogr, osr

gdal.UseExceptions()

# ── Paramètres ─────────────────────────────────────────────────────────────

DEM_PATH   = Path('/home/sebastien/data/litto3d-groix/groix_litto3d_1m.tif')
OUT_DIR    = Path(__file__).parent.parent / 'data' / 'marees_niveaux'
ZH_OFFSET  = -2.742      # altitude du ZH Port-Tudy en NGF-IGN69 (RAM SHOM 2025)

# Niveaux à précalculer : hauteur d'eau AU-DESSUS DU ZH, en cm
# PBMA = 29 cm/ZH,  PHMA = 586 cm/ZH  → 0 à 620 cm, pas 20 cm
H_MIN_CM   = 0
H_MAX_CM   = 620
H_STEP_CM  = 20

TEST_LEVELS_CM = [100, 300, 500]   # basse mer, mi-marée, pleine mer

SIMPLIFY_M   = 5.0      # tolérance Douglas-Peucker (m, en Lambert-93)
MIN_AREA_M2  = 2000     # polygones < 2000 m² ignorés (bruit)

# Emprise Groix + estran en Lambert-93 (légèrement élargie pour inclure l'estran)
GROIX_XMIN, GROIX_XMAX = 209500, 220000
GROIX_YMIN, GROIX_YMAX = 6741000, 6751000

# Seuil bas = PBMA (altitude la plus basse de marée) → on ne montre que l'estran
# Les pixels toujours immergés (< PBMA_NGF) ne sont pas inclus
PBMA_NGF = 0.29 + ZH_OFFSET   # = -2.452 m NGF

# ── Utilitaires ─────────────────────────────────────────────────────────────

def log(msg):
    print(msg, flush=True)


def h_ngf(h_zh_cm: int) -> float:
    """Convertit une hauteur en cm/ZH en altitude NGF-IGN69."""
    return h_zh_cm / 100.0 + ZH_OFFSET


def compute_level(dem_array: np.ndarray, nodata: float,
                  geotransform: tuple, srs_lambert: osr.SpatialReference,
                  h_cm: int, out_path: Path) -> int:
    """
    Seuille le MNT, vectorise, simplifie et reprojecte en WGS84.
    Retourne le nombre de polygones écrits.
    """
    threshold = h_ngf(h_cm)

    # Masque binaire : 1 = estran inondé à ce niveau
    # On exclut la mer permanente (< PBMA_NGF) pour ne montrer que la zone intertidale
    mask = np.where(
        (dem_array != nodata) & (dem_array >= PBMA_NGF) & (dem_array < threshold),
        np.uint8(1), np.uint8(0)
    )

    # ── Polygonisation ──────────────────────────────────────────────────────
    driver_mem = gdal.GetDriverByName('MEM')
    ds_mask = driver_mem.Create('', dem_array.shape[1], dem_array.shape[0], 1, gdal.GDT_Byte)
    ds_mask.SetGeoTransform(geotransform)
    ds_mask.SetProjection(srs_lambert.ExportToWkt())
    band = ds_mask.GetRasterBand(1)
    band.WriteArray(mask)
    band.SetNoDataValue(0)

    drv_shp = ogr.GetDriverByName('Memory')
    ds_vec  = drv_shp.CreateDataSource('')
    lyr     = ds_vec.CreateLayer('mask', srs=srs_lambert, geom_type=ogr.wkbPolygon)
    lyr.CreateField(ogr.FieldDefn('DN', ogr.OFTInteger))

    gdal.Polygonize(band, band, lyr, 0, [], callback=None)

    # ── Simplification + reprojection WGS84 ────────────────────────────────
    srs_wgs84 = osr.SpatialReference()
    srs_wgs84.ImportFromEPSG(4326)
    srs_wgs84.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    transform = osr.CoordinateTransformation(srs_lambert, srs_wgs84)

    features = []
    for feat in lyr:
        if feat.GetField('DN') != 1:
            continue
        geom = feat.GetGeometryRef()
        if not geom or geom.IsEmpty():
            continue
        if geom.GetArea() < MIN_AREA_M2:
            continue
        geom = geom.Simplify(SIMPLIFY_M) or geom
        if geom.IsEmpty():
            continue
        geom.Transform(transform)
        geom_json = json.loads(geom.ExportToJson())
        features.append({'type': 'Feature', 'geometry': geom_json, 'properties': {}})

    out_path.parent.mkdir(parents=True, exist_ok=True)
    geojson = {'type': 'FeatureCollection', 'features': features}
    with open(out_path, 'w') as f:
        json.dump(geojson, f, separators=(',', ':'))

    ds_mask = None
    ds_vec  = None
    return len(features)


# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--test', action='store_true', help='3 niveaux de test')
    parser.add_argument('--all',  action='store_true', help='Tous les niveaux')
    args = parser.parse_args()

    if not args.test and not args.all:
        parser.print_help()
        sys.exit(1)

    levels_cm = TEST_LEVELS_CM if args.test else list(range(H_MIN_CM, H_MAX_CM + 1, H_STEP_CM))

    log(f'=== Zones marée Groix — {"test" if args.test else "complet"} ===')
    log(f'MNT : {DEM_PATH}')
    log(f'ZH Port-Tudy : {ZH_OFFSET} m NGF')
    log(f'Niveaux : {levels_cm}')

    # Charger le MNT une seule fois
    log('\nChargement MNT Litto3D...')
    ds = gdal.Open(str(DEM_PATH))
    band = ds.GetRasterBand(1)
    nodata = band.GetNoDataValue()
    dem = band.ReadAsArray()
    geotransform = ds.GetGeoTransform()
    # Le GeoTIFF fusionné peut ne pas avoir de projection → forcer EPSG:2154 (Lambert-93)
    srs_lambert = osr.SpatialReference()
    srs_lambert.ImportFromEPSG(2154)
    ds = None
    log(f'MNT chargé : {dem.shape[1]}×{dem.shape[0]} px')

    # Recadrer sur l'emprise de Groix
    gt = geotransform
    col0 = max(0, int((GROIX_XMIN - gt[0]) / gt[1]))
    col1 = min(dem.shape[1], int((GROIX_XMAX - gt[0]) / gt[1]))
    row0 = max(0, int((GROIX_YMAX - gt[3]) / gt[5]))
    row1 = min(dem.shape[0], int((GROIX_YMIN - gt[3]) / gt[5]))
    dem = dem[row0:row1, col0:col1]
    geotransform = (
        gt[0] + col0 * gt[1], gt[1], gt[2],
        gt[3] + row0 * gt[5], gt[4], gt[5]
    )
    log(f'Recadré sur Groix : {dem.shape[1]}×{dem.shape[0]} px')

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    results = {}
    t0 = time.time()

    for i, h_cm in enumerate(levels_cm):
        ngf = h_ngf(h_cm)
        out_path = OUT_DIR / f'maree_groix_{h_cm:03d}cm.geojson'
        t_start = time.time()

        n_poly = compute_level(dem, nodata, geotransform, srs_lambert, h_cm, out_path)
        elapsed = time.time() - t_start
        size_kb = out_path.stat().st_size // 1024

        log(f'[{i+1}/{len(levels_cm)}] h={h_cm}cm/ZH ({ngf:+.2f}m NGF) '
            f'→ {n_poly} polygones, {size_kb} ko ({elapsed:.1f}s)')
        results[h_cm] = n_poly

    # Index
    index = {
        'zh_offset_ngf': ZH_OFFSET,
        'step_cm': H_STEP_CM,
        'levels_cm': sorted(results.keys()),
    }
    with open(OUT_DIR / 'index.json', 'w') as f:
        json.dump(index, f, separators=(',', ':'))

    total = time.time() - t0
    log(f'\n✅ {len(levels_cm)} niveaux générés en {total:.0f}s → {OUT_DIR}')


if __name__ == '__main__':
    main()
