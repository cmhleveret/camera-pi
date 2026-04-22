import { NextResponse } from "next/server"
import { exec } from "child_process"
import { existsSync } from "fs"
import { join } from "path"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function run(cmd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    exec(cmd, { timeout: 10_000 }, (err) => (err ? reject(err) : resolve()))
  })
}

const SOUNDS_DIR = join(process.cwd(), "public", "sounds")

async function playSoundFile(): Promise<boolean> {
  for (const name of ["shoot.mp3", "shoot.wav"]) {
    const path = join(SOUNDS_DIR, name)
    if (!existsSync(path)) continue

    if (name.endsWith(".mp3")) {
      try { await run(`mpg123 -q "${path}"`); return true } catch {}
      try { await run(`ffplay -nodisp -autoexit -loglevel quiet "${path}"`); return true } catch {}
    }
    if (name.endsWith(".wav")) {
      try { await run(`aplay -q "${path}"`); return true } catch {}
      try { await run(`paplay "${path}"`); return true } catch {}
    }
  }
  return false
}

async function playTone(): Promise<void> {
  // Generate a short beep tone via speaker-test or aplay with a generated WAV
  try {
    await run(`speaker-test -t sine -f 880 -l 1 -p 1 2>/dev/null & PID=$!; sleep 0.3; kill $PID 2>/dev/null`)
    return
  } catch {}
  try {
    // Fallback: generate a tiny WAV in-memory and play it
    await run(
      `python3 -c "import struct,wave,math;f=wave.open('/tmp/_beep.wav','w');f.setnchannels(1);f.setsampwidth(2);f.setframerate(44100);d=b''.join(struct.pack('<h',int(16000*math.sin(2*math.pi*880*i/44100)))for i in range(int(44100*0.3)));f.writeframes(d);f.close()" && aplay -q /tmp/_beep.wav`
    )
  } catch {}
}

export async function POST() {
  try {
    const played = await playSoundFile()
    if (!played) await playTone()
    return NextResponse.json({ ok: true })
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Sound playback failed" },
      { status: 500 }
    )
  }
}
