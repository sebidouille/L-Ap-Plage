// Configuration
const CONFIG = {
    SHEET_BASE_URL: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQJyHbc7PkwrZCNp4pk4yRIwskOUu27oWjYt_IBxNYtYG7aAWB2S1leol5nHITv29wUCYEiAczyTY9s/pub?output=csv',
    SHEET_GIDS: {
        PLAGES: 0,
        METEO: 146047806,
        MAREES: 138428367,
        RECOMMANDATIONS: 2049933385,
        BARS: 1057932141,
        RESTAURANTS: 251951681
    },
    GROIX_CENTER: [47.6389, -3.4523],
    ZOOM_LEVEL: 13
};

// État global
let map;
let markers = [];
let plagesData = [];
let mareesData = [];
let meteoData = {};
let barsData = [];
let restaurantsData = [];
let currentDateTime = new Date();
let selectedDateTime = null;
let userPosition = null;

// Système multi-cartes
let currentView = 'plages'; // 'plages', 'bars', 'restaurants'
let selectedBeachMarker = null; // Pour garder le parasol sélectionné

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
        
        // Initialiser le menu de navigation
        initNavMenu();
        
        // Afficher les marqueurs selon la vue actuelle
        updateView();
        
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
    
    // Mapbox - Style personnalisé sans POI commerces
    L.tileLayer('https://api.mapbox.com/styles/v1/rouxseb/cmm38wphm004d01s69zh359me/tiles/{z}/{x}/{y}?access_token=pk.eyJ1Ijoicm91eHNlYiIsImEiOiJjbW0xd3dvcTAwMTZzMnJzZXdyYXFpMjBvIn0.Tq3uFh1jH5n-7OXcfm7MtQ', {
        attribution: '© <a href="https://www.mapbox.com/">Mapbox</a>',
        tileSize: 512,
        zoomOffset: -1,
        maxZoom: 18,
        minZoom: 11
    }).addTo(map);
    
    console.log('Carte Mapbox style personnalisé chargée');
    
    // Ajouter le bouton de géolocalisation
    addGeolocationButton();
}

// Ajouter un bouton de géolocalisation
function addGeolocationButton() {
    const geoButton = L.control({ position: 'topright' });
    
    geoButton.onAdd = function() {
        const div = L.DomUtil.create('div', 'leaflet-bar leaflet-control');
        div.innerHTML = `
            <a href="#" id="geolocate-btn" title="Me localiser" style="
                background: white;
                width: 34px;
                height: 34px;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 20px;
                text-decoration: none;
                color: #333;
                border-radius: 4px;
            ">📍</a>
        `;
        
        L.DomEvent.on(div.querySelector('#geolocate-btn'), 'click', function(e) {
            e.preventDefault();
            geolocateUser();
        });
        
        return div;
    };
    
    geoButton.addTo(map);
}

// Géolocaliser l'utilisateur
let userMarker = null;
let watchId = null;

function geolocateUser() {
    if (!navigator.geolocation) {
        alert('La géolocalisation n\'est pas supportée par votre navigateur');
        return;
    }
    
    // Si déjà en cours de suivi, arrêter
    if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
        if (userMarker) {
            map.removeLayer(userMarker);
            userMarker = null;
        }
        userPosition = null;
        console.log('Suivi de position arrêté');
        return;
    }
    
    showLoading(true);
    
    // Démarrer le suivi en temps réel
    watchId = navigator.geolocation.watchPosition(
        (position) => {
            const lat = position.coords.latitude;
            const lon = position.coords.longitude;
            
            // Sauvegarder la position
            userPosition = { lat, lon };
            
            // Créer ou mettre à jour le marqueur
            if (!userMarker) {
                // Première position : créer le marqueur
                const userIcon = L.divIcon({
                    html: `<div style="
                        width: 20px;
                        height: 20px;
                        background: #9c27b0;
                        border: 3px solid white;
                        border-radius: 50%;
                        box-shadow: 0 0 10px rgba(156, 39, 176, 0.5);
                        animation: pulse 2s infinite;
                    "></div>`,
                    className: '',
                    iconSize: [20, 20],
                    iconAnchor: [10, 10]
                });
                
                userMarker = L.marker([lat, lon], { icon: userIcon })
                    .addTo(map)
                    .bindPopup('📍 Vous êtes ici');
                
                // Centrer la carte sur la première position
                map.setView([lat, lon], 14);
                
                showLoading(false);
                console.log('Suivi de position activé');
            } else {
                // Mettre à jour la position du marqueur
                userMarker.setLatLng([lat, lon]);
            }
        },
        (error) => {
            showLoading(false);
            let message = 'Erreur de géolocalisation';
            
            switch(error.code) {
                case error.PERMISSION_DENIED:
                    message = 'Vous avez refusé l\'accès à votre position';
                    break;
                case error.POSITION_UNAVAILABLE:
                    message = 'Position indisponible';
                    break;
                case error.TIMEOUT:
                    message = 'La demande de géolocalisation a expiré';
                    break;
            }
            
            alert(message);
            
            // Nettoyer en cas d'erreur
            if (watchId !== null) {
                navigator.geolocation.clearWatch(watchId);
                watchId = null;
            }
        },
        {
            enableHighAccuracy: true,
            maximumAge: 0,
            timeout: 5000
        }
    );
}

// Formule de Haversine pour calculer la distance
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Rayon de la Terre en km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    const distance = R * c;
    
    return distance;
}

