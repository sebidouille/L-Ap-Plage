/**
 * VOTES TURBIDITÉ — L'Ap'Plage
 *
 * INSTALLATION :
 *   1. Sur script.google.com → Nouveau projet (standalone)
 *   2. Supprimer Code.gs, créer turbidite.gs et coller ce code
 *   3. Créer l'onglet "votes_turbidite" dans le Sheet
 *      (colonnes : timestamp | plage_id | valeur)
 *   4. Déployer → Nouveau déploiement → Application Web
 *      - Exécuter en tant que : Moi
 *      - Accès : Tout le monde
 *   5. Copier l'URL de déploiement dans turbidite.js → TURBIDITE_GS_URL
 */

var SPREADSHEET_ID = '168vuYnQBYwh3vx_g-pIIqEnUegJXeZOIZQ74VHBK-sA';
var SHEET_VOTES    = 'votes_turbidite';
var FENETRE_H      = 24; // heures glissantes pour agréger les votes

// ============================================================
// GET — lecture votes (?action=votes&plage=xxx)
//       enregistrement vote (?action=vote&plage=xxx&valeur=0.5)
// ============================================================
function doGet(e) {
  var action = e.parameter.action || '';
  var plage  = e.parameter.plage  || '';

  var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(SHEET_VOTES);
  if (!sheet) return jsonResponse({ error: 'onglet introuvable' });

  // --- Enregistrement d'un vote ---
  if (action === 'vote') {
    var valeur = parseFloat(e.parameter.valeur);
    if (!plage || isNaN(valeur) || valeur < 0 || valeur > 1) {
      return jsonResponse({ error: 'données invalides' });
    }
    sheet.appendRow([new Date().toISOString(), plage, valeur]);
    return jsonResponse({ ok: true });
  }

  // --- Lecture agrégée ---
  if (action === 'votes') {
    if (!plage) return jsonResponse({ error: 'plage manquante' });
    var now    = new Date();
    var cutoff = new Date(now.getTime() - FENETRE_H * 3600 * 1000);
    var data   = sheet.getDataRange().getValues();
    var votes  = [];
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      var ts  = new Date(row[0]);
      if (row[1] === plage && ts >= cutoff) {
        votes.push(parseFloat(row[2]));
      }
    }
    var nb  = votes.length;
    var moy = nb > 0 ? votes.reduce(function(a, b) { return a + b; }, 0) / nb : null;
    return jsonResponse({ nb_votes_recents: nb, moyenne_votes: moy });
  }

  return jsonResponse({ error: 'action inconnue' });
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
