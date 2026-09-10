#!/usr/bin/env python3
"""
04_compute_shadows.py — Calcul zones d'ombre (MNT RGE ALTI 4m → GeoJSON WGS84)
================================================================================
Algorithme : rotation pure numpy + cumulative-max vectorisé.
  1. Rotation du MNT d'angle az_deg (CCW) → soleil depuis le haut (row 0)
  2. score[i,j] = dem[i,j] + i * pixel_size * tan(el)
  3. shadow[i,j] = cummax(score[0..i-1, j]) > score[i,j]
  4. Rotation inverse du masque
  5. Polygonisation GDAL → GeoJSON EPSG:4326

Usage :
  python3 04_compute_shadows.py --test    # 3 créneaux contrastés
  python3 04_compute_shadows.py --all     # ~130 créneaux annuels

Outputs : data/ombres/ombre_groix_{date}_{heure}.geojson
Log     : data/ombres/compute.log
"""

import math, json, os, sys, datetime, logging, re
import numpy as np
from osgeo import gdal, osr, ogr

gdal.UseExceptions()

# ─── Chemins ──────────────────────────────────────────────────────────────────
DEM_PATH   = '/home/sebastien/data/rge-alti-groix/groix_mnt_2m.bil'
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
OUT_DIR    = os.path.join(SCRIPT_DIR, '..', 'data', 'ombres')
LOG_FILE   = os.path.join(OUT_DIR, 'compute.log')

GROIX_LAT  = 47.6389
GROIX_LON  = -3.4523
UTC_OFFSET = 2   # CEST

TEST_SLOTS = [
    (2026, 8, 20,  9),   # matin  — az≈93°, el≈20°
    (2026, 8, 20, 14),   # midi   — az≈173°, el≈50°
    (2026, 8, 20, 19),   # soir   — az≈262°, el≈18°
]

def build_annual_slots():
    slots = []
    start = datetime.date(2026, 1, 1)
    for w in range(26):
        d = start + datetime.timedelta(weeks=w*2)
        for h in [9, 12, 15, 17, 19]:
            slots.append((d.year, d.month, d.day, h))
    return slots

# ─── Position solaire ─────────────────────────────────────────────────────────
def sun_position(year, month, day, hour_local, lat, lon, utc_offset):
    hour_utc = hour_local - utc_offset
    jd = (367*year - int(7*(year+int((month+9)/12))/4)
          + int(275*month/9) + day + 1721013.5 + hour_utc/24.0)
    n   = jd - 2451545.0
    L   = (280.46 + 0.9856474*n) % 360
    g   = math.radians((357.528 + 0.9856003*n) % 360)
    lam = math.radians(L + 1.915*math.sin(g) + 0.020*math.sin(2*g))
    eps = math.radians(23.439 - 0.0000004*n)
    dec = math.asin(math.sin(eps)*math.sin(lam))
    ra_h = math.degrees(math.atan2(math.cos(eps)*math.sin(lam), math.cos(lam)))/15.0
    gmst = (6.697375 + 0.0657098242*n + hour_utc) % 24
    lmst = (gmst + lon/15.0) % 24
    ha   = math.radians((lmst - ra_h)*15.0)
    lat_r = math.radians(lat)
    sin_alt = math.sin(lat_r)*math.sin(dec) + math.cos(lat_r)*math.cos(dec)*math.cos(ha)
    alt  = math.degrees(math.asin(max(-1, min(1, sin_alt))))
    sin_az = -math.cos(dec)*math.sin(ha)
    cos_az = (math.sin(dec) - math.sin(lat_r)*sin_alt) / math.cos(lat_r)
    az   = math.degrees(math.atan2(sin_az, cos_az)) % 360
    return alt, az

# ─── Rotation pure numpy ──────────────────────────────────────────────────────
def np_rotate(arr, angle_deg, cval=0.0):
    """
    Rotation CCW de angle_deg degrés (convention image : row=bas, col=droite).
    Retourne (rotated_array, h_out, w_out).
    """
    h, w = arr.shape
    θ = math.radians(angle_deg)
    cos_θ, sin_θ = math.cos(θ), math.sin(θ)

    h_out = int(math.ceil(abs(h * cos_θ) + abs(w * sin_θ))) + 2
    w_out = int(math.ceil(abs(h * sin_θ) + abs(w * cos_θ))) + 2

    cy_in,  cx_in  = (h - 1) / 2.0, (w - 1) / 2.0
    cy_out, cx_out = (h_out - 1) / 2.0, (w_out - 1) / 2.0

    r_g, c_g = np.mgrid[0:h_out, 0:w_out].astype(np.float32)
    r_c = r_g - cy_out
    c_c = c_g - cx_out

    # Backward transform (rotation par -θ pour trouver la source)
    r_src = r_c * cos_θ + c_c * sin_θ + cy_in
    c_src = -r_c * sin_θ + c_c * cos_θ + cx_in

    r0 = np.floor(r_src).astype(np.int32)
    c0 = np.floor(c_src).astype(np.int32)
    r1 = r0 + 1; c1 = c0 + 1
    valid = (r0 >= 0) & (r1 < h) & (c0 >= 0) & (c1 < w)

    r0c = r0.clip(0, h-1); r1c = r1.clip(0, h-1)
    c0c = c0.clip(0, w-1); c1c = c1.clip(0, w-1)
    wr = (r_src - r0).astype(np.float32)
    wc = (c_src - c0).astype(np.float32)

    a = arr.astype(np.float32)
    result = (a[r0c, c0c]*(1-wr)*(1-wc) + a[r0c, c1c]*(1-wr)*wc +
              a[r1c, c0c]*wr*(1-wc)      + a[r1c, c1c]*wr*wc)
    result[~valid] = cval
    return result, h_out, w_out