// Chargement des données depuis Google Sheets
async function loadData() {
    try {
        // Charger les 6 onglets en parallèle
        const [plagesCSV, meteoCSV, mareesCSV, recoCSV, barsCSV, restosCSV] = await Promise.all([
            fetch(`${CONFIG.SHEET_BASE_URL}&gid=${CONFIG.SHEET_GIDS.PLAGES}`).then(r => r.text()),
            fetch(`${CONFIG.SHEET_BASE_URL}&gid=${CONFIG.SHEET_GIDS.METEO}`).then(r => r.text()),
            fetch(`${CONFIG.SHEET_BASE_URL}&gid=${CONFIG.SHEET_GIDS.MAREES}`).then(r => r.text()),
            fetch(`${CONFIG.SHEET_BASE_URL}&gid=${CONFIG.SHEET_GIDS.RECOMMANDATIONS}`).then(r => r.text()),
            fetch(`${CONFIG.SHEET_BASE_URL}&gid=${CONFIG.SHEET_GIDS.BARS}`).then(r => r.text()),
            fetch(`${CONFIG.SHEET_BASE_URL}&gid=${CONFIG.SHEET_GIDS.RESTAURANTS}`).then(r => r.text())
        ]);
        
        // Parser les données
        plagesData = parseCSV(plagesCSV);
        const meteoArray = parseCSV(meteoCSV);
        meteoData = meteoArray[0] || {};
        mareesData = parseCSV(mareesCSV);
        const recoArray = parseCSV(recoCSV);
        barsData = parseCSV(barsCSV);
        restaurantsData = parseCSV(restosCSV);
        
        // Enrichir plagesData avec les couleurs des recommandations
        plagesData.forEach((plage, index) => {
            if (recoArray[index]) {
                plage.couleur = recoArray[index].couleur;
                plage.score = parseFloat(recoArray[index].SCORE_FINAL) || 0;
            }
        });
        
        console.log('Données chargées:', { 
            plages: plagesData.length, 
            marees: mareesData.length,
            bars: barsData.length,
            restaurants: restaurantsData.length
        });
        
    } catch (error) {
        console.error('Erreur de chargement:', error);
        throw error;
    }
}

// Parser CSV simple
function parseCSV(csvText) {
    const lines = csvText.trim().split('\n');
    const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
    
    const data = [];
    for (let i = 1; i < lines.length; i++) {
        const values = parseCSVLine(lines[i]);
        if (values.length > 0 && values[0]) { // Ignorer les lignes vides
            const row = {};
            headers.forEach((header, index) => {
                row[header] = values[index] ? values[index].trim().replace(/"/g, '') : '';
            });
            data.push(row);
        }
    }
    
    return data;
}

// Parser une ligne CSV (gère les virgules dans les guillemets)
function parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        
        if (char === '"') {
            inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
            result.push(current);
            current = '';
        } else {
            current += char;
        }
    }
    result.push(current);
    
    return result;
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
let selectedMarker = null;

function updateMarkers() {
    // Supprimer les anciens marqueurs
    markers.forEach(m => map.removeLayer(m));
    markers = [];
    
    // Créer un marqueur pour chaque plage
    plagesData.forEach(plage => {
        // Utiliser les coordonnées du sheet
        const lat = parseFloat(plage.Latitude || plage.latitude);
        const lon = parseFloat(plage.Longitude || plage.longitude);
        
        if (!lat || !lon || isNaN(lat) || isNaN(lon)) {
            console.warn(`Coordonnées invalides pour ${plage.Nom || plage.nom}`, lat, lon);
            return;
        }
        
        // Utiliser la couleur des recommandations ou calculer le score
        const color = plage.couleur ? getColorFromName(plage.couleur) : getColorFromScore(plage.score || 50);
        const icon = createCustomIcon(color, false);
        
        const marker = L.marker([lat, lon], { icon })
            .addTo(map)
            .bindPopup(() => createPopupContent(plage), {
                autoPan: false,  // Ne pas recentrer la carte
                closeButton: false  // Pas de bouton X (on ferme au clic)
            });
        
        // Changer le liseré au clic
        marker.on('click', function() {
            // Réinitialiser l'ancien marqueur sélectionné
            if (selectedMarker && selectedMarker !== marker) {
                const oldColor = selectedMarker.plageColor;
                selectedMarker.setIcon(createCustomIcon(oldColor, false));
            }
            
            // Mettre le nouveau marqueur en violet
            marker.setIcon(createCustomIcon(color, true));
            selectedMarker = marker;
            marker.plageColor = color;
        });
        
        // Fermer le popup au clic dessus
        marker.on('popupopen', function() {
            const popup = marker.getPopup();
            const popupElement = popup.getElement();
            if (popupElement) {
                // Fermer au clic
                popupElement.addEventListener('click', function(e) {
                    // Ne pas fermer si on clique sur le canvas (graphique)
                    if (e.target.tagName !== 'CANVAS') {
                        map.closePopup();
                        // Réinitialiser le marqueur
                        if (selectedMarker === marker) {
                            marker.setIcon(createCustomIcon(color, false));
                            selectedMarker = null;
                        }
                    }
                });
                
                // Rendre le popup déplaçable
                let isDragging = false;
                let startX, startY;
                let scrollLeft, scrollTop;
                
                const popupContent = popupElement.querySelector('.leaflet-popup-content-wrapper');
                
                if (popupContent) {
                    popupContent.style.cursor = 'grab';
                    
                    popupContent.addEventListener('mousedown', function(e) {
                        // Ne pas déplacer si on clique sur le canvas
                        if (e.target.tagName === 'CANVAS') return;
                        
                        isDragging = true;
                        popupContent.style.cursor = 'grabbing';
                        startX = e.clientX;
                        startY = e.clientY;
                        const mapCenter = map.getCenter();
                        scrollLeft = mapCenter.lng;
                        scrollTop = mapCenter.lat;
                        e.preventDefault();
                    });
                    
                    popupContent.addEventListener('touchstart', function(e) {
                        // Ne pas déplacer si on touche le canvas
                        if (e.target.tagName === 'CANVAS') return;
                        
                        isDragging = true;
                        const touch = e.touches[0];
                        startX = touch.clientX;
                        startY = touch.clientY;
                        const mapCenter = map.getCenter();
                        scrollLeft = mapCenter.lng;
                        scrollTop = mapCenter.lat;
                    }, { passive: true });
                    
                    document.addEventListener('mousemove', function(e) {
                        if (!isDragging) return;
                        
                        const dx = e.clientX - startX;
                        const dy = e.clientY - startY;
                        
                        // Convertir les pixels en degrés (approximatif)
                        const scale = 0.0001;
                        const newLng = scrollLeft - (dx * scale);
                        const newLat = scrollTop + (dy * scale);
                        
                        map.panTo([newLat, newLng], { animate: false });
                    });
                    
                    document.addEventListener('touchmove', function(e) {
                        if (!isDragging) return;
                        
                        const touch = e.touches[0];
                        const dx = touch.clientX - startX;
                        const dy = touch.clientY - startY;
                        
                        const scale = 0.0001;
                        const newLng = scrollLeft - (dx * scale);
                        const newLat = scrollTop + (dy * scale);
                        
                        map.panTo([newLat, newLng], { animate: false });
                    }, { passive: true });
                    
                    document.addEventListener('mouseup', function() {
                        isDragging = false;
                        if (popupContent) popupContent.style.cursor = 'grab';
                    });
                    
                    document.addEventListener('touchend', function() {
                        isDragging = false;
                    });
                }
            }
        });
        
        marker.plageColor = color;
        markers.push(marker);
    });
    
    console.log(`${markers.length} marqueurs créés`);
}

