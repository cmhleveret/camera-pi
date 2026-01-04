# Raspberry Pi: Auto-start Next.js app + Camera MJPEG server on boot (systemd)

This guide sets up **two systemd services** so your Raspberry Pi will automatically start:

- **Next.js app** on boot (LAN accessible on port **3000**)
- **Camera MJPEG server** on boot (stream on port **8080**)

---

## 1) Build your Next.js app for production (recommended)

```bash
cd ~/camera-pi
npm ci
npm run build
```

Make sure your `package.json` includes a LAN-bind start script:

```json
{
  "scripts": {
    "start": "next start -H 0.0.0.0 -p 3000"
  }
}
```

---

## 2) Create a systemd service for Next.js

Create the service file:

```bash
sudo nano /etc/systemd/system/pi-web.service
```

Paste (edit `WorkingDirectory` if your project path differs):

```ini
[Unit]
Description=Pi Next.js App
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/camera-pi
Environment=NODE_ENV=production
EnvironmentFile=/home/pi/camera-pi/.env.local
ExecStart=/usr/bin/npm run start
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

Enable + start it:

```bash
sudo systemctl daemon-reload
sudo systemctl enable pi-web
sudo systemctl start pi-web
```

View logs:

```bash
journalctl -u pi-web -f
```

---

## 3) Create a systemd service for the camera MJPEG server

> Update the python script path/name if yours is different  
> e.g. `/home/pi/mjpeg_server.py` or `/home/pi/mjpeg_server_http.py`

Create the service file:

```bash
sudo nano /etc/systemd/system/pi-cam.service
```

Paste:

```ini
[Unit]
Description=Pi Camera MJPEG Server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi
ExecStart=/usr/bin/python3 /home/pi/mjpeg_server.py
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
```

Enable + start it:

```bash
sudo systemctl daemon-reload
sudo systemctl enable pi-cam
sudo systemctl start pi-cam
```

View logs:

```bash
journalctl -u pi-cam -f
```

---

## 4) Reboot test

```bash
sudo reboot
```

After reboot, verify services are running:

```bash
sudo systemctl status pi-web pi-cam
```

---

## 5) LAN access URLs

From another device on the same network:

- Next.js UI: `http://<pi-ip>:3000`
- Camera stream: `http://<pi-ip>:8080/stream.mjpg`

---

## 6) Useful systemd commands

Restart/stop/start:

```bash
sudo systemctl restart pi-web
sudo systemctl stop pi-web
sudo systemctl start pi-web

sudo systemctl restart pi-cam
sudo systemctl stop pi-cam
sudo systemctl start pi-cam
```

Disable on boot:

```bash
sudo systemctl disable pi-web
sudo systemctl disable pi-cam
```

Tail logs:

```bash
journalctl -u pi-web -f
journalctl -u pi-cam -f
```
