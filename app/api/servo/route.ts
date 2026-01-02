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

    // Lazy load the servo module to avoid build-time errors on non-Pi hardware
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
