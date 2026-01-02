# Raspberry Pi: Next.js + Tailwind + TypeScript — CSI Camera MJPEG + PCA9685 Servo GUI

A working setup for:

- Next.js GUI running **locally on the Pi**
- Accessible on the **local network**
- **CSI Pi Camera** streamed as MJPEG on `:8080/stream.mjpg`
- **PCA9685 over I2C** to control **3 servos**
- **systemd** services so both servers start **on boot**

---

## 0) Hardware + Pi config (one-time)

### Enable Camera + I2C
```bash
sudo raspi-config
# Interface Options → Camera → enable
# Interface Options → I2C → enable
sudo reboot
```

### Detailed wiring: Raspberry Pi ↔ PCA9685 (I2C) + Servo power

#### Raspberry Pi (40-pin header) → PCA9685 (logic / I2C)

| Raspberry Pi (Physical pin) | Pi signal | GPIO | PCA9685 pin |
|---|---|---|---|
| Pin **1** | 3.3V | — | **VCC** |
| Pin **6** (or any GND) | GND | — | **GND** |
| Pin **3** | SDA1 | GPIO2 | **SDA** |
| Pin **5** | SCL1 | GPIO3 | **SCL** |

Optional / recommended:
- **OE** on PCA9685: tie **OE → GND** to enable outputs (some boards already pull it down).
- Address jumpers **A0–A5**: default is usually `0x40` (update `.env.local` if changed).

#### Servo power (very important)

The PCA9685 board has **two power rails**:
- **VCC** = logic power (3.3V from Pi)
- **V+** = servo power (typically 5–6V from an external supply)

Wire servo power like this:
- External **5V** → PCA9685 **V+**
- External PSU **GND** → PCA9685 **GND**
- Raspberry Pi **GND** must also connect to PCA9685 **GND** (**common ground**)

> For quick bench tests with a single tiny servo you *may* use Pi 5V → V+, but expect brownouts if the servo stalls. External 5V is recommended.

Nice-to-have stability:
- Add a capacitor across **V+** and **GND** on the PCA9685 (e.g. **470µF–2200µF**, rated above your supply voltage).

#### Servo headers (per channel)
Typically:
- **GND** → brown/black
- **V+** → red
- **Signal (PWM)** → yellow/orange/white

---

## 1) Create the Next.js project

```bash
npx create-next-app@latest camera-pi --ts --tailwind --app --eslint
cd camera-pi
npm i i2c-bus pca9685
```

---

## 2) Environment variables

Create `./.env.local`:

```bash
I2C_BUS=1
PCA9685_ADDR=0x40
SERVO_MIN_US=500
SERVO_MAX_US=2500
```

> If your servos jitter / don’t reach full travel, calibrate `SERVO_MIN_US` and `SERVO_MAX_US`.

---

## 3) Servo control (PCA9685) via Next API route

### Why this is a little special (native addons + Next dev)
`i2c-bus` is a **native Node addon**. In Next dev (especially with Turbopack), native addons can break if bundled/relocated.
The solution here is:
- In the API route: **lazy import** the servo module
- In the servo module: load `i2c-bus` / `pca9685` using `createRequire(process.cwd())` so it resolves from real `node_modules`
- In Next config: mark these packages as **server externals**

### `lib/servo/pca9685.ts`
Create `lib/servo/pca9685.ts`:

```ts
import { createRequire } from "module"

type ServoConfig = {
  i2cBusNumber: number
  address: number
  frequencyHz: number
  minPulseUs: number
  maxPulseUs: number
}

const config: ServoConfig = {
  i2cBusNumber: Number(process.env.I2C_BUS ?? 1),
  address: Number(process.env.PCA9685_ADDR ?? 0x40),
  frequencyHz: 50,
  minPulseUs: Number(process.env.SERVO_MIN_US ?? 500),
  maxPulseUs: Number(process.env.SERVO_MAX_US ?? 2500),
}

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n))
}

export function angleToPulseUs(angle: number) {
  const a = clamp(angle, 0, 180)
  const span = config.maxPulseUs - config.minPulseUs
  return config.minPulseUs + (span * a) / 180
}

let driverPromise: Promise<any> | null = null

export function getPca9685(): Promise<any> {
  if (!driverPromise) {
    driverPromise = new Promise((resolve, reject) => {
      try {
        // Resolve native addons from the *project* node_modules
        const requireFromCwd = createRequire(process.cwd() + "/")
        const i2c = requireFromCwd("i2c-bus")
        const { Pca9685Driver } = requireFromCwd("pca9685")

        const bus = i2c.openSync(config.i2cBusNumber)
        const driver = new Pca9685Driver(
          { i2c: bus, address: config.address, frequency: config.frequencyHz, debug: false },
          (err: any) => (err ? reject(err) : resolve(driver))
        )
      } catch (err: any) {
        reject(
          new Error(
            `I2C/PCA9685 init failed. Check I2C is enabled + wiring + permissions.
${err?.message ?? err}`
          )
        )
      }
    })
  }
  return driverPromise
}

export async function setServoAngle(channel: number, angle: number) {
  const pwm = await getPca9685()
  const pulseUs = angleToPulseUs(angle)
  pwm.setPulseLength(channel, pulseUs)
}
```

