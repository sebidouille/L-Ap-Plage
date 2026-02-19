// Configuration
const CONFIG = {
    SHEET_URL: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQJyHbc7PkwrZCNp4pk4yRIwskOUu27oWjYt_IBxNYtYG7aAWB2S1leol5nHITv29wUCYEiAczyTY9s/pub?output=csv',
    GROIX_CENTER: [47.6389, -3.4523],
    ZOOM_LEVEL: 13
};

// État global
let map;
let markers = [];
let plagesData = [];
let mareesData = [];
let meteoData = {};
let currentDateTime = new Date();
let selectedDateTime = null;

// Initialisation
document.addEventListener('DOMContentLoaded', init);

async function init() {
    showLoading(true);
    
    try {
        // Initialiser la carte
        initMap();
        
        // Charger les données
        await loadData();
        
        // Initialiser l'UI
        initUI();
        
        // Afficher les marqueurs
        updateMarkers();
        
        showLoading(false);
    } catch (error) {
        console.error('Erreur d\'initialisation:', error);
        alert('Erreur de chargement des données. Vérifiez votre connexion.');
        showLoading(false);
    }
}

// Initialisation de la carte
function initMap() {
    map = L.map('map', {
        zoomControl: true,
        attributionControl: false
    }).setView(CONFIG.GROIX_CENTER, CONFIG.ZOOM_LEVEL);
    
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 18,
        minZoom: 11
    }).addTo(map);
}

// Chargement des données depuis Google Sheets
async function loadData() {
    try {
        // Charger toutes les feuilles
        const response = await fetch(CONFIG.SHEET_URL.replace('pub?output=csv', 'pub?output=csv&gid=0'));
        const csvText = await response.text();
        
        // Parser les données (simplifié - à adapter selon la structure réelle)
        await parseSheetData(csvText);
        
    } catch (error) {
        console.error('Erreur de chargement:', error);
        throw error;
    }
}

async function parseSheetData(csvText) {
    // Pour l'instant, utilisons des données de test
    // Dans la version finale, on parsera le CSV correctement
    
    // Données de test
    plagesData = [
        { nom: "Porh Morvil", lat: 47.6424, lon: -3.4302, maree_ideale: ["haute"], orientation: "S" },
        { nom: "Porzh er Roued", lat: 47.6389, lon: -3.4246, maree_ideale: ["haute", "mi"], orientation: "SO" },
        { nom: "Plage des Grands Sables", lat: 47.6376, lon: -3.4179, maree_ideale: ["basse", "mi", "haute"], orientation: "E" },
        { nom: "Port Lay", lat: 47.6453, lon: -3.4602, maree_ideale: ["haute", "mi"], orientation: "N" },
        { nom: "Poulziorec", lat: 47.6492, lon: -3.4789, maree_ideale: ["basse"], orientation: "N-NO" }
    ];
    
    mareesData = [
        { date: "2026-02-19", coef_matin: 97, coef_soir: 98, bm1: "11:59", pm1: "05:40", bm2: "", pm2: "17:59", hauteur_max: 5.29 },
        { date: "2026-02-20", coef_matin: 98, coef_soir: 98, bm1: "00:12", pm1: "06:13", bm2: "12:36", pm2: "18:31", hauteur_max: 5.30 }
    ];
    
    meteoData = {
        direction_vent: 310,
        force_vent_kmh: 28,
        temperature_c: 12
    };
}

// Initialisation de l'UI
function initUI() {
    // Date/Heure actuelle
    updateDateTime();
    setInterval(updateDateTime, 1000);
    
    // Événements
    document.getElementById('datetime-display').addEventListener('click', toggleCalendar);
    document.getElementById('btn-now').addEventListener('click', resetToNow);
    document.getElementById('btn-validate').addEventListener('click', validateDateTime);
    document.getElementById('btn-cancel').addEventListener('click', () => toggleCalendar(false));
    
    // Générer le sélecteur de dates
    generateDateSelector();
    
    // Générer le sélecteur d'heures
    generateHourSelector();
}

