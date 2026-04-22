"use client"

import * as React from "react"
import { ErrorDisplay } from "@/components/pi/error-display"
import { CameraView } from "@/components/pi/camera-view"
import { ServoControls } from "@/components/pi/servo-controls"
import { Joystick } from "@/components/pi/joystick"
import { Button } from "@/components/ui/button"

const SEND_INTERVAL_MS = 50
const DEFAULT_STREAM_PORT = 8080
const DEFAULT_FACE_PORT = 8081
const LOAD_ANGLE = Number(process.env.NEXT_PUBLIC_LOAD_ANGLE ?? 0)
const SHOOT_ANGLE = Number(process.env.NEXT_PUBLIC_SHOOT_ANGLE ?? 180)
const SHOOT_CHANNEL = 2

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
  const [actionBusy, setActionBusy] = React.useState<"load" | "shoot" | null>(null)
  const [err, setErr] = React.useState<string | null>(null)
  const [host, setHost] = React.useState("")
  const [viewMode, setViewMode] = React.useState<"manual" | "face">("manual")
  // Coalesce rapid updates per channel so the network doesn't build a backlog.
  const pendingRef = React.useRef<Map<number, number>>(new Map())
  const inFlightRef = React.useRef<Set<number>>(new Set())
  const timerRef = React.useRef<Map<number, number>>(new Map())

  React.useEffect(() => {
    setHost(window.location.hostname)
  }, [])

  const streamUrl = React.useMemo(() => {
    if (!host) return ""
    const facePort = Number(process.env.NEXT_PUBLIC_FACETRACK_PORT ?? DEFAULT_FACE_PORT)
    const port = viewMode === "face" ? facePort : DEFAULT_STREAM_PORT
    return `http://${host}:${port}/stream.mjpg`
  }, [host, viewMode])

  React.useEffect(() => {
    return () => {
      for (const id of timerRef.current.values()) {
        window.clearTimeout(id)
      }
      timerRef.current.clear()
    }
  }, [])

  function scheduleSend(channel: number) {
    if (timerRef.current.has(channel)) return
    const id = window.setTimeout(() => {
      void flushSend(channel)
    }, SEND_INTERVAL_MS)
    timerRef.current.set(channel, id)
  }

  async function flushSend(channel: number) {
    timerRef.current.delete(channel)
    if (inFlightRef.current.has(channel)) {
      scheduleSend(channel)
      return
    }

    const angle = pendingRef.current.get(channel)
    if (angle === undefined) return

    inFlightRef.current.add(channel)
    try {
      await setServo(channel, angle)
    } catch (e: any) {
      setErr(e?.message ?? "Failed")
    } finally {
      inFlightRef.current.delete(channel)
      const latest = pendingRef.current.get(channel)
      if (latest !== angle) scheduleSend(channel)
    }
  }

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
    setErr(null)
    setAngles((a) => ({ ...a, [channel]: angle }))
    pendingRef.current.set(channel, angle)
    scheduleSend(channel)
  }

  async function handleLoad() {
    try {
      setErr(null)
      setActionBusy("load")
      await setServo(SHOOT_CHANNEL, LOAD_ANGLE)
      setAngles((a) => ({ ...a, [SHOOT_CHANNEL]: LOAD_ANGLE }))
    } catch (e: any) {
      setErr(e?.message ?? "Load failed")
    } finally {
      setActionBusy(null)
    }
  }

  async function handleShoot() {
    try {
      setErr(null)
      setActionBusy("shoot")
      await setServo(SHOOT_CHANNEL, SHOOT_ANGLE)
      setAngles((a) => ({ ...a, [SHOOT_CHANNEL]: SHOOT_ANGLE }))
      await fetch("/api/sound", { method: "POST" })
    } catch (e: any) {
      setErr(e?.message ?? "Shoot failed")
    } finally {
      setActionBusy(null)
    }
  }

  return (
    <main className="min-h-screen bg-background p-1 sm:p-2 lg:p-4">
      <div className="mx-auto max-w-4xl space-y-1">
        {/* Header */}
        {/* <header className="space-y-2 text-center">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
            Pi Camera + Servo Control
          </h1>
          <p className="text-sm text-muted-foreground">
            Camera stream on port 8080 • Servo control via PCA9685 (I2C)
          </p>
        </header> */}

        {/* Error Display */}

      {/* Camera View */}
        <div className="flex items-center justify-between rounded-xl bg-card px-4 py-3">
          <div className="text-sm font-medium">
            {viewMode === "face" ? "Face Detect" : "Manual"} View
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setViewMode((m) => (m === "face" ? "manual" : "face"))}
          >
            Switch to {viewMode === "face" ? "Manual" : "Face Detect"}
          </Button>
        </div>

        <CameraView streamUrl={streamUrl} />

        {/* Load / Shoot Controls */}
        <div className="flex gap-3 rounded-xl bg-card px-4 py-3">
          <Button
            className="flex-1"
            variant="outline"
            size="lg"
            disabled={actionBusy !== null}
            onClick={handleLoad}
          >
            {actionBusy === "load" ? "Loading..." : "Load"}
          </Button>
          <Button
            className="flex-1 bg-red-600 text-white hover:bg-red-700"
            size="lg"
            disabled={actionBusy !== null}
            onClick={handleShoot}
          >
            {actionBusy === "shoot" ? "Firing..." : "Shoot"}
          </Button>
        </div>

        {/* Joystick Control */}
        <Joystick
          angles={angles}
          busy={busy}
          onAngleChange={setAngle}
        />

        {/* Servo Controls */}
        <ServoControls
          angles={angles}
          busy={busy}
          onAngleChange={setAngle}
          onNudge={nudge}
        />

        <ErrorDisplay error={err} />
      </div>
    </main>
  )
}
