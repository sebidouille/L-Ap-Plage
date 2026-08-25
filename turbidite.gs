/**
 * VOTES TURBIDITÉ — L'Ap'Plage
 *
 * INSTALLATION :
 *   1. Dans le Google Sheet → Extensions > Apps Script
 *   2. Créer un fichier turbidite.gs et coller ce code
 *   3. Créer l'onglet "votes_turbidite" dans le Sheet
 *      (colonnes : timestamp | plage_id | valeur)
 *   4. Déployer → Nouveau déploiement → Application Web
 *      - Exécuter en tant que : Moi
 *      - Accès : Tout le monde
 *   5. Copier l'URL de déploiement dans turbidite.js → TURBIDITE_GS_URL
 */

var SHEET_VOTES = 'votes_turbidite';
var FENETRE_H   = 24; // heures glissantes pour agréger les votes

// ============================================================
// GET — lecture agrégée des votes d'une plage
// ============================================================
function doGet(e) {
  var action = e.parameter.action || '';
  var plage  = e.parameter.plage  || '';

  if (action !== 'votes' || !plage) {
    return jsonResponse({ error: 'paramètres manquants' });
  }

  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_VOTES);
  if (!sheet) return jsonResponse({ error: 'onglet introuvable' });

  var now      = new Date();
  var cutoff   = new Date(now.getTime() - FENETRE_H * 3600 * 1000);
  var data     = sheet.getDataRange().getValues();
  var votes    = [];

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

// ============================================================
// POST — enregistrement d'un vote
// ============================================================
function doPost(e) {
  try {
    var body   = JSON.parse(e.postData.contents);
    var plage  = body.plage;
    var valeur = parseFloat(body.valeur);

    if (!plage || isNaN(valeur) || valeur < 0 || valeur > 1) {
      return jsonResponse({ error: 'données invalides' });
    }

    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(SHEET_VOTES);
    if (!sheet) return jsonResponse({ error: 'onglet introuvable' });

    sheet.appendRow([new Date().toISOString(), plage, valeur]);
    return jsonResponse({ ok: true });

  } catch (err) {
    return jsonResponse({ error: err.toString() });
  }
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
