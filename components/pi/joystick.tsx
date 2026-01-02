"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

interface JoystickProps {
  angles: Record<number, number>
  busy: boolean
  onAngleChange: (channel: number, angle: number) => void
}

const SERVO_OPTIONS = [
  { label: "Servo 1", value: 0 },
  { label: "Servo 2", value: 1 },
  { label: "Servo 3", value: 2 },
]

export function Joystick({ angles, busy, onAngleChange }: JoystickProps) {
  const containerRef = React.useRef<HTMLDivElement>(null)
  const [isDragging, setIsDragging] = React.useState(false)
  const [xServo, setXServo] = React.useState(0) // X-axis controls Servo 1
  const [yServo, setYServo] = React.useState(1) // Y-axis controls Servo 2
  const [autoCenter, setAutoCenter] = React.useState(false) // Auto-center toggle

  const xAngle = angles[xServo] ?? 90
  const yAngle = angles[yServo] ?? 90

  // Convert servo angles (0-180) to joystick position (-1 to 1)
  const angleToPosition = (angle: number) => ((angle - 90) / 90)
  const positionToAngle = (pos: number) => Math.max(0, Math.min(180, pos * 90 + 90))

  const handleMove = React.useCallback((clientX: number, clientY: number) => {
    if (!containerRef.current || busy) return

    const rect = containerRef.current.getBoundingClientRect()
    const centerX = rect.left + rect.width / 2
    const centerY = rect.top + rect.height / 2

    // Calculate position relative to center (-1 to 1)
    let relX = (clientX - centerX) / (rect.width / 2)
    let relY = -(clientY - centerY) / (rect.height / 2) // Inverted Y

    // Clamp to circle
    const distance = Math.sqrt(relX * relX + relY * relY)
    if (distance > 1) {
      relX = relX / distance
      relY = relY / distance
    }

    // Update servo angles
    onAngleChange(xServo, positionToAngle(relX))
    onAngleChange(yServo, positionToAngle(relY))
  }, [busy, onAngleChange, xServo, yServo])

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    setIsDragging(true)
    handleMove(e.clientX, e.clientY)
  }

  const handleMouseMove = React.useCallback((e: MouseEvent) => {
    if (isDragging) {
      handleMove(e.clientX, e.clientY)
    }
  }, [isDragging, handleMove])

  const handleMouseUp = React.useCallback(() => {
    setIsDragging(false)
    if (autoCenter) {
      onAngleChange(xServo, 90)
      onAngleChange(yServo, 90)
    }
  }, [autoCenter, xServo, yServo, onAngleChange])

  const handleTouchStart = (e: React.TouchEvent) => {
    e.preventDefault()
    setIsDragging(true)
    const touch = e.touches[0]
    handleMove(touch.clientX, touch.clientY)
  }

  const handleTouchMove = React.useCallback((e: TouchEvent) => {
    if (isDragging && e.touches.length > 0) {
      e.preventDefault()
      const touch = e.touches[0]
      handleMove(touch.clientX, touch.clientY)
    }
  }, [isDragging, handleMove])

  React.useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
      document.addEventListener('touchmove', handleTouchMove, { passive: false })
      document.addEventListener('touchend', handleMouseUp)

      return () => {
        document.removeEventListener('mousemove', handleMouseMove)
        document.removeEventListener('mouseup', handleMouseUp)
        document.removeEventListener('touchmove', handleTouchMove)
        document.removeEventListener('touchend', handleMouseUp)
      }
    }
  }, [isDragging, handleMouseMove, handleMouseUp, handleTouchMove])

  // Manual center function
  const handleManualCenter = () => {
    onAngleChange(xServo, 90)
    onAngleChange(yServo, 90)
  }

  // Calculate knob position
  const knobX = angleToPosition(xAngle) * 50 // 50% of radius
  const knobY = -angleToPosition(yAngle) * 50 // Inverted Y

  return (
    <div className="overflow-hidden rounded-xl bg-card shadow-lg">
      <div className="p-4">
        <div className="space-y-4">
          {/* Controls Row */}
         

          {/* Joystick Container */}
          <div className="flex justify-center">
            <div
              ref={containerRef}
              className="relative w-64 h-64 rounded-full bg-muted/30 border-2 border-border cursor-pointer select-none touch-none"
              onMouseDown={handleMouseDown}
              onTouchStart={handleTouchStart}
              style={{
                opacity: busy ? 0.5 : 1,
                pointerEvents: busy ? 'none' : 'auto'
              }}
            >
              {/* Center crosshair */}
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="w-1 h-8 bg-border/30" />
                <div className="absolute w-8 h-1 bg-border/30" />
              </div>

              {/* Joystick knob */}
              <div
                className="absolute w-12 h-12 rounded-full bg-primary shadow-lg transition-all"
                style={{
                  left: `calc(50% + ${knobX}% - 24px)`,
                  top: `calc(50% + ${knobY}% - 24px)`,
                  transition: isDragging ? 'none' : 'all 0.1s ease-out'
                }}
              >
                <div className="absolute inset-0 rounded-full border-4 border-white/30" />
              </div>
            </div>
          </div>
           <div className="flex items-center gap-2 justify-between">
            {/* X Servo */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">X:</span>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="w-20">
                    {SERVO_OPTIONS.find(s => s.value === xServo)?.label}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  {SERVO_OPTIONS.map((servo) => (
                    <DropdownMenuItem
                      key={servo.value}
                      onClick={() => setXServo(servo.value)}
                      disabled={servo.value === yServo}
                    >
                      {servo.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <span className="text-lg font-bold tabular-nums min-w-[50px]">{xAngle}°</span>
            </div>

            {/* Y Servo */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Y:</span>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="w-20">
                    {SERVO_OPTIONS.find(s => s.value === yServo)?.label}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  {SERVO_OPTIONS.map((servo) => (
                    <DropdownMenuItem
                      key={servo.value}
                      onClick={() => setYServo(servo.value)}
                      disabled={servo.value === xServo}
                    >
                      {servo.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <span className="text-lg font-bold tabular-nums min-w-[50px]">{yAngle}°</span>
            </div>

            {/* Control Buttons */}
            <div className="flex gap-2">
              <Button
                onClick={handleManualCenter}
                disabled={busy}
                variant="secondary"
                size="sm"
              >
                Center
              </Button>
              <Button
                onClick={() => setAutoCenter(!autoCenter)}
                disabled={busy}
                variant={autoCenter ? "default" : "outline"}
                size="sm"
              >
                Auto: {autoCenter ? "ON" : "OFF"}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
