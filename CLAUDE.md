# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a **Raspberry Pi control system** built with Next.js that provides:
- A web-based GUI accessible on the local network
- Live MJPEG camera stream from Pi Camera (served on port 8080)
- Servo motor control via PCA9685 I2C controller (3 servos on channels 0, 1, 2)
- systemd services for automatic startup on boot

**Target deployment:** Runs directly on a Raspberry Pi, accessible from other devices on the same network.

## Essential Commands

### Development
```bash
# Install dependencies
npm install

# Run development server (accessible on LAN)
npm run dev -- -H 0.0.0.0 -p 3000

# Build for production
npm run build

# Run production server (accessible on LAN)
npm start
```

### Linting
```bash
npm run lint
```

Note: There are no test scripts configured in this project.

## Architecture

### Application Structure
- **Next.js 16** with App Router (`app/` directory)
- **React 19** for UI components
- **Tailwind CSS v4** for styling (with `@tailwindcss/postcss`)
- **TypeScript** with strict mode enabled

### Hardware Integration (Not Yet Implemented)
The README describes the intended architecture, but the actual implementation has not been completed yet:

**Planned servo control flow:**
1. `lib/servo/pca9685.ts` - Hardware interface module that:
   - Opens I2C bus connection using `i2c-bus` package
   - Initializes PCA9685 driver with global singleton pattern
   - Provides `setServoAngle(channel, angle)` function
   - Converts 0-180° angles to PWM pulse widths (500-2500μs configurable)

2. `app/api/servo/route.ts` - Next.js API route:
   - POST endpoint accepting `{channel: number, angle: number}`
   - Validates channel (0-15) and angle values
   - Calls hardware interface to move servo
   - Returns success/error responses

**Planned environment variables** (`.env.local`):
```bash
I2C_BUS=1                # I2C bus number (usually 1 on Pi)
PCA9685_ADDR=0x40        # I2C address of PCA9685
SERVO_MIN_US=500         # Minimum pulse width in microseconds
SERVO_MAX_US=2500        # Maximum pulse width in microseconds
```

**Planned camera stream integration:**
- Separate MJPEG streamer service (e.g., ustreamer) runs on port 8080
- Frontend connects to `http://<pi-ip>:8080/?action=stream`
- Camera stream is embedded in the UI but served independently

### Frontend Architecture (Planned)
The `app/page.tsx` should be a client component with:
- Camera stream display (iframe or img tag pointing to port 8080)
- Three servo controls (one per channel) with:
  - Range sliders (0-180°)
  - Nudge buttons (±5°)
  - Center button (reset to 90°)
- State management for current servo angles
- Fetch calls to `/api/servo` endpoint

### Deployment Pattern
Production deployment uses **systemd services** on the Raspberry Pi:

1. **pi-web.service** - Next.js application
   - Runs `npm start` with NODE_ENV=production
   - Loads environment from `.env.local`
   - Auto-restart on failure
   - User: `pi`, WorkingDirectory: project path

2. **pi-cam.service** (optional) - Camera streamer
   - Runs camera streaming software (e.g., ustreamer)
   - Serves on port 8080
   - Independent from Next.js app

Service management:
```bash
sudo systemctl daemon-reload
sudo systemctl enable pi-web.service
sudo systemctl start pi-web.service
sudo systemctl status pi-web.service
journalctl -u pi-web.service -f
```

## Important Configuration Details

### Path Aliases
The project uses `@/*` to reference the project root:
```typescript
import { setServoAngle } from "@/lib/servo/pca9685"
```

### Hardware Requirements
- **I2C and Camera must be enabled** via `sudo raspi-config`
- **PCA9685 wiring:** VCC to 3.3V, SDA/SCL to Pi pins, common ground
- **Servo power:** Separate 5V supply recommended (servos draw high current)

### Network Access
The Next.js server binds to `0.0.0.0` to be accessible on the local network:
- Development: `npm run dev -- -H 0.0.0.0 -p 3000`
- Production: Update `package.json` start script to include `-H 0.0.0.0`

### Current Implementation Status
**Note:** The current codebase is a fresh Next.js project template. The README contains the full implementation guide, but the actual code (servo control, camera UI, API routes) has not been implemented yet. When implementing features, follow the architecture described in the README.