function updateDateTime() {
    const now = selectedDateTime || currentDateTime;
    
    const dateOptions = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
    const dateStr = now.toLocaleDateString('fr-FR', dateOptions);
    
    const timeStr = now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    
    document.getElementById('current-date').textContent = dateStr;
    document.getElementById('current-time').textContent = timeStr;
    
    if (!selectedDateTime) {
        currentDateTime = new Date();
    }
}

function toggleCalendar(show = null) {
    const panel = document.getElementById('calendar-panel');
    if (show === null) {
        panel.classList.toggle('hidden');
    } else {
        if (show) {
            panel.classList.remove('hidden');
        } else {
            panel.classList.add('hidden');
        }
    }
}

function generateDateSelector() {
    const container = document.getElementById('date-selector');
    const today = new Date();
    
    for (let i = 0; i < 10; i++) {
        const date = new Date(today);
        date.setDate(today.getDate() + i);
        
        const btn = document.createElement('button');
        btn.className = 'date-btn';
        if (i === 0) btn.classList.add('selected');
        
        const dayNum = document.createElement('span');
        dayNum.className = 'day-num';
        dayNum.textContent = date.getDate();
        
        const dayName = document.createElement('span');
        dayName.className = 'day-name';
        dayName.textContent = date.toLocaleDateString('fr-FR', { weekday: 'short' });
        
        btn.appendChild(dayNum);
        btn.appendChild(dayName);
        btn.dataset.date = date.toISOString().split('T')[0];
        
        btn.addEventListener('click', () => {
            document.querySelectorAll('.date-btn').forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
        });
        
        container.appendChild(btn);
    }
}

function generateHourSelector() {
    const select = document.getElementById('hour-selector');
    
    for (let h = 0; h < 24; h++) {
        const option = document.createElement('option');
        option.value = h;
        option.textContent = `${h.toString().padStart(2, '0')}:00`;
        select.appendChild(option);
    }
    
    select.value = new Date().getHours();
}

function resetToNow() {
    selectedDateTime = null;
    updateDateTime();
    updateMarkers();
    toggleCalendar(false);
}

function validateDateTime() {
    const selectedDateBtn = document.querySelector('.date-btn.selected');
    const selectedHour = document.getElementById('hour-selector').value;
    
    if (selectedDateBtn) {
        const date = new Date(selectedDateBtn.dataset.date);
        date.setHours(parseInt(selectedHour), 0, 0, 0);
        selectedDateTime = date;
        updateDateTime();
        updateMarkers();
    }
    
    toggleCalendar(false);
}

// Mise à jour des marqueurs
function updateMarkers() {
    // Supprimer les anciens marqueurs
    markers.forEach(m => map.removeLayer(m));
    markers = [];
    
    // Calculer les conditions pour chaque plage
    plagesData.forEach(plage => {
        const score = calculateBeachScore(plage);
        const color = getColorFromScore(score);
        const icon = createCustomIcon(color);
        
        const marker = L.marker([plage.lat, plage.lon], { icon })
            .addTo(map)
            .bindPopup(() => createPopupContent(plage, score));
        
        markers.push(marker);
    });
}

function calculateBeachScore(plage) {
    // Calcul simplifié du score
    // Dans la version complète, on utilisera les vraies formules du Google Sheet
    
    const scoreVent = calculateWindScore(plage, meteoData.direction_vent);
    const scoreMaree = calculateTideScore(plage);
    const scoreSoleil = 8; // Fixe pour l'instant
    
    return (scoreVent * 0.5 + scoreMaree * 0.3 + scoreSoleil * 0.2) * 10;
}

function calculateWindScore(plage, windDirection) {
    // Score de 0 à 10 basé sur la direction du vent
    // Plus le vent est aligné avec l'orientation idéale, meilleur le score
    return Math.random() * 10; // Simplifié pour le moment
}

function calculateTideScore(plage) {
    // Score basé sur la marée actuelle vs idéale
    const currentTide = getCurrentTideState();
    
    if (plage.maree_ideale.includes(currentTide)) {
        return 10;
    } else if (plage.maree_ideale.length === 3) {
        return 9; // Bonne à toutes marées
    } else {
        return 5;
    }
}

