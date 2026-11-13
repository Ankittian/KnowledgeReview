import os from "node:os";
import type { NextConfig } from "next";

// In `next dev`, allow opening the app via this machine's LAN addresses (e.g. http://192.168.0.59:3000 from a phone).
// Extra hosts can be added with LAN_DEV_ORIGINS="host1,host2".
const lanHosts = [
  ...Object.values(os.networkInterfaces())
    .flat()
    .filter((i): i is os.NetworkInterfaceInfo => !!i && i.family === "IPv4" && !i.internal)
    .map((i) => i.address),
  ...(process.env.LAN_DEV_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
];

const nextConfig: NextConfig = {
  // argon2 and the Claude Agent SDK (which spawns its native engine binary) must stay out of the bundle.
  serverExternalPackages: ["@node-rs/argon2", "@anthropic-ai/claude-agent-sdk"],
  poweredByHeader: false,
  allowedDevOrigins: lanHosts,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
