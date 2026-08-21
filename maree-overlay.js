// maree-overlay.js — Couche GeoJSON marée
// Chargé AVANT app.js. Si chargé en premier → calque primaire (actif d'entrée).
// Si chargé en second (OMBRE_MODE déjà défini) → calque secondaire (inactif d'entrée).

window.MAREE_MODE = true;

// Primaire = aucun autre overlay n'était déjà chargé
const TIDE_PRIMARY = !window.OMBRE_MODE;

(function () {
    'use strict';

    const H_MIN_CM  = 60;
    const H_MAX_CM  = 620;
    const H_STEP_CM = 20;

    let mareeLayer  = null;
    let tideVisible = TIDE_PRIMARY;
    let mareesLocal = [];

    // ── Interpolation marée (copie de app.js) ───────────────────────────────
    function getTideEvents(tide) {
        const ph = t => { if (!t) return null; const m = t.match(/(\d+)h(\d+)/); return m ? +m[1] + +m[2]/60 : null; };
        const hMax = parseFloat((tide.hauteur_max || '').replace(',', '.')) || 5.3;
        const hMin = 0.9;
        const events = [
            { h: ph(tide.bm1_heure), type: 'low',  val: hMin },
            { h: ph(tide.pm1_heure), type: 'high', val: hMax },
            { h: ph(tide.bm2_heure), type: 'low',  val: hMin },
            { h: ph(tide.pm2_heure), type: 'high', val: hMax }
        ].filter(e => e.h !== null).sort((a, b) => a.h - b.h);
        return { events, hMax, hMin };
    }

    function tideHeightAt(hour, events, hMin, hMax) {
        if (events.length < 2) return (hMax + hMin) / 2;
        if (hour <= events[0].h) {
            const prev = { h: events[events.length-1].h - 24, val: events[events.length-1].val };
            const ratio = Math.max(0, Math.min(1, (hour - prev.h) / (events[0].h - prev.h)));
            return prev.val + (events[0].val - prev.val) * (0.5 - 0.5 * Math.cos(ratio * Math.PI));
        }
        if (hour >= events[events.length-1].h) {
            const last = events[events.length-1];
            const next = { h: events[0].h + 24, val: events[0].val };
            const ratio = Math.max(0, Math.min(1, (hour - last.h) / (next.h - last.h)));
            return last.val + (next.val - last.val) * (0.5 - 0.5 * Math.cos(ratio * Math.PI));
        }
        for (let i = 0; i < events.length - 1; i++) {
            if (hour >= events[i].h && hour <= events[i+1].h) {
                const ratio = (hour - events[i].h) / (events[i+1].h - events[i].h);
                return events[i].val + (events[i+1].val - events[i].val) * (0.5 - 0.5 * Math.cos(ratio * Math.PI));
            }
        }
        return (hMax + hMin) / 2;
    }

    function selectLevel(date) {
        const today = date.toISOString().split('T')[0];
        const tide  = mareesLocal.find(m => (m.date || '').substring(0, 10) === today);
        if (!tide) return null;
        const hour = date.getHours() + date.getMinutes() / 60;
        const { events, hMin, hMax } = getTideEvents(tide);
        const h_above_zh = tideHeightAt(hour, events, hMin, hMax);
        const h_cm = Math.round(h_above_zh * 100 / H_STEP_CM) * H_STEP_CM;
        return Math.max(H_MIN_CM, Math.min(H_MAX_CM, h_cm));
    }

    function loadMareeLayer(date) {
        if (!tideVisible) return;
        if (!date) date = new Date();
        if (mareeLayer) { map.removeLayer(mareeLayer); mareeLayer = null; }
        const level = selectLevel(date);
        if (level === null) return;
        const levelStr = String(level).padStart(3, '0');
        fetch(`data/marees_niveaux/maree_groix_${levelStr}cm.geojson`)
            .then(r => r.ok ? r.json() : null)
            .then(data => {
                if (!data || !data.features || !data.features.length) return;
                mareeLayer = L.geoJSON(data, {
                    style: {
                        fillColor:   '#1565C0',
                        fillOpacity: 0.45,
                        color:       '#0D47A1',
                        weight:      0.5,
                        opacity:     0.6
                    }
                }).addTo(map);
            })
            .catch(() => {});
    }

    // onDateChanged chaînable
    const _prev = window.onDateChanged;
    window.onDateChanged = function (date) {
        if (typeof _prev === 'function') _prev(date);
        loadMareeLayer(date);
    };

    document.addEventListener('DOMContentLoaded', function () {
        const rowMaree = document.getElementById('layer-maree');
        if (rowMaree) {
            rowMaree.classList.toggle('active', tideVisible);

            rowMaree.addEventListener('click', function () {
                tideVisible = !tideVisible;
                rowMaree.classList.toggle('active', tideVisible);

                if (tideVisible) {
                    loadMareeLayer(typeof getDisplayDate === 'function' ? getDisplayDate() : new Date());
                } else {
                    if (mareeLayer) { map.removeLayer(mareeLayer); mareeLayer = null; }
                    // Retour index si plus aucun calque actif
                    const shadowActive = document.getElementById('layer-ombres').classList.contains('active');
                    if (!shadowActive) window.location.href = 'index.html';
                }
            });
        }

        // Toujours charger les données (nécessaire pour activation à la demande)
        fetch('data/marees.json')
            .then(r => r.ok ? r.json() : [])
            .catch(() => [])
            .then(data => {
                mareesLocal = data;
                if (tideVisible) {
                    loadMareeLayer(typeof getDisplayDate === 'function' ? getDisplayDate() : new Date());
                }
            });
    });

})();
