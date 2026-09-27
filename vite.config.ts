import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  base: "/fieldops-offline/",
  plugins: [
    react(),
    VitePWA({
      strategies: "generateSW",
      injectRegister: "script",
      // Let updated workers wait until existing tabs close; never reload a form.
      registerType: "prompt",
      scope: "/fieldops-offline/",
      manifest: {
        id: "/fieldops-offline/",
        name: "FieldOps Offline",
        short_name: "FieldOps",
        start_url: "/fieldops-offline/",
        scope: "/fieldops-offline/",
        display: "standalone",
        theme_color: "#162b40",
        background_color: "#ffffff",
        icons: [
          { src: "pwa-192.png", sizes: "192x192", type: "image/png" },
          { src: "pwa-512.png", sizes: "512x512", type: "image/png" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,ico,woff,woff2}"],
        navigateFallback: "/fieldops-offline/index.html",
        navigateFallbackAllowlist: [/^\/fieldops-offline\//],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
});
