import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  serverExternalPackages: ["i2c-bus", "pca9685"],
  allowedDevOrigins: [
    "192.168.1.30",
    "raspberrypi.local",
  ],
}

export default nextConfig