function getCurrentTideState() {
    // Détermine si on est en marée basse, mi, ou haute
    // Basé sur l'heure actuelle et les horaires de marée
    
    const now = selectedDateTime || currentDateTime;
    const hour = now.getHours() + now.getMinutes() / 60;
    
    // Simplifié : on considère des cycles de 6h
    const cycle = hour % 12;
    
    if (cycle < 2 || cycle > 10) return "haute";
    if (cycle > 4 && cycle < 8) return "basse";
    return "mi";
}

function getColorFromScore(score) {
    if (score >= 75) return 'green';
    if (score >= 60) return 'blue';
    if (score >= 40) return 'orange';
    return 'red';
}

function createCustomIcon(color) {
    const colors = {
        green: '#4caf50',
        blue: '#2196f3',
        orange: '#ff9800',
        red: '#f44336'
    };
    
    const html = `
        <div style="
            width: 24px;
            height: 24px;
            background: ${colors[color]};
            border: 3px solid white;
            border-radius: 50%;
            box-shadow: 0 2px 6px rgba(0,0,0,0.3);
        "></div>
    `;
    
    return L.divIcon({
        html,
        className: '',
        iconSize: [24, 24],
        iconAnchor: [12, 12]
    });
}

function createPopupContent(plage, score) {
    const color = getColorFromScore(score);
    const emoji = { green: '😃', blue: '🙂', orange: '😐', red: '☹️' }[color];
    
    const tideState = getCurrentTideState();
    const tideInfo = getTideInfo();
    
    const content = `
        <div class="popup-header">
            ${emoji} ${plage.nom}
        </div>
        <div class="popup-body">
            <div class="popup-section">
                <h4>Marée idéale</h4>
                <p>${plage.maree_ideale.join(', ')}</p>
            </div>
            
            <div class="popup-section">
                <h4>Marée actuelle</h4>
                <div class="tide-status">
                    <span class="tide-arrow">${tideInfo.arrow}</span>
                    <span>${tideInfo.status} (${tideInfo.height}m)</span>
                </div>
            </div>
            
            <div class="popup-section">
                <p>🔺 Max haut: ${tideInfo.max_high}m</p>
                <p>🔻 Max bas: ${tideInfo.max_low}m</p>
            </div>
            
            <div class="tide-chart-container">
                <canvas id="tide-chart-${plage.nom.replace(/\s/g, '')}"></canvas>
            </div>
        </div>
    `;
    
    // Créer le graphique après un court délai
    setTimeout(() => createTideChart(plage), 100);
    
    return content;
}

function getTideInfo() {
    // Informations sur la marée actuelle
    const now = selectedDateTime || currentDateTime;
    const hour = now.getHours() + now.getMinutes() / 60;
    
    // Simplifié - dans la vraie version, on utilisera les données MAREES
    const cycle = hour % 12;
    const isRising = cycle < 6;
    
    return {
        arrow: isRising ? '↗️' : '↘️',
        status: isRising ? 'Montante' : 'Descendante',
        height: (3 + Math.sin((cycle / 6) * Math.PI) * 2).toFixed(1),
        max_high: '5.3',
        max_low: '0.9'
    };
}

function createTideChart(plage) {
    const canvasId = `tide-chart-${plage.nom.replace(/\s/g, '')}`;
    const canvas = document.getElementById(canvasId);
    
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    
    // Données du graphique (courbe sinusoïdale simplifiée)
    const labels = [];
    const data = [];
    
    for (let h = 0; h < 24; h += 2) {
        labels.push(`${h}h`);
        data.push(3 + Math.sin((h / 6) * Math.PI) * 2);
    }
    
    new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [{
                label: 'Hauteur (m)',
                data,
                borderColor: '#1e88e5',
                backgroundColor: 'rgba(30, 136, 229, 0.1)',
                fill: true,
                tension: 0.4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                y: {
                    min: 0,
                    max: 6,
                    ticks: { callback: value => value + 'm' }
                }
            }
        }
    });
}

// Utilitaires
function showLoading(show) {
    const loading = document.getElementById('loading');
    if (show) {
        loading.classList.remove('hidden');
    } else {
        loading.classList.add('hidden');
    }
}

// Service Worker (pour PWA)
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('service-worker.js')
        .then(reg => console.log('Service Worker enregistré'))
        .catch(err => console.log('Erreur Service Worker:', err));
}
