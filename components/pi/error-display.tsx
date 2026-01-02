interface ErrorDisplayProps {
  error: string | null
}

export function ErrorDisplay({ error }: ErrorDisplayProps) {
  if (!error) return null

  return (
    <div className="rounded-lg bg-destructive/10 p-4">
      <p className="text-sm font-medium text-destructive">
        <span className="font-semibold">Error:</span> {error}
      </p>
    </div>
  )
}
