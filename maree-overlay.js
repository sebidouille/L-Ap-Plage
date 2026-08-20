// maree-overlay.js — Couche GeoJSON marée pour maree.html / ombre.html
// Doit être chargé AVANT app.js

// Signaler à app.js qu'on est sur la page marée
window.MAREE_MODE = true;

(function () {
    'use strict';

    const H_MIN_CM  = 60;    // premier niveau non vide
    const H_MAX_CM  = 620;
    const H_STEP_CM = 20;

    let mareeLayer  = null;
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

    // ── Sélection du niveau précalculé ──────────────────────────────────────
    function selectLevel(date) {
        const today = date.toISOString().split('T')[0];
        const tide  = mareesLocal.find(m => (m.date || '').substring(0, 10) === today);
        if (!tide) return null;

        const hour = date.getHours() + date.getMinutes() / 60;
        const { events, hMin, hMax } = getTideEvents(tide);
        const h_above_zh = tideHeightAt(hour, events, hMin, hMax);  // mètres au-dessus du ZH

        // Arrondir au pas de 20 cm le plus proche
        const h_cm = Math.round(h_above_zh * 100 / H_STEP_CM) * H_STEP_CM;
        return Math.max(H_MIN_CM, Math.min(H_MAX_CM, h_cm));
    }

    // ── Chargement de la couche GeoJSON ─────────────────────────────────────
    function loadMareeLayer(date) {
        if (!date) date = new Date();
        if (mareeLayer) { map.removeLayer(mareeLayer); mareeLayer = null; }

        const level = selectLevel(date);
        if (level === null) return;

        const levelStr = String(level).padStart(3, '0');
        const path = `data/marees_niveaux/maree_groix_${levelStr}cm.geojson`;

        fetch(path)
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

    // Hook chaînable : appelle l'éventuel handler précédent, puis charge la marée
    const _prevOnDateChanged = window.onDateChanged;
    window.onDateChanged = function (date) {
        if (typeof _prevOnDateChanged === 'function') _prevOnDateChanged(date);
        loadMareeLayer(date);
    };

    // ── Init ─────────────────────────────────────────────────────────────────
    document.addEventListener('DOMContentLoaded', function () {
        const rowMaree = document.getElementById('layer-maree');
        if (rowMaree) {
            rowMaree.classList.add('active');
            rowMaree.addEventListener('click', function () {
                window.location.href = 'index.html';
            });
        }

        // Charger les données marée indépendamment
        fetch('data/marees.json')
            .then(r => r.ok ? r.json() : [])
            .catch(() => [])
            .then(data => {
                mareesLocal = data;
                loadMareeLayer(typeof getDisplayDate === 'function' ? getDisplayDate() : new Date());
            });
    });

})();
