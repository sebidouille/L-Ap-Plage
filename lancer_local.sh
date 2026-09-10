#!/bin/bash
# Lance L'Ap'Plage en local sur http://localhost:8080
# Le site en ligne n'est pas touché.

PORT=8080
DIR="$(cd "$(dirname "$0")" && pwd)"

echo "L'Ap'Plage — serveur local"
echo "  URL  : http://localhost:$PORT"
echo "  Ctrl+C pour arrêter"
echo ""
echo "⚠️  Dans les DevTools du navigateur (F12) :"
echo "   Onglet Application > Service Workers"
echo "   → cocher 'Bypass for network' (ignore le cache SW pendant les essais)"
echo ""

# Ouvrir le navigateur après 1 seconde
(sleep 1 && xdg-open "http://localhost:$PORT") &

cd "$DIR"
python3 -m http.server $PORT
