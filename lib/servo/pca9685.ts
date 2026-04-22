import { createRequire } from "module"

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

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n))
}

const EASE_STEP_MS = 20
const EASE_MIN_DURATION_MS = 40
const EASE_MAX_DURATION_MS = 200

const lastAngle = new Map<number, number>()
const targetAngle = new Map<number, number>()
const runningChannels = new Set<number>()

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function easeInOutQuad(t: number) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
}

export function angleToPulseUs(angle: number) {
  const a = clamp(angle, 0, 180)
  const span = config.maxPulseUs - config.minPulseUs
  return config.minPulseUs + (span * a) / 180
}

// Keep singleton across requests
let driverPromise: Promise<any> | null = null

export function getPca9685(): Promise<any> {
  if (!driverPromise) {
    driverPromise = new Promise(async (resolve, reject) => {
      try {
        // IMPORTANT: require from the project root so we load the real node_modules copy
        const requireFromCwd = createRequire(process.cwd() + "/")
        const i2c = requireFromCwd("i2c-bus")
        const { Pca9685Driver } = requireFromCwd("pca9685")

        const bus = i2c.openSync(config.i2cBusNumber)

        const driver = new Pca9685Driver(
          { i2c: bus, address: config.address, frequency: config.frequencyHz, debug: false },
          (err: any) => (err ? reject(err) : resolve(driver))
        )
      } catch (err: any) {
        reject(
          new Error(
            `I2C/PCA9685 init failed. Check: I2C enabled, /dev/i2c-${config.i2cBusNumber} exists, permissions, wiring.\n${err?.message ?? err}`
          )
        )
      }
    })
  }
  return driverPromise
}

export async function setServoAngle(channel: number, angle: number) {
  const pwm = await getPca9685()
  const next = clamp(angle, 0, 180)
  targetAngle.set(channel, next)

  if (runningChannels.has(channel)) return
  runningChannels.add(channel)

  try {
    while (true) {
      const target = targetAngle.get(channel)
      if (target === undefined) break

      const current = lastAngle.get(channel)
      if (current === undefined || Math.abs(target - current) < 0.5) {
        pwm.setPulseLength(channel, angleToPulseUs(target))
        lastAngle.set(channel, target)
        if (targetAngle.get(channel) === target) break
        continue
      }

      const delta = target - current
      const duration = clamp(Math.abs(delta) * 4, EASE_MIN_DURATION_MS, EASE_MAX_DURATION_MS)
      const steps = Math.max(1, Math.round(duration / EASE_STEP_MS))

      for (let i = 1; i <= steps; i += 1) {
        if (targetAngle.get(channel) !== target) break
        const t = i / steps
        const eased = easeInOutQuad(t)
        const angleStep = current + delta * eased
        pwm.setPulseLength(channel, angleToPulseUs(angleStep))
        lastAngle.set(channel, angleStep)
        await sleep(EASE_STEP_MS)
      }
    }
  } finally {
    runningChannels.delete(channel)
  }
}
