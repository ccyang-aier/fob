import type { NextConfig } from "next"
import { PHASE_DEVELOPMENT_SERVER } from "next/constants"

const nextConfig = (phase: string): NextConfig => ({
  distDir: phase === PHASE_DEVELOPMENT_SERVER ? ".next" : ".next-build",
  transpilePackages: ['@fob/shared'],
  output: "export",
  devIndicators: false,
  allowedDevOrigins: ["127.0.0.1"],
  images: {
    unoptimized: true,
  },
})

export default nextConfig