# ─── Lissage gaussien séparable (pure numpy) ─────────────────────────────────
def _smooth_mask(mask, sigma=1.5):
    """Gaussian blur 2D séparable sur masque binaire, sans scipy."""
    r = max(1, int(round(3.0 * sigma)))
    x = np.arange(-r, r + 1, dtype=np.float32)
    k = np.exp(-0.5 * (x / sigma) ** 2)
    k /= k.sum()
    f = mask.astype(np.float32)
    # Axe colonnes
    pad = np.pad(f, [(0, 0), (r, r)], mode='edge')
    f = sum(k[i] * pad[:, i:i + mask.shape[1]] for i in range(len(k)))
    # Axe lignes
    pad = np.pad(f, [(r, r), (0, 0)], mode='edge')
    f = sum(k[i] * pad[i:i + mask.shape[0], :] for i in range(len(k)))
    return f

# ─── Calcul masque d'ombre ────────────────────────────────────────────────────
def compute_shadow(dem, pixel_size, az_deg, el_deg, nodata=-99999.0):
    """
    Retourne masque uint8 : 1=ombre, 0=soleil (ou mer/nodata).

    Principe :
      - On fait tourner le MNT de az_deg degrés CCW → le soleil est « en haut » (row 0)
      - score[i,j] = h[i,j] + i*px*tan(el)   (une hauteur > score → le pixel est éclairé)
      - Ombre si cummax(score[0..i-1]) > score[i] (un obstacle en amont plus haut que le rayon)
      - Rotation inverse → masque en coordonnées originales
    """
    rows, cols = dem.shape

    # Masque terre / mer (nodata = mer)
    land_mask = dem > (nodata + 1.0)

    # Mer → hauteur très basse pour ne pas projeter d'ombre
    dem_clean = np.where(land_mask, dem, -100.0).astype(np.float32)

    if el_deg <= 0.5:
        return land_mask.astype(np.uint8)

    tan_el = math.tan(math.radians(el_deg))

    # ── Rotation MNT ─────────────────────────────────────────────────────────
    # Rotation CCW de az_deg → soleil vient du haut (row 0) dans le repère rotaté.
    # (Dérivation : la direction "depuis le soleil" (cos(az),-sin(az)) en (row,col)
    #  devient (1,0) après rotation CCW de az_deg.)
    dem_rot, h_rot, w_rot = np_rotate(dem_clean, az_deg, cval=-100.0)

    # Masque validité (pixles hors emprise DEM après rotation → cval=-100)
    valid_rot = (dem_rot > -99.0)

    # ── Score et cumulative-max vectorisé ────────────────────────────────────
    dist = np.arange(h_rot, dtype=np.float32) * pixel_size   # mètres depuis le haut
    score = dem_rot + dist[:, np.newaxis] * tan_el           # shape (h_rot, w_rot)

    # Masquer les pixels hors emprise
    score[~valid_rot] = -1e6

    # cummax de la ligne précédente
    cum_max = np.maximum.accumulate(score, axis=0)

    shadow_rot = np.zeros((h_rot, w_rot), dtype=np.float32)
    # Ombre si le cummax DES LIGNES PRÉCÉDENTES > score courant
    shadow_rot[1:] = (cum_max[:-1] > score[1:]).astype(np.float32)
    shadow_rot[~valid_rot] = 0.0   # pas d'ombre dans les pixels de rembourrage

    # ── Rotation inverse ─────────────────────────────────────────────────────
    shadow_back, h_b, w_b = np_rotate(shadow_rot, -az_deg, cval=0.0)

    r0 = (h_b - rows) // 2
    c0 = (w_b - cols) // 2
    shadow_crop = shadow_back[r0:r0+rows, c0:c0+cols]

    # Seuillage + masque terre uniquement
    result = ((shadow_crop > 0.4) & land_mask).astype(np.uint8)

    # Lissage gaussien → réduit l'effet escalier sur les bords diagonaux
    blurred = _smooth_mask(result, sigma=3.0)
    result = ((blurred > 0.4) & land_mask).astype(np.uint8)
    return result

# ─── Sauvegarde GeoTIFF temporaire ───────────────────────────────────────────
def save_geotiff(arr, gt, proj, path):
    drv = gdal.GetDriverByName('GTiff')
    ds  = drv.Create(path, arr.shape[1], arr.shape[0], 1, gdal.GDT_Byte,
                     ['COMPRESS=LZW'])
    ds.SetGeoTransform(gt)
    ds.SetProjection(proj)
    ds.GetRasterBand(1).WriteArray(arr)
    ds.GetRasterBand(1).SetNoDataValue(255)
    ds.FlushCache(); ds = None