### `app/api/servo/route.ts`
Create `app/api/servo/route.ts`:

```ts
import { NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Body = { channel: number; angle: number }

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body

    if (
      typeof body.channel !== "number" ||
      typeof body.angle !== "number" ||
      body.channel < 0 ||
      body.channel > 15
    ) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 })
    }

    // Lazy load to avoid build-time issues on non-Pi hardware
    const { setServoAngle } = await import("@/lib/servo/pca9685")
    await setServoAngle(body.channel, body.angle)

    return NextResponse.json({ ok: true })
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Servo error" },
      { status: 500 }
    )
  }
}
```

---

## 4) Next.js config (native addon friendly + LAN dev)

Create `next.config.js` (CommonJS):

```js
/** @type {import('next').NextConfig} */
const nextConfig = {
  // Keep native modules out of bundling
  serverExternalPackages: ["i2c-bus", "pca9685"],

  // Optional: allow LAN access to dev assets (Next dev only)
  // allowedDevOrigins: [
  //   "http://192.168.1.30:3000",
  //   "http://raspberrypi.local:3000",
  // ],
}

module.exports = nextConfig
```

> For a “real” Pi host, prefer production mode (`npm run build && npm run start`) and you don’t need `allowedDevOrigins`.

---

## 5) Camera MJPEG server (CSI camera → `:8080/stream.mjpg`)

This uses **Picamera2** + Flask and exposes a browser-friendly MJPEG stream.

### Install deps
```bash
sudo apt update
sudo apt install -y python3-flask python3-picamera2
# Recommended (often required for fast JPEG handling)
sudo apt install -y python3-simplejpeg || true
```

### Create `~/mjpeg_server.py`
```bash
nano ~/mjpeg_server.py
```

Paste:

```py
import io
from flask import Flask, Response
from threading import Condition

from picamera2 import Picamera2
from picamera2.encoders import JpegEncoder
from picamera2.outputs import FileOutput

app = Flask(__name__)

class StreamingOutput(io.BufferedIOBase):
    def __init__(self):
        self.frame = None
        self.condition = Condition()

    def write(self, buf):
        with self.condition:
            self.frame = buf
            self.condition.notify_all()

output = StreamingOutput()

picam2 = Picamera2()
picam2.configure(picam2.create_video_configuration(main={"size": (1280, 720)}))
picam2.start_recording(JpegEncoder(), FileOutput(output))

def generate():
    while True:
        with output.condition:
            output.condition.wait()
            frame = output.frame
        yield (b"--FRAME\r\n"
               b"Content-Type: image/jpeg\r\n"
               b"Content-Length: " + str(len(frame)).encode() + b"\r\n\r\n" +
               frame + b"\r\n")

@app.get("/stream.mjpg")
def stream():
    return Response(generate(), mimetype="multipart/x-mixed-replace; boundary=FRAME")

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8080, threaded=True)
```

Test:
```bash
python3 ~/mjpeg_server.py
```

From another device on the LAN:
- `http://<pi-ip>:8080/stream.mjpg`

---

## 6) GUI (camera stream + servos)

Your `<img src="...">` should point to the new endpoint:

```ts
setStreamUrl(`http://${window.location.hostname}:8080/stream.mjpg`)
```

Example `CameraView`:

```tsx
<img src={streamUrl} className="h-full w-full object-cover" alt="Camera stream" />
```

---

## 7) Run locally + broadcast to LAN

### Development (on Pi)
```bash
npm run dev -- -H 0.0.0.0 -p 3000
```

LAN:
- `http://<pi-ip>:3000`
- often also works: `http://raspberrypi.local:3000`

### Production (recommended on Pi)
```bash
npm run build
npm run start
```

---

## 8) Run both on boot with systemd

### 8.1 Next.js systemd service

Create:
```bash
sudo nano /etc/systemd/system/pi-web.service
```

Paste (update `WorkingDirectory` if needed):
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

Enable + start:
```bash
sudo systemctl daemon-reload
sudo systemctl enable pi-web
sudo systemctl start pi-web
journalctl -u pi-web -f
```

### 8.2 Camera MJPEG server systemd service

Create:
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

Enable + start:
```bash
sudo systemctl daemon-reload
sudo systemctl enable pi-cam
sudo systemctl start pi-cam
journalctl -u pi-cam -f
```

---

## 9) Confirm it survives a reboot

```bash
sudo reboot
```

Then:
```bash
sudo systemctl status pi-web pi-cam
```

---

## 10) Handy systemd commands

```bash
sudo systemctl restart pi-web
sudo systemctl stop pi-web
sudo systemctl disable pi-web

sudo systemctl restart pi-cam
sudo systemctl stop pi-cam
sudo systemctl disable pi-cam

journalctl -u pi-web -f
journalctl -u pi-cam -f
```

---

## Notes / gotchas
- Servos draw a lot of current — external **5V** for **V+** is recommended.
- Keep grounds common (Pi ↔ PCA9685 ↔ servo PSU).
- If camera works with `rpicam-hello` but not in browser, check `http://<pi-ip>:8080/stream.mjpg` directly.
- If servos work in production but dev is flaky, prefer `npm run build && npm run start` on the Pi.
