# Raspberry Pi: Next.js + Tailwind + TypeScript — Camera Stream + PCA9685 Servo GUI

A concise, working setup for:

- Next.js GUI running **locally** on the Pi
- Accessible on the **local network**
- **Pi camera** streamed as MJPEG on `:8080`
- **PCA9685 over I2C** to control **3 servos**
- **systemd** services to start everything **on boot**

---

## 0) Hardware + Pi config (one-time)

### Enable Camera + I2C
```bash
sudo raspi-config
# Interface Options → Camera → enable
# Interface Options → I2C → enable
sudo reboot
```

### PCA9685 wiring notes (important)
- PCA9685 **VCC → 3.3V**, **GND → GND**
- **SDA/SCL → Pi SDA/SCL**
- Power servos from a **separate 5V supply** (recommended)
- Ensure **common ground** between servo PSU and Pi/PCA9685

---

## 1) Create the Next.js project

```bash
npx create-next-app@latest pi-cam-servo --ts --tailwind --app --eslint
cd pi-cam-servo
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

### `lib/servo/pca9685.ts`
Create `lib/servo/pca9685.ts`:

```ts
import i2c from "i2c-bus"
import { Pca9685Driver } from "pca9685"

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

declare global {
  // eslint-disable-next-line no-var
  var __pca9685__: Promise<Pca9685Driver> | undefined
}

export function getPca9685(): Promise<Pca9685Driver> {
  if (!global.__pca9685__) {
    global.__pca9685__ = new Promise((resolve, reject) => {
      const bus = i2c.openSync(config.i2cBusNumber)
      const driver = new Pca9685Driver(
        { i2c: bus, address: config.address, frequency: config.frequencyHz, debug: false },
        (err) => (err ? reject(err) : resolve(driver))
      )
    })
  }
  return global.__pca9685__!
}

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n))
}