function getColorFromName(colorName) {
    const colorMap = {
        'Vert': 'green',
        'Bleu': 'blue',
        'Orange': 'orange',
        'Rouge': 'red'
    };
    return colorMap[colorName] || 'blue';
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

function createCustomIcon(color, selected = false) {
    const colors = {
        green: '#4caf50',
        blue: '#2196f3',
        orange: '#ff9800',
        red: '#f44336'
    };
    
    const borderColor = selected ? '#9c27b0' : 'white';
    const borderWidth = selected ? '2.5' : '1.5';
    
    const parasol = `
        <svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
            <g transform="rotate(15, 16, 20)">
                <!-- Ombre au sol -->
                <ellipse cx="16" cy="30" rx="6" ry="1.5" fill="rgba(0,0,0,0.2)"/>
                
                <!-- Mât du parasol -->
                <line x1="16" y1="14" x2="16" y2="29" stroke="#333" stroke-width="1.5" stroke-linecap="round"/>
                
                <!-- Pointe en haut du mât -->
                <circle cx="16" cy="3" r="1.2" fill="#666"/>
                
                <!-- Toile du parasol - forme en arc -->
                <path d="M 4 14 Q 4 4, 16 2 Q 28 4, 28 14" 
                      fill="${colors[color]}" 
                      stroke="${borderColor}" 
                      stroke-width="${borderWidth}"
                      stroke-linejoin="round"/>
                
                <!-- Segments blancs/noirs alternés pour le relief -->
                <path d="M 16 2 L 16 14" stroke="rgba(255,255,255,0.3)" stroke-width="1.2"/>
                <path d="M 11 4 L 12 14" stroke="rgba(0,0,0,0.15)" stroke-width="1"/>
                <path d="M 21 4 L 20 14" stroke="rgba(0,0,0,0.15)" stroke-width="1"/>
                <path d="M 7 7 L 9 14" stroke="rgba(255,255,255,0.2)" stroke-width="1"/>
                <path d="M 25 7 L 23 14" stroke="rgba(255,255,255,0.2)" stroke-width="1"/>
                
                <!-- Bords sombres pour définir les segments -->
                <path d="M 4 14 L 16 2" stroke="rgba(0,0,0,0.3)" stroke-width="0.8" fill="none"/>
                <path d="M 28 14 L 16 2" stroke="rgba(0,0,0,0.3)" stroke-width="0.8" fill="none"/>
                <path d="M 11 4 L 12 14" stroke="rgba(0,0,0,0.3)" stroke-width="0.8" fill="none"/>
                <path d="M 21 4 L 20 14" stroke="rgba(0,0,0,0.3)" stroke-width="0.8" fill="none"/>
            </g>
        </svg>
    `;
    
    return L.divIcon({
        html: parasol,
        className: '',
        iconSize: [32, 32],
        iconAnchor: [16, 30],
        popupAnchor: [0, -30]
    });
}

function createPopupContent(plage) {
    const nom = plage.Nom || plage.nom || 'Plage';
    const mareeIdeale = plage['Marée idéale'] || plage.maree_ideale || 'inconnue';
    const score = plage.score || 0;
    const color = plage.couleur ? getColorFromName(plage.couleur) : getColorFromScore(score);
    
    const colorMap = {
        green: '#4caf50',
        blue: '#2196f3',
        orange: '#ff9800',
        red: '#f44336'
    };
    const colorHex = colorMap[color];
    
    const tideInfo = getTideInfo();
    
    // Vérifier si une image existe pour cette plage
    const imageUrl = getPlageImageUrl(nom);
    const imageHtml = imageUrl ? `<img src="${imageUrl}" alt="${nom}" style="width: 100%; height: 150px; object-fit: cover; border-radius: 8px; margin-bottom: 12px;">` : '';
    
    const chartId = `tide-chart-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    const content = `
        <div class="popup-header">
            <div style="display: flex; align-items: center; gap: 10px;">
                <div style="width: 24px; height: 24px; background: ${colorHex}; border: 3px solid white; border-radius: 50%; box-shadow: 0 2px 4px rgba(0,0,0,0.3);"></div>
                <span>${nom}</span>
            </div>
        </div>
        <div class="popup-body">
            ${imageHtml}
            
            <div style="font-size: 13px; line-height: 1.6; margin-bottom: 12px;">
                <p style="margin: 8px 0;"><strong>Marée idéale :</strong> ${mareeIdeale}</p>
                <p style="margin: 8px 0;"><strong>Marée actuelle :</strong> ${tideInfo.arrow} ${tideInfo.status} (${tideInfo.height}m)</p>
            </div>
            
            <div class="tide-chart-container">
                <canvas id="${chartId}"></canvas>
            </div>
            
            <div style="margin-top: 12px; padding-top: 10px; border-top: 1px solid #eee; text-align: center; font-size: 11px; color: #666; font-style: italic;">
                Si c'est pas bien, Allez chez H
            </div>
        </div>
    `;
    
    // Créer le graphique après le rendu
    setTimeout(() => {
        const canvas = document.getElementById(chartId);
        if (canvas) {
            createTideChartInCanvas(canvas, plage);
        }
    }, 300);
    
    return content;
}

// Fonction pour obtenir l'URL de l'image d'une plage
function getPlageImageUrl(nomPlage) {
    console.log('Recherche image pour:', JSON.stringify(nomPlage), 'longueur:', nomPlage.length);
    
    // Map des images de plages
    const images = {
        "Plage des Grands Sables": "images/les-grands-sables.jpg",
        "Les Grands Sables": "images/les-grands-sables.jpg",
        "Port Mélite": "images/port-melite.jpg",
        
        // Toutes les variantes de Côte d'Héno
        "Côte d'Héno": "images/cote-d-heno.jpg",
        "Cote d'Héno": "images/cote-d-heno.jpg",
        "Côte d'Heno": "images/cote-d-heno.jpg",
        "Cote d'Heno": "images/cote-d-heno.jpg",
        "Plage d'Héno": "images/cote-d-heno.jpg",
        "Plage d'Heno": "images/cote-d-heno.jpg",
        "Plage de la Côte d'Héno": "images/cote-d-heno.jpg",
        
        "Poulziorec": "images/poulziorec.jpg",
        "Sables Rouges": "images/les-sables-rouges.jpg",
        "Les Sables Rouges": "images/les-sables-rouges.jpg",
        "Plage du WWF": "images/plage-du-wwf.jpg",
        "Port Coustic": "images/port-coustic.jpg",
        "Port-Coustic": "images/port-coustic.jpg",
        "Plage de Port Coustic": "images/port-coustic.jpg",
        
        // Nouvelles photos
        "Port Melin": "images/port-melin.jpg",
        "Port Lay": "images/port-lay.jpg",
        "Porskedoul": "images/porskedoul.jpg",
        "Porh Morvil": "images/port-morvil.jpg",
        "Porzh er Roued": "images/porhzh-er-roed.jpg",
        "Porzh er roued": "images/porhzh-er-roed.jpg",
        "Le Stang": "images/stang.jpg",
        "Stang": "images/stang.jpg",
        "Baie des Curés": "images/baie-des-cures.jpg",
        "Baie des Cures": "images/baie-des-cures.jpg",
        "Port St Nicolas": "images/port-saint-nicolas.jpg",
        "Port Saint Nicolas": "images/port-saint-nicolas.jpg",
        "Port Saint-Nicolas": "images/port-saint-nicolas.jpg",
        "Locmaria": "images/locmaria.jpg",
        "Pointe des Chats": "images/pointe-des-chats.jpg",
        "Pointe des chats": "images/pointe-des-chats.jpg",
        "Chochaï": "images/chochai.jpg",
        "Chochai": "images/chochai.jpg",
        "Kermarec": "images/kermarec.jpg"
    };
    
    // Recherche exacte d'abord
    let result = images[nomPlage];
    
    console.log('Recherche exacte:', result ? 'trouvée' : 'non trouvée');
    
    // Si toujours pas trouvé, forcer pour "Plage d'Héno" spécifiquement
    if (!result && (nomPlage.includes('Héno') || nomPlage.includes('Heno') || nomPlage.includes('héno') || nomPlage.includes('heno'))) {
        console.log('Détection Héno/heno - Force image');
        result = "images/cote-d-heno.jpg";
    }
    
    console.log('Image finale:', result);
    
    return result || null;
}

function getTideInfo() {
    const now = selectedDateTime || currentDateTime;
    
    // Trouver les données de marée du jour
    const today = now.toISOString().split('T')[0];
    const todayTide = mareesData.find(m => m.date && m.date.startsWith(today));
    
    if (!todayTide) {
        // Fallback si pas de données
        return {
            arrow: '↗️',
            status: 'Montante',
            height: '3.5',
            max_high: '5.3',
            max_low: '0.9'
        };
    }
    
    const hour = now.getHours() + now.getMinutes() / 60;
    
    // Parser les heures de marée
    const parseHour = (timeStr) => {
        if (!timeStr) return null;
        const match = timeStr.match(/(\d+)h(\d+)/);
        if (match) {
            return parseInt(match[1]) + parseInt(match[2]) / 60;
        }
        return null;
    };
    
    const bm1 = parseHour(todayTide.bm1_heure || todayTide.bm1);
    const pm1 = parseHour(todayTide.pm1_heure || todayTide.pm1);
    const bm2 = parseHour(todayTide.bm2_heure || todayTide.bm2);
    const pm2 = parseHour(todayTide.pm2_heure || todayTide.pm2);
    
    const hauteurMax = parseFloat(todayTide.hauteur_max) || 5.3;
    
    // Déterminer si marée montante ou descendante
    let isRising = true;
    let currentHeight = hauteurMax / 2;
    
    if (bm1 && pm1) {
        if (hour < pm1) {
            isRising = true;
            currentHeight = 0.9 + ((hour - (bm1 || 0)) / (pm1 - (bm1 || 0))) * (hauteurMax - 0.9);
        } else if (bm2 && hour < bm2) {
            isRising = false;
            currentHeight = hauteurMax - ((hour - pm1) / (bm2 - pm1)) * (hauteurMax - 0.9);
        } else if (pm2 && hour < pm2) {
            isRising = true;
            currentHeight = 0.9 + ((hour - (bm2 || 12)) / (pm2 - (bm2 || 12))) * (hauteurMax - 0.9);
        } else {
            isRising = false;
            currentHeight = hauteurMax - ((hour - (pm2 || 18)) / 6) * (hauteurMax - 0.9);
        }
    }
    
    return {
        arrow: isRising ? '↗️' : '↘️',
        status: isRising ? 'Montante' : 'Descendante',
        height: Math.max(0.5, Math.min(hauteurMax, currentHeight)).toFixed(1),
        max_high: hauteurMax.toFixed(1),
        max_low: '0.9'
    };
}

// Créer le graphique directement dans un canvas
function createTideChartInCanvas(canvas, plage) {
    // Attendre que Chart.js soit chargé
    if (typeof Chart === 'undefined') {
        console.warn('Chart.js pas encore chargé');
        return;
    }
    
    console.log('Création graphique pour', plage.Nom || plage.nom);
    
    const ctx = canvas.getContext('2d');
    
    // IMPORTANT : Détruire tout graphique existant
    if (canvas.chartInstance) {
        canvas.chartInstance.destroy();
        canvas.chartInstance = null;
    }
    
    // Récupérer les données de marée du jour
    const now = selectedDateTime || currentDateTime;
    const today = now.toISOString().split('T')[0];
    const todayTide = mareesData.find(m => m.date && m.date.startsWith(today));
    
    if (!todayTide) {
        console.warn('Pas de données de marée');
        return;
    }
    
    // Parser les heures
    const parseHour = (timeStr) => {
        if (!timeStr) return null;
        const match = timeStr.match(/(\d+)h(\d+)/);
        return match ? parseInt(match[1]) + parseInt(match[2]) / 60 : null;
    };
    
    const bm1 = parseHour(todayTide.bm1_heure || todayTide.bm1);
    const pm1 = parseHour(todayTide.pm1_heure || todayTide.pm1);
    const bm2 = parseHour(todayTide.bm2_heure || todayTide.bm2);
    const pm2 = parseHour(todayTide.pm2_heure || todayTide.pm2);
    
    const hauteurMax = parseFloat(todayTide.hauteur_max) || 5.3;
    const hauteurMin = 0.9;
    
    // Générer les données avec une vraie courbe sinusoïdale
    const labels = [];
    const data = [];
    
    // Créer une courbe sinusoïdale basée sur les horaires de marée
    for (let h = 0; h <= 24; h += 0.25) {  // Plus de points = courbe plus lisse
        labels.push(h % 1 === 0 ? `${Math.floor(h)}h` : '');
        
        let height = hauteurMax / 2;
        
        if (bm1 && pm1 && bm2 && pm2) {
            // Utiliser une sinusoïde pour une courbe naturelle
            if (h < pm1) {
                // Première montée (bm1 -> pm1)
                const phase = ((h - bm1) / (pm1 - bm1)) * Math.PI;
                height = hauteurMin + ((hauteurMax - hauteurMin) / 2) * (1 - Math.cos(phase));
            } else if (h < bm2) {
                // Première descente (pm1 -> bm2)
                const phase = ((h - pm1) / (bm2 - pm1)) * Math.PI;
                height = hauteurMax - ((hauteurMax - hauteurMin) / 2) * (1 - Math.cos(phase));
            } else if (h < pm2) {
                // Deuxième montée (bm2 -> pm2)
                const phase = ((h - bm2) / (pm2 - bm2)) * Math.PI;
                height = hauteurMin + ((hauteurMax - hauteurMin) / 2) * (1 - Math.cos(phase));
            } else {
                // Après pm2
                const phase = ((h - pm2) / (24 - pm2 + bm1)) * Math.PI * 0.5;
                height = hauteurMax - ((hauteurMax - hauteurMin) / 2) * (1 - Math.cos(phase));
            }
        }
        
        data.push(Math.max(hauteurMin * 0.8, Math.min(hauteurMax * 1.1, height)));
    }
    
    try {
        const currentHour = now.getHours() + now.getMinutes() / 60;
        
        canvas.chartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels,
                datasets: [
                    {
                        label: 'Hauteur (m)',
                        data,
                        borderColor: '#1e88e5',
                        backgroundColor: 'rgba(30, 136, 229, 0.1)',
                        fill: true,
                        tension: 0.9,
                        pointRadius: 0,
                        borderWidth: 2.5
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: (context) => `${context.parsed.y.toFixed(2)}m`
                        }
                    }
                },
                scales: {
                    x: {
                        ticks: {
                            maxRotation: 0,
                            autoSkip: true,
                            maxTicksLimit: 12
                        }
                    },
                    y: {
                        min: 0,
                        max: 6,
                        ticks: { 
                            callback: value => value + 'm',
                            stepSize: 1
                        }
                    }
                }
            },
            plugins: [{
                id: 'currentTimeMarker',
                afterDatasetsDraw: (chart) => {
                    const ctx = chart.ctx;
                    const xAxis = chart.scales.x;
                    const yAxis = chart.scales.y;
                    
                    // Calculer la position X de l'heure actuelle
                    const currentIndex = currentHour * 4; // 4 points par heure
                    const x = xAxis.getPixelForValue(currentIndex);
                    
                    // Dessiner la ligne rouge
                    ctx.save();
                    ctx.strokeStyle = '#f44336';
                    ctx.lineWidth = 2;
                    ctx.setLineDash([5, 5]);
                    ctx.beginPath();
                    ctx.moveTo(x, yAxis.top);
                    ctx.lineTo(x, yAxis.bottom);
                    ctx.stroke();
                    ctx.restore();
                }
            }]
        });
        console.log('✓ Graphique créé avec barre horaire à', currentHour.toFixed(2), 'h');
    } catch (error) {
        console.error('Erreur:', error);
    }
}

// ========================================
// SYSTÈME MULTI-CARTES
// ========================================

// Initialiser le menu de navigation
function initNavMenu() {
    const menuBurger = document.getElementById('menu-burger');
    const navMenu = document.getElementById('nav-menu');
    const menuOverlay = document.getElementById('menu-overlay');
    const closeMenu = document.getElementById('close-menu');
    const navItems = document.querySelectorAll('.nav-item');
    
    console.log('Initialisation menu:', { menuBurger, navMenu, menuOverlay });
    
    if (!menuBurger || !navMenu || !menuOverlay) {
        console.error('Éléments du menu non trouvés !');
        return;
    }
    
    // Ouvrir le menu
    menuBurger.addEventListener('click', () => {
        console.log('Clic sur burger - Ouverture menu');
        navMenu.classList.add('show');
        menuOverlay.classList.add('show');
        console.log('Classes ajoutées - navMenu:', navMenu.className, 'overlay:', menuOverlay.className);
        console.log('Transform du menu:', window.getComputedStyle(navMenu).transform);
    });
    
    // Fermer le menu
    const closeMenuFn = () => {
        console.log('Fermeture menu');
        navMenu.classList.remove('show');
        menuOverlay.classList.remove('show');
    };
    
    closeMenu.addEventListener('click', closeMenuFn);
    menuOverlay.addEventListener('click', closeMenuFn);
    
    // Navigation entre vues
    navItems.forEach(item => {
        item.addEventListener('click', () => {
            const view = item.getAttribute('data-view');
            console.log('Navigation vers:', view);
            switchView(view);
            closeMenuFn();
        });
    });
    
    // Marquer la vue active
    updateActiveNavItem();
    
    console.log('Menu initialisé avec succès');
}

// Mettre à jour l'item actif dans le menu
function updateActiveNavItem() {
    document.querySelectorAll('.nav-item').forEach(item => {
        if (item.getAttribute('data-view') === currentView) {
            item.classList.add('active');
        } else {
            item.classList.remove('active');
        }
    });
}

// Changer de vue
function switchView(view) {
    currentView = view;
    updateActiveNavItem();
    updateView();
}

// Mettre à jour l'affichage selon la vue
function updateView() {
    // Supprimer tous les marqueurs
    markers.forEach(m => map.removeLayer(m));
    markers = [];
    
    // Masquer/afficher les éléments selon la vue
    const legend = document.getElementById('legend');
    const calendarPanel = document.getElementById('calendar-panel');
    const datetimeDisplay = document.getElementById('datetime-display');
    
    switch(currentView) {
        case 'plages':
            legend.style.display = 'flex';
            datetimeDisplay.classList.add('clickable');
            updateMarkers(); // Fonction existante pour les plages
            break;
            
        case 'bars':
            legend.style.display = 'none';
            datetimeDisplay.classList.remove('clickable');
            calendarPanel.classList.add('hidden');
            updateBarsMarkers();
            break;
            
        case 'restaurants':
            legend.style.display = 'none';
            datetimeDisplay.classList.remove('clickable');
            calendarPanel.classList.add('hidden');
            updateRestaurantsMarkers();
            break;
    }
    
    // Ajouter le marqueur de géolocalisation s'il existe
    if (userMarker) {
        userMarker.addTo(map);
    }
    
    // Ajouter le parasol sélectionné s'il existe (pour bars/restos)
    if (selectedBeachMarker && currentView !== 'plages') {
        selectedBeachMarker.addTo(map);
    }
}

// Créer un marqueur cocktail pour les bars
function createCocktailIcon(selected = false) {
    const borderColor = selected ? '#9c27b0' : '#1e88e5';
    const borderWidth = selected ? '3' : '2';
    
    const cocktail = `
        <svg width="32" height="32" viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">
            <ellipse cx="20" cy="38" rx="8" ry="2" fill="rgba(0,0,0,0.2)"/>
            <rect x="18" y="25" width="4" height="10" fill="#666" rx="1"/>
            <ellipse cx="20" cy="35" rx="6" ry="2" fill="#888"/>
            <path d="M 8 8 L 20 25 L 32 8 Z" fill="#4db8ff" fill-opacity="0.7" stroke="${borderColor}" stroke-width="${borderWidth}"/>
            <path d="M 12 10 L 18 20 L 14 12 Z" fill="rgba(255,255,255,0.4)"/>
            <line x1="8" y1="8" x2="32" y2="8" stroke="${borderColor}" stroke-width="2.5" stroke-linecap="round"/>
            <line x1="24" y1="6" x2="24" y2="14" stroke="#ff6b6b" stroke-width="1.5"/>
            <path d="M 20 6 L 24 6 L 28 6 L 24 10 Z" fill="#ff6b6b"/>
        </svg>
    `;
    
    return L.divIcon({
        html: cocktail,
        className: '',
        iconSize: [32, 32],
        iconAnchor: [16, 32],
        popupAnchor: [0, -32]
    });
}

// Créer un marqueur couverts pour les restaurants
function createCouvertsIcon(selected = false) {
    const borderColor = selected ? '#9c27b0' : '#555';
    const borderWidth = selected ? '1.2' : '0.8';
    
    const couverts = `
        <svg width="32" height="32" viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">
            <ellipse cx="20" cy="38" rx="8" ry="2" fill="rgba(0,0,0,0.2)"/>
            <g>
                <rect x="13" y="20" width="2" height="15" fill="#555" rx="1" stroke="${borderColor}" stroke-width="${borderWidth}"/>
                <rect x="11" y="8" width="1.5" height="13" fill="#555" rx="0.5" stroke="${borderColor}" stroke-width="${borderWidth}"/>
                <rect x="13" y="8" width="1.5" height="13" fill="#555" rx="0.5" stroke="${borderColor}" stroke-width="${borderWidth}"/>
                <rect x="15" y="8" width="1.5" height="13" fill="#555" rx="0.5" stroke="${borderColor}" stroke-width="${borderWidth}"/>
                <rect x="11" y="18" width="6" height="3" fill="#555" rx="1" stroke="${borderColor}" stroke-width="${borderWidth}"/>
            </g>
            <g>
                <rect x="25" y="20" width="2" height="15" fill="#555" rx="1" stroke="${borderColor}" stroke-width="${borderWidth}"/>
                <path d="M 23 8 L 29 8 L 27 20 L 25 20 Z" fill="#888" stroke="${borderColor}" stroke-width="${borderWidth}"/>
                <path d="M 25 10 L 26 10 L 25.5 18" fill="rgba(255,255,255,0.3)" stroke="none"/>
            </g>
            <ellipse cx="20" cy="36" rx="10" ry="3" fill="none" stroke="${borderColor}" stroke-width="1.5"/>
        </svg>
    `;
    
    return L.divIcon({
        html: couverts,
        className: '',
        iconSize: [32, 32],
        iconAnchor: [16, 32],
        popupAnchor: [0, -32]
    });
}

// Afficher les marqueurs des bars
function updateBarsMarkers() {
    barsData.forEach(bar => {
        // Filtrer selon la colonne "Validé"
        const valide = bar.Valide || bar.Validé || bar.validé || bar.valide || bar.VALIDE;
        if (valide !== '1' && valide !== 1) return;
        
        const lat = parseFloat(bar.Latitude || bar.latitude || bar.LATITUDE);
        const lon = parseFloat(bar.Longitude || bar.longitude || bar.LONGITUDE);
        
        if (!lat || !lon || isNaN(lat) || isNaN(lon)) {
            console.warn('Coordonnées invalides pour bar:', bar);
            return;
        }
        
        const icon = createCocktailIcon(false);
        const marker = L.marker([lat, lon], { icon })
            .addTo(map)
            .bindPopup(() => createSimplePopup(bar, 'bar'), {
                autoPan: false,
                closeButton: false
            });
        
        // Changer l'icône au clic
        marker.on('click', function() {
            // Réinitialiser l'ancien marqueur sélectionné
            if (selectedMarker && selectedMarker !== marker) {
                const oldType = selectedMarker.markerType;
                const oldIcon = oldType === 'bar' ? createCocktailIcon(false) : createCouvertsIcon(false);
                selectedMarker.setIcon(oldIcon);
            }
            
            // Mettre le nouveau marqueur en sélectionné
            marker.setIcon(createCocktailIcon(true));
            selectedMarker = marker;
        });
        
        // Rendre le popup déplaçable
        marker.on('popupopen', function() {
            const popup = marker.getPopup();
            const popupElement = popup.getElement();
            if (popupElement) {
                makePopupDraggable(popupElement, marker);
            }
        });
        
        marker.markerType = 'bar';
        markers.push(marker);
    });
    
    console.log(`${markers.length} bars affichés sur ${barsData.length} total`);
}

// Afficher les marqueurs des restaurants
function updateRestaurantsMarkers() {
    restaurantsData.forEach(restaurant => {
        // Filtrer selon la colonne "Validé"
        const valide = restaurant.Valide || restaurant.Validé || restaurant.validé || restaurant.valide || restaurant.VALIDE;
        if (valide !== '1' && valide !== 1) return;
        
        const lat = parseFloat(restaurant.Latitude || restaurant.latitude || restaurant.LATITUDE);
        const lon = parseFloat(restaurant.Longitude || restaurant.longitude || restaurant.LONGITUDE);
        
        if (!lat || !lon || isNaN(lat) || isNaN(lon)) {
            console.warn('Coordonnées invalides pour restaurant:', restaurant);
            return;
        }
        
        const icon = createCouvertsIcon(false);
        const marker = L.marker([lat, lon], { icon })
            .addTo(map)
            .bindPopup(() => createSimplePopup(restaurant, 'restaurant'), {
                autoPan: false,
                closeButton: false
            });
        
        // Changer l'icône au clic
        marker.on('click', function() {
            // Réinitialiser l'ancien marqueur sélectionné
            if (selectedMarker && selectedMarker !== marker) {
                const oldType = selectedMarker.markerType;
                const oldIcon = oldType === 'bar' ? createCocktailIcon(false) : createCouvertsIcon(false);
                selectedMarker.setIcon(oldIcon);
            }
            
            // Mettre le nouveau marqueur en sélectionné
            marker.setIcon(createCouvertsIcon(true));
            selectedMarker = marker;
        });
        
        // Rendre le popup déplaçable
        marker.on('popupopen', function() {
            const popup = marker.getPopup();
            const popupElement = popup.getElement();
            if (popupElement) {
                makePopupDraggable(popupElement, marker);
            }
        });
        
        marker.markerType = 'restaurant';
        markers.push(marker);
    });
    
    console.log(`${markers.length} restaurants affichés sur ${restaurantsData.length} total`);
}

// Rendre un popup déplaçable (pour bars et restaurants)
function makePopupDraggable(popupElement, marker) {
    let isDragging = false;
    let startX, startY;
    let scrollLeft, scrollTop;
    
    const popupContent = popupElement.querySelector('.leaflet-popup-content-wrapper');
    
    if (popupContent) {
        popupContent.style.cursor = 'grab';
        
        popupContent.addEventListener('mousedown', function(e) {
            isDragging = true;
            popupContent.style.cursor = 'grabbing';
            startX = e.clientX;
            startY = e.clientY;
            const mapCenter = map.getCenter();
            scrollLeft = mapCenter.lng;
            scrollTop = mapCenter.lat;
            e.preventDefault();
        });
        
        popupContent.addEventListener('touchstart', function(e) {
            isDragging = true;
            const touch = e.touches[0];
            startX = touch.clientX;
            startY = touch.clientY;
            const mapCenter = map.getCenter();
            scrollLeft = mapCenter.lng;
            scrollTop = mapCenter.lat;
        }, { passive: true });
        
        document.addEventListener('mousemove', function(e) {
            if (!isDragging) return;
            
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            
            const scale = 0.0001;
            const newLng = scrollLeft - (dx * scale);
            const newLat = scrollTop + (dy * scale);
            
            map.panTo([newLat, newLng], { animate: false });
        });
        
        document.addEventListener('touchmove', function(e) {
            if (!isDragging) return;
            
            const touch = e.touches[0];
            const dx = touch.clientX - startX;
            const dy = touch.clientY - startY;
            
            const scale = 0.0001;
            const newLng = scrollLeft - (dx * scale);
            const newLat = scrollTop + (dy * scale);
            
            map.panTo([newLat, newLng], { animate: false });
        }, { passive: true });
        
        document.addEventListener('mouseup', function() {
            isDragging = false;
            if (popupContent) popupContent.style.cursor = 'grab';
        });
        
        document.addEventListener('touchend', function() {
            isDragging = false;
        });
    }
}

// Créer un popup enrichi pour bars/restaurants
function createSimplePopup(lieu, type) {
    // Debug : afficher toutes les propriétés disponibles
    console.log('Données lieu:', lieu);
    console.log('Clés disponibles:', Object.keys(lieu));
    
    const nom = lieu.Nom || lieu.nom || lieu.NOM || 'Lieu';
    const adresse = lieu.Adresse || lieu.adresse || lieu.ADRESSE || '';
    
    // URL du site web
    const url = lieu.URL || lieu.url || lieu.Url || lieu.Site || lieu.site || lieu.SITE || lieu.Web || lieu.web || '';
    
    // Horaires (avec | comme séparateur pour les sauts de ligne)
    const horairesRaw = lieu.Horaires || lieu.horaires || lieu.HORAIRES || '';
    const horaires = horairesRaw ? horairesRaw.split('|').map(h => h.trim()).join('<br>') : '';
    
    // Téléphone
    const telephone = lieu.Téléphone || lieu.Telephone || lieu.telephone || lieu.Tel || lieu.tel || lieu.TEL || '';
    
    // Description - essayer toutes les variantes possibles
    const description = lieu.Description || lieu.description || lieu.DESCRIPTION || 
                       lieu.Desciption || lieu.desciption || lieu.DESCIPTION || // Avec typo courante
                       lieu.Desc || lieu.desc || lieu.DESC || '';
    
    console.log('Description trouvée:', description);
    
    // Photo - essayer toutes les variantes possibles
    const photoFilename = lieu.Photo || lieu.photo || lieu.PHOTO || 
                         lieu.Image || lieu.image || lieu.IMAGE || '';
    
    console.log('Photo trouvée:', photoFilename);
    
    const photoUrl = photoFilename ? `images/${photoFilename}` : '';
    
    const icon = type === 'bar' ? '🍸' : '🍴';
    
    // Générer le HTML de la photo si elle existe
    const photoHTML = photoUrl ? `<img src="${photoUrl}" alt="${nom}" style="width: 100%; height: 150px; object-fit: cover; border-radius: 8px; margin-bottom: 12px;">` : '';
    
    // Générer le bouton site web si URL existe
    const siteButton = url && url.trim() !== '' ? `
        <a href="${url.startsWith('http') ? url : 'https://' + url}" 
           target="_blank"
           style="
               display: inline-block;
               background: #1e88e5;
               color: white;
               text-decoration: none;
               padding: 8px 16px;
               border-radius: 8px;
               font-size: 13px;
               font-weight: 600;
               margin-right: 8px;
           ">
            🌐 Site web
        </a>
    ` : '';
    
    // Générer le bouton téléphone si numéro existe
    const telButton = telephone && telephone.trim() !== '' ? `
        <a href="tel:${telephone.replace(/\s/g, '')}" 
           style="
               display: inline-block;
               background: #4caf50;
               color: white;
               text-decoration: none;
               padding: 8px 16px;
               border-radius: 8px;
               font-size: 13px;
               font-weight: 600;
           ">
            📞 Appeler
        </a>
    ` : '';
    
    const content = `
        <div style="min-width: 220px; max-width: 280px;">
            ${photoHTML}
            
            <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 12px;">
                <span style="font-size: 24px;">${icon}</span>
                <strong style="font-size: 16px;">${nom}</strong>
            </div>
            
            ${adresse ? `<p style="margin: 8px 0; color: #666; font-size: 14px;">📍 ${adresse}</p>` : ''}
            
            ${horaires ? `
                <div style="margin: 12px 0; padding: 10px; background: #f5f5f5; border-radius: 6px;">
                    <div style="font-weight: 600; font-size: 13px; margin-bottom: 6px;">🕒 Horaires</div>
                    <div style="font-size: 12px; color: #555; line-height: 1.6;">${horaires}</div>
                </div>
            ` : ''}
            
            ${telephone ? `<p style="margin: 8px 0; font-size: 14px; color: #555;">📞 ${telephone}</p>` : ''}
            
            ${description ? `<p style="margin: 12px 0; font-size: 13px; color: #666; font-style: italic;">${description}</p>` : ''}
            
            ${siteButton || telButton ? `
                <div style="margin-top: 12px; display: flex; flex-wrap: wrap; gap: 8px;">
                    ${siteButton}
                    ${telButton}
                </div>
            ` : ''}
        </div>
    `;
    
    return content;
}

// Charger les données des bars et restaurants
async function loadBarsRestaurants() {
    try {
        const [barsCSV, restosCSV] = await Promise.all([
            fetch(`${CONFIG.SHEET_BASE_URL}&gid=${CONFIG.SHEET_GIDS.BARS}`).then(r => r.text()),
            fetch(`${CONFIG.SHEET_BASE_URL}&gid=${CONFIG.SHEET_GIDS.RESTAURANTS}`).then(r => r.text())
        ]);
        
        barsData = parseCSV(barsCSV);
        restaurantsData = parseCSV(restosCSV);
        
        console.log('Données chargées:', { bars: barsData.length, restaurants: restaurantsData.length });
    } catch (error) {
        console.error('Erreur de chargement bars/restaurants:', error);
    }
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
