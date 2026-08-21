// ombre-overlay.js — Couche GeoJSON ombres
// Chargé AVANT app.js. Si chargé en premier → calque primaire (actif d'entrée).
// Si chargé en second (MAREE_MODE déjà défini) → calque secondaire (inactif d'entrée).

window.OMBRE_MODE = true;

// Primaire = aucun autre overlay n'était déjà chargé
const SHADOW_PRIMARY = !window.MAREE_MODE;

(function () {
    'use strict';

    const GROIX_LAT = 47.6389;
    const GROIX_LON = -3.4523;

    function utcOffset() { return -new Date().getTimezoneOffset() / 60; }

    function sunAlt(year, month, day, hourLocal) {
        const hourUtc = hourLocal - utcOffset();
        const jd = 367 * year
            - Math.trunc(7 * (year + Math.trunc((month + 9) / 12)) / 4)
            + Math.trunc(275 * month / 9) + day + 1721013.5 + hourUtc / 24.0;
        const n   = jd - 2451545.0;
        const L   = (280.46 + 0.9856474 * n) % 360;
        const g   = (357.528 + 0.9856003 * n) % 360 * Math.PI / 180;
        const lam = (L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * Math.PI / 180;
        const eps = (23.439 - 0.0000004 * n) * Math.PI / 180;
        const dec = Math.asin(Math.sin(eps) * Math.sin(lam));
        const raH = Math.atan2(Math.cos(eps) * Math.sin(lam), Math.cos(lam)) * 180 / Math.PI / 15.0;
        const gmst = (6.697375 + 0.0657098242 * n + hourUtc) % 24;
        const lmst = (gmst + GROIX_LON / 15.0) % 24;
        const ha   = (lmst - raH) * 15.0 * Math.PI / 180;
        const latR = GROIX_LAT * Math.PI / 180;
        const sinAlt = Math.sin(latR) * Math.sin(dec) + Math.cos(latR) * Math.cos(dec) * Math.cos(ha);
        return Math.asin(Math.max(-1, Math.min(1, sinAlt))) * 180 / Math.PI;
    }

    // Filtre horaire uniquement si l'ombre est le calque primaire
    if (SHADOW_PRIMARY) {
        window.hourFilter = function (h, date) {
            return sunAlt(date.getFullYear(), date.getMonth() + 1, date.getDate(), h) > 0;
        };
    }

    let shadowLayer   = null;
    let shadowVisible = SHADOW_PRIMARY;
    let slotsIndex    = {};

    function findClosestSlot(date) {
        const dates = Object.keys(slotsIndex).sort();
        if (!dates.length) return null;
        const target = new Date(date.toISOString().split('T')[0]).getTime();
        let bestDate = dates[0], minDiff = Infinity;
        for (const d of dates) {
            const diff = Math.abs(new Date(d).getTime() - target);
            if (diff < minDiff) { minDiff = diff; bestDate = d; }
        }
        const hours = slotsIndex[bestDate] || [];
        if (!hours.length) return null;
        const hour = date.getHours();
        let bestHour = hours[0], minHDiff = Infinity;
        for (const h of hours) {
            const diff = Math.abs(h - hour);
            if (diff < minHDiff) { minHDiff = diff; bestHour = h; }
        }
        return { date: bestDate, hour: bestHour };
    }

    function loadShadow(date) {
        if (!shadowVisible) return;
        if (!date) date = new Date();
        const slot = findClosestSlot(date);
        if (shadowLayer) { map.removeLayer(shadowLayer); shadowLayer = null; }
        if (!slot) return;
        const h    = String(slot.hour).padStart(2, '0');
        const path = `data/ombres/ombre_groix_${slot.date}_${h}h.geojson`;
        fetch(path)
            .then(r => r.ok ? r.json() : null)
            .then(data => {
                if (!data || !data.features || !data.features.length) return;
                shadowLayer = L.geoJSON(data, {
                    style: {
                        fillColor:   '#14287A',
                        fillOpacity: 0.38,
                        color:       '#0A1450',
                        weight:      0.5,
                        opacity:     0.45
                    }
                }).addTo(map);
            })
            .catch(() => {});
    }

    // onDateChanged chaînable
    const _prev = window.onDateChanged;
    window.onDateChanged = function (date) {
        if (typeof _prev === 'function') _prev(date);
        loadShadow(date);
    };

    document.addEventListener('DOMContentLoaded', function () {
        const rowOmbres = document.getElementById('layer-ombres');
        if (rowOmbres) {
            rowOmbres.classList.toggle('active', shadowVisible);

            rowOmbres.addEventListener('click', function () {
                shadowVisible = !shadowVisible;
                rowOmbres.classList.toggle('active', shadowVisible);

                if (shadowVisible) {
                    loadShadow(typeof getDisplayDate === 'function' ? getDisplayDate() : new Date());
                } else {
                    if (shadowLayer) { map.removeLayer(shadowLayer); shadowLayer = null; }
                    // Retour index si plus aucun calque actif
                    const tideActive = document.getElementById('layer-maree').classList.contains('active');
                    if (!tideActive) window.location.href = 'index.html';
                }
            });
        }

        // Toujours charger l'index (nécessaire pour activation à la demande)
        fetch('data/ombres/index.json')
            .then(r => r.ok ? r.json() : { slots: {} })
            .catch(() => ({ slots: {} }))
            .then(idx => {
                slotsIndex = idx.slots || {};
                if (shadowVisible) {
                    loadShadow(typeof getDisplayDate === 'function' ? getDisplayDate() : new Date());
                }
            });
    });

})();
