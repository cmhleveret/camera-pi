"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import { Input } from "@/components/ui/input"

type Servo = { name: string; channel: number }

const SERVOS: Servo[] = [
  { name: "Servo 1", channel: 0 },
  { name: "Servo 2", channel: 1 },
  { name: "Servo 3", channel: 2 },
]

type ServoCal = {
  min: number
  max: number
  mid: number
}

interface ServoControlsProps {
  angles: Record<number, number>
  busy: boolean
  onAngleChange: (channel: number, angle: number) => void
  onNudge: (channel: number, delta: number) => void // kept for backwards compatibility
}

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n))
}

function normalizeCal(cal: ServoCal): ServoCal {
  let min = Number.isFinite(cal.min) ? cal.min : 0
  let max = Number.isFinite(cal.max) ? cal.max : 180
  let mid = Number.isFinite(cal.mid) ? cal.mid : 90

  min = clamp(Math.round(min), 0, 180)
  max = clamp(Math.round(max), 0, 180)
  if (min > max) [min, max] = [max, min]

  // Avoid identical range
  if (min === max) {
    if (max < 180) max = max + 1
    else min = min - 1
  }

  mid = clamp(Math.round(mid), min, max)
  return { min, max, mid }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export function ServoControls({ angles, busy, onAngleChange }: ServoControlsProps) {
  const [cal, setCal] = React.useState<Record<number, ServoCal>>(() => ({
    0: { min: 0, max: 180, mid: 90 },
    1: { min: 0, max: 180, mid: 90 },
    2: { min: 0, max: 180, mid: 90 },
  }))

  function updateCal(channel: number, patch: Partial<ServoCal>) {
    setCal((prev) => {
      const next = { ...(prev[channel] ?? { min: 0, max: 180, mid: 90 }), ...patch }
      return { ...prev, [channel]: next }
    })
  }

  function applyCalibration() {
    const normalized: Record<number, ServoCal> = {}
    for (const s of SERVOS) {
      normalized[s.channel] = normalizeCal(cal[s.channel] ?? { min: 0, max: 180, mid: 90 })
    }
    setCal(normalized)
    return normalized
  }

  async function initializeServos() {
    // Make sure we use normalized values, then move each servo to its midpoint
    const normalized = applyCalibration()

    // Move sequentially (reduces chance of I2C contention / keeps motion tidy)
    for (const s of SERVOS) {
      onAngleChange(s.channel, normalized[s.channel].mid)
      await sleep(120) // tiny delay so you can see it / reduce rapid-fire requests
    }
  }

  return (
    <div className="overflow-hidden rounded-xl bg-card shadow-lg">
      <div className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm font-medium">Servo Controls</div>

          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={applyCalibration}
              disabled={busy}
              title="Normalize and store min/max/mid"
            >
              Apply Calibration
            </Button>

            <Button
              variant="default"
              size="sm"
              onClick={initializeServos}
              disabled={busy}
              title="Apply calibration then move all servos to their midpoint"
            >
              Initialize Servos
            </Button>
          </div>
        </div>

        <div className="space-y-1">
          {SERVOS.map((s) => {
            const raw = cal[s.channel] ?? { min: 0, max: 180, mid: 90 }
            const norm = normalizeCal(raw)

            const angle = clamp(angles[s.channel] ?? norm.mid, norm.min, norm.max)

            const nudgeTo = (delta: number) => {
              const next = clamp(angle + delta, norm.min, norm.max)
              onAngleChange(s.channel, next)
            }

            const setToMid = () => onAngleChange(s.channel, norm.mid)

            return (
              <div
                key={s.channel}
                className="space-y-4 rounded-lg border border-gray-700 bg-muted/30 p-4 transition-colors hover:bg-muted/50"
              >
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium">{s.name}</div>
                  <div className="text-sm tabular-nums text-muted-foreground">
                    Ch {s.channel} • {angle}°
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <div className="space-y-1">
                    <div className="text-xs text-muted-foreground">Min (°)</div>
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={180}
                      step={1}
                      value={raw.min}
                      onChange={(e) => updateCal(s.channel, { min: Number(e.target.value) })}
                      disabled={busy}
                    />
                  </div>

                  <div className="space-y-1">
                    <div className="text-xs text-muted-foreground">Max (°)</div>
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={180}
                      step={1}
                      value={raw.max}
                      onChange={(e) => updateCal(s.channel, { max: Number(e.target.value) })}
                      disabled={busy}
                    />
                  </div>

                  <div className="space-y-1">
                    <div className="text-xs text-muted-foreground">Mid (°)</div>
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={180}
                      step={1}
                      value={raw.mid}
                      onChange={(e) => updateCal(s.channel, { mid: Number(e.target.value) })}
                      disabled={busy}
                    />
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2 min-w-[80px]">
                    <span className="text-2xl font-bold tabular-nums">{angle}</span>
                    <span className="text-sm text-muted-foreground">°</span>
                  </div>

                  <div className="flex-1 space-y-2">
                    <Slider
                      value={[angle]}
                      onValueChange={([value]) =>
                        onAngleChange(s.channel, clamp(value, norm.min, norm.max))
                      }
                      min={norm.min}
                      max={norm.max}
                      step={1}
                      disabled={busy}
                      className="w-full"
                    />
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>{norm.min}°</span>
                      <span>{norm.mid}°</span>
                      <span>{norm.max}°</span>
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => nudgeTo(-5)} disabled={busy}>
                      −5°
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => nudgeTo(5)} disabled={busy}>
                      +5°
                    </Button>
                    <Button variant="secondary" size="sm" onClick={setToMid} disabled={busy}>
                      Mid
                    </Button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}