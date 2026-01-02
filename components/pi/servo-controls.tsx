"use client"

import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"

type Servo = { name: string; channel: number }

const SERVOS: Servo[] = [
  { name: "Servo 1", channel: 0 },
  { name: "Servo 2", channel: 1 },
  { name: "Servo 3", channel: 2 },
]

interface ServoControlsProps {
  angles: Record<number, number>
  busy: boolean
  onAngleChange: (channel: number, angle: number) => void
  onNudge: (channel: number, delta: number) => void
}

export function ServoControls({ angles, busy, onAngleChange, onNudge }: ServoControlsProps) {
  return (
    <div className="overflow-hidden rounded-xl bg-card shadow-lg">
      <div className="p-4">
        <div className="space-y-1">
          {SERVOS.map((s) => {
            const angle = angles[s.channel] ?? 90
            return (
              <div
                key={s.channel}
                className="space-y-4 rounded-lg border-1 border-gray-700 bg-muted/30 p-4 transition-colors hover:bg-muted/50"
              >
                {/* Servo Header */}
                {/* <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <h3 className="font-semibold">{s.name}</h3>
                    <p className="text-xs text-muted-foreground">Channel {s.channel}</p>
                  </div>
                </div> */}

                {/* Slider and Controls */}
                <div className="flex items-center gap-4">
                  {/* Angle Display */}
                  <div className="flex items-center gap-2 min-w-[80px]">
                    <span className="text-2xl font-bold tabular-nums">{angle}</span>
                    <span className="text-sm text-muted-foreground">°</span>
                  </div>

                  {/* Slider Section */}
                  <div className="flex-1 space-y-2">
                    <Slider
                      value={[angle]}
                      onValueChange={([value]) => onAngleChange(s.channel, value)}
                      min={0}
                      max={180}
                      step={1}
                      disabled={busy}
                      className="w-full bg-white"
                    />
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>0°</span>
                      <span>90°</span>
                      <span>180°</span>
                    </div>
                  </div>

                  {/* Control Buttons */}
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onNudge(s.channel, -5)}
                      disabled={busy}
                    >
                      −5°
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onNudge(s.channel, 5)}
                      disabled={busy}
                    >
                      +5°
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => onAngleChange(s.channel, 90)}
                      disabled={busy}
                    >
                      Center
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