# ─── Polygonisation → GeoJSON WGS84 ─────────────────────────────────────────
def raster_to_geojson(tif_path, geojson_path):
    src_ds   = gdal.Open(tif_path)
    src_band = src_ds.GetRasterBand(1)

    srs_l93   = osr.SpatialReference(); srs_l93.ImportFromEPSG(2154)
    srs_wgs84 = osr.SpatialReference(); srs_wgs84.ImportFromEPSG(4326)
    srs_wgs84.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)

    mem_drv = ogr.GetDriverByName('Memory')
    mem_ds  = mem_drv.CreateDataSource('')
    mem_lyr = mem_ds.CreateLayer('shadow', srs=srs_l93, geom_type=ogr.wkbPolygon)
    mem_lyr.CreateField(ogr.FieldDefn('val', ogr.OFTInteger))

    gdal.Polygonize(src_band, None, mem_lyr, 0, [], callback=None)
    src_ds = None

    transform = osr.CoordinateTransformation(srs_l93, srs_wgs84)
    features  = []
    for feat in mem_lyr:
        if feat.GetField('val') != 1:
            continue
        geom = feat.GetGeometryRef().Clone()
        geom = geom.Simplify(3.0) or geom          # simplification 3m
        geom = geom.Buffer(6.0).Buffer(-6.0) or geom  # arrondir les angles
        geom.Transform(transform)                   # L93 → WGS84
        if geom.GetArea() < 5e-9:                  # ignorer polygones < ~50m²
            continue
        features.append(json.loads(geom.ExportToJson()))

    with open(geojson_path, 'w') as f:
        json.dump({'type': 'FeatureCollection',
                   'features': [{'type': 'Feature', 'geometry': g, 'properties': {}}
                                 for g in features]},
                  f, separators=(',', ':'))
    mem_ds = None

# ─── Pipeline d'un créneau ───────────────────────────────────────────────────
def process_slot(dem, gt, proj, pixel_size, year, month, day, hour):
    alt, az = sun_position(year, month, day, hour, GROIX_LAT, GROIX_LON, UTC_OFFSET)
    tag = f"{year:04d}-{month:02d}-{day:02d}_{hour:02d}h"
    logging.info(f"[{tag}] alt={alt:.1f}° az={az:.1f}°")

    if alt < 0:
        logging.info(f"[{tag}] Nuit → ignoré")
        return None

    shadow = compute_shadow(dem, pixel_size, az, alt)

    tif_path     = os.path.join(OUT_DIR, f"ombre_groix_{tag}.tif")
    geojson_path = os.path.join(OUT_DIR, f"ombre_groix_{tag}.geojson")

    save_geotiff(shadow, gt, proj, tif_path)
    raster_to_geojson(tif_path, geojson_path)
    os.remove(tif_path)

    n_feat = len(json.load(open(geojson_path))['features'])
    sz_kb  = os.path.getsize(geojson_path) // 1024
    logging.info(f"[{tag}] → {n_feat} polygones, {sz_kb} ko")
    return geojson_path

# ─── Main ─────────────────────────────────────────────────────────────────────
def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s %(message)s',
        handlers=[
            logging.FileHandler(LOG_FILE),
            logging.StreamHandler(sys.stdout)
        ]
    )

    mode  = '--all' if '--all' in sys.argv else '--test'
    slots = TEST_SLOTS if mode == '--test' else build_annual_slots()
    logging.info(f"=== Mode {mode} : {len(slots)} créneaux ===")

    ds   = gdal.Open(DEM_PATH)
    gt   = ds.GetGeoTransform()
    proj = ds.GetProjection()
    band = ds.GetRasterBand(1)
    dem  = band.ReadAsArray().astype(np.float32)
    nd   = band.GetNoDataValue() or -99999.0
    dem[dem <= nd + 1] = nd
    px   = abs(gt[1])
    ds   = None
    logging.info(f"MNT {dem.shape[1]}x{dem.shape[0]} px, {px}m/px")

    for (year, month, day, hour) in slots:
        try:
            process_slot(dem, gt, proj, px, year, month, day, hour)
        except Exception as e:
            logging.error(f"ERREUR {year}-{month:02d}-{day:02d}_{hour:02d}h : {e}")

    # Générer index.json à partir des fichiers présents
    slots = {}
    for f in sorted(os.listdir(OUT_DIR)):
        m = re.match(r'ombre_groix_(\d{4}-\d{2}-\d{2})_(\d{2})h\.geojson', f)
        if m:
            slots.setdefault(m.group(1), []).append(int(m.group(2)))
    with open(os.path.join(OUT_DIR, 'index.json'), 'w') as f:
        json.dump({'slots': slots}, f, separators=(',', ':'))
    logging.info(f"index.json → {len(slots)} dates, {sum(len(v) for v in slots.values())} créneaux")

    logging.info("=== Terminé ===")

if __name__ == '__main__':
    main()
