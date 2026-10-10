#!/bin/sh
# Conquête — installation sur Raspberry Pi (ou tout Linux avec systemd)
# Le jeu démarre tout seul à l'allumage et reste accessible depuis l'iPad sur le Wi-Fi de la maison.
#   ./raspberry/installer.sh            installe et démarre le service (port 8790)
#   ./raspberry/installer.sh 8800       idem sur un autre port
#   ./raspberry/installer.sh --retirer  arrête et supprime le service
set -e
DIR="$(cd "$(dirname "$0")/.." && pwd)"
SERVICE=web_conquete
UNIT=/etc/systemd/system/$SERVICE.service

if [ "$1" = "--retirer" ]; then
  sudo systemctl disable --now "$SERVICE" 2>/dev/null || true
  sudo rm -f "$UNIT"
  sudo systemctl daemon-reload
  echo "Service $SERVICE retiré. Les sauvegardes restent dans $DIR/saves."
  exit 0
fi

PORT="${1:-8790}"
PY="$(command -v python3 || true)"
if [ -z "$PY" ]; then
  echo "Python 3 est introuvable. Installez-le avec : sudo apt install python3"
  exit 1
fi
"$PY" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 8) else 1)' || { echo "Python 3.8 ou plus récent est nécessaire."; exit 1; }

sudo tee "$UNIT" > /dev/null <<UNITEOF
[Unit]
Description=Conquête, jeu de stratégie (Aquitaine 1790)
After=network-online.target
Wants=network-online.target

[Service]
User=$(id -un)
WorkingDirectory=$DIR
ExecStart=$PY $DIR/server.py --lan --port $PORT --no-browser
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
UNITEOF

sudo systemctl daemon-reload
sudo systemctl enable --now "$SERVICE"
# attend que le Wi-Fi ait une adresse (au plus 30 s)
IP=""
for i in $(seq 1 15); do
  IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
  [ -n "$IP" ] && break
  sleep 2
done
echo ""
echo "Conquête tourne sur le Raspberry et démarrera à chaque allumage (sans navigateur)."
echo "Sur l'iPad, un téléphone ou un PC du réseau local, ouvrez :"
[ -n "$IP" ] && echo "    http://$IP:$PORT"
echo "    http://$(hostname).local:$PORT"
echo ""
echo "Ces adresses sont aussi écrites dans $DIR/adresse-reseau.txt"
echo "État du service : sudo systemctl status $SERVICE"
echo "Journal         : journalctl -u $SERVICE -f"
