"use client"

import { AspectRatio } from "@/components/ui/aspect-ratio"

interface CameraViewProps {
  streamUrl: string
}

export function CameraView({ streamUrl }: CameraViewProps) {
  return (
    <div className="overflow-hidden rounded-xl bg-card">
      <div className="p-4">
        <AspectRatio ratio={16 / 9}>
          <div className="flex h-full w-full items-center justify-center overflow-hidden rounded-lg border border-border bg-black">
            {streamUrl ? (
              <img
                src={streamUrl}
                className="h-full w-full object-cover"
                alt="Camera stream"
              />
            ) : (
              <div className="text-sm text-muted-foreground">Loading camera...</div>
            )}
          </div>
        </AspectRatio>
      </div>
    </div>
  )
}
