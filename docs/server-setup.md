# Server Setup (grimoire.local)

How to set up Grimoire on `grimoire.local` — the machine that owns the KB.

`grimoire.local` is the hostname of your local AI device. Add it to `/etc/hosts` on every machine that needs to reach it.

---

## 1. Clone repos

```bash
cd ~/src/me
git clone <engine-repo> grimoire

cd ~/data
git clone <kb-repo> grimoire-kb
```

## 2. Install dependencies

```bash
cd ~/src/me/grimoire
npm install
```

## 3. Configure environment

```bash
cp .env.example .env
```

`.env` on `grimoire.local` (local mode — direct KB access):
```bash
GRIMOIRE_ROOT=~/data/grimoire-kb
OLLAMA_HOST=http://grimoire.local:11434
GRIMOIRE_PORT=3663
```

## 4. Hosts file — add `grimoire.local` to this machine

`grimoire.local` should resolve on this machine itself:
```bash
grep grimoire.local /etc/hosts
# Should show: 127.0.0.1  grimoire.local
```

If missing:
```bash
echo "127.0.0.1  grimoire.local" | sudo tee -a /etc/hosts
```

## 5. Verify Ollama is running

```bash
curl http://grimoire.local:11434/api/tags
# Should list your models
```

## 6. Open firewall port

```bash
# ufw (Ubuntu/Debian)
sudo ufw allow 3663/tcp comment 'Grimoire server'
sudo ufw reload
```

## 7. Build the initial index

```bash
grim scribe
# 📖 The Scribe has spoken.
```

## 8. Start the server

```bash
grim serve
# ░ Grimoire online. http://0.0.0.0:3663
```

### Run as a systemd service (persistent across reboots)

```bash
sudo tee /etc/systemd/system/grimoire.service > /dev/null <<EOF
[Unit]
Description=Grimoire Knowledge Graph Server
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$HOME/src/me/grimoire
EnvironmentFile=$HOME/src/me/grimoire/.env
ExecStart=$(which node) bin/grim-server.js
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable grimoire
sudo systemctl start grimoire
sudo systemctl status grimoire
```

## 9. Nightly ritual (cron)

```bash
crontab -e
# Add (adjust path to match your setup):
17 19 * * 1-5 cd $HOME/src/me/grimoire && node bin/grim-ritual.js >> $HOME/data/grimoire-kb/logs/ritual.log 2>&1
```

Schedule during work hours when Ollama is warm. Avoid 2 AM.

---

## Verify everything

```bash
# Health check (on grimoire.local)
curl http://grimoire.local:3663/health

# From another LAN machine
curl http://grimoire.local:3663/health
# → {"status":"ok","entities":7,"edges":5}
```