export function angleToPulseUs(angle: number) {
  const a = clamp(angle, 0, 180)
  const span = config.maxPulseUs - config.minPulseUs
  return config.minPulseUs + (span * a) / 180
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
import { setServoAngle } from "@/lib/servo/pca9685"

export const runtime = "nodejs"

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

## 4) GUI page (camera stream + 3 servos)

Create/update `app/page.tsx`:

```tsx
"use client"

import * as React from "react"

type Servo = { name: string; channel: number }

const SERVOS: Servo[] = [
  { name: "Servo 1", channel: 0 },
  { name: "Servo 2", channel: 1 },
  { name: "Servo 3", channel: 2 },
]

async function setServo(channel: number, angle: number) {
  const res = await fetch("/api/servo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ channel, angle }),
  })
  if (!res.ok) throw new Error(await res.text())
}

export default function Home() {
  const [angles, setAngles] = React.useState<Record<number, number>>({ 0: 90, 1: 90, 2: 90 })
  const [busy, setBusy] = React.useState(false)
  const [err, setErr] = React.useState<string | null>(null)

  const streamUrl = React.useMemo(() => {
    const host = typeof window !== "undefined" ? window.location.hostname : "raspberrypi.local"
    return `http://${host}:8080/?action=stream`
  }, [])

  async function nudge(channel: number, delta: number) {
    try {
      setErr(null)
      setBusy(true)
      const next = Math.max(0, Math.min(180, (angles[channel] ?? 90) + delta))
      setAngles((a) => ({ ...a, [channel]: next }))
      await setServo(channel, next)
    } catch (e: any) {
      setErr(e?.message ?? "Failed")
    } finally {
      setBusy(false)
    }
  }

  async function setAngle(channel: number, angle: number) {
    try {
      setErr(null)
      setAngles((a) => ({ ...a, [channel]: angle }))
      await setServo(channel, angle)
    } catch (e: any) {
      setErr(e?.message ?? "Failed")
    }
  }

  return (
    <main className="min-h-screen p-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold">Pi Camera + Servo Control</h1>
          <p className="text-sm text-muted-foreground">Camera stream :8080 • Servo control via PCA9685 (I2C)</p>
        </header>

        {err ? (
          <div className="rounded-md border p-3 text-sm">
            <span className="font-medium">Error:</span> {err}
          </div>
        ) : null}

        <section className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-xl border p-3">
            <div className="mb-2 text-sm font-medium">Camera</div>
            <div className="aspect-video w-full overflow-hidden rounded-lg bg-black">
              <img src={streamUrl} className="h-full w-full object-cover" alt="Camera stream" />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              If this is broken, confirm your MJPEG streamer URL/port.
            </p>
          </div>

          <div className="rounded-xl border p-4">
            <div className="mb-3 text-sm font-medium">Servos</div>

            <div className="space-y-4">
              {SERVOS.map((s) => {
                const angle = angles[s.channel] ?? 90
                return (
                  <div key={s.channel} className="rounded-lg border p-3">
                    <div className="flex items-center justify-between">
                      <div className="font-medium">{s.name}</div>
                      <div className="text-sm tabular-nums">{angle}°</div>
                    </div>

                    <input
                      className="mt-3 w-full"
                      type="range"
                      min={0}
                      max={180}
                      value={angle}
                      onChange={(e) => setAngle(s.channel, Number(e.target.value))}
                      disabled={busy}
                    />

                    <div className="mt-3 flex gap-2">
                      <button className="rounded-md border px-3 py-2 text-sm disabled:opacity-50"
                        onClick={() => nudge(s.channel, -5)} disabled={busy}>
                        -5°
                      </button>
                      <button className="rounded-md border px-3 py-2 text-sm disabled:opacity-50"
                        onClick={() => nudge(s.channel, +5)} disabled={busy}>
                        +5°
                      </button>
                      <button className="ml-auto rounded-md border px-3 py-2 text-sm disabled:opacity-50"
                        onClick={() => setAngle(s.channel, 90)} disabled={busy}>
                        Center
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>

            <p className="mt-3 text-xs text-muted-foreground">
              Tip: calibrate SERVO_MIN_US / SERVO_MAX_US if you get jitter or limited travel.
            </p>
          </div>
        </section>
      </div>
    </main>
  )
}
```

---

## 5) Run locally + broadcast to LAN

### Development
```bash
npm run dev -- -H 0.0.0.0 -p 3000
```

From another device on the same network:
- `http://<pi-ip>:3000`
- often also works: `http://raspberrypi.local:3000`

---

## 6) Camera streaming service (MJPEG on :8080)

**Recommended approach:** run the camera streamer as a separate service.

### Option A — ustreamer (example)
Install (varies by distro; if available):
```bash
sudo apt update
sudo apt install -y ustreamer
```

Run manually to test:
```bash
ustreamer --host=0.0.0.0 --port=8080
```

Then confirm:
- `http://<pi-ip>:8080/` (or your streamer’s UI)
- `http://<pi-ip>:8080/?action=stream` (as used by the Next UI above)

> If your streamer uses a different stream URL, update `streamUrl` in `app/page.tsx`.

---

## 7) Run on boot with systemd

### 7.1 Build for production
From your project folder:
```bash
npm ci
npm run build
```

Ensure `package.json` includes:
```json
{
  "scripts": {
    "build": "next build",
    "start": "next start -H 0.0.0.0 -p 3000"
  }
}
```

---

### 7.2 Next.js systemd service

Create:
```bash
sudo nano /etc/systemd/system/pi-web.service
```

Paste (update `User` and `WorkingDirectory`):
```ini
[Unit]
Description=Pi Next.js Web UI
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/pi-cam-servo
Environment=NODE_ENV=production
EnvironmentFile=/home/pi/pi-cam-servo/.env.local
ExecStart=/usr/bin/npm run start
Restart=always
RestartSec=3
TimeoutStopSec=10

[Install]
WantedBy=multi-user.target
```

Enable + start:
```bash
sudo systemctl daemon-reload
sudo systemctl enable pi-web.service
sudo systemctl start pi-web.service
```

Logs:
```bash
sudo systemctl status pi-web.service
journalctl -u pi-web.service -f
```

---

### 7.3 Camera streamer systemd service (optional)

Create:
```bash
sudo nano /etc/systemd/system/pi-cam.service
```

Paste (example for ustreamer):
```ini
[Unit]
Description=Pi Camera MJPEG Stream
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=pi
ExecStart=/usr/bin/ustreamer --host=0.0.0.0 --port=8080
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
```

Enable + start:
```bash
sudo systemctl daemon-reload
sudo systemctl enable pi-cam.service
sudo systemctl start pi-cam.service
```

Logs:
```bash
journalctl -u pi-cam.service -f
```

---

## 8) Confirm it survives a reboot

```bash
sudo reboot
```

Then from another device:
- `http://<pi-ip>:3000`
- `http://<pi-ip>:8080` (if using camera streamer)

---

## 9) Handy systemd commands

```bash
sudo systemctl restart pi-web
sudo systemctl stop pi-web
sudo systemctl disable pi-web

sudo systemctl restart pi-cam
journalctl -u pi-web -f
journalctl -u pi-cam -f
```

---

## Notes / gotchas
- Servos draw a lot of current — separate 5V supply is strongly recommended.
- Keep grounds common (Pi ↔ PCA9685 ↔ servo PSU).
- If the camera stream is blank, verify camera enablement + streamer command + correct URL in `app/page.tsx`.
