import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const configDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  root: resolve(configDir),
  base: "/",
  resolve: {
    alias: {
      "@claude-run/api": resolve(configDir, "../api/storage.ts"),
    },
  },
  server: {
    port: 12000,
    proxy: {
      "/api": {
        target: "http://localhost:12001",
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on("proxyReq", (proxyReq, req) => {
            if (req.url?.includes("/stream")) {
              proxyReq.setHeader("Cache-Control", "no-cache");
              proxyReq.setHeader("Connection", "keep-alive");
            }
          });
          proxy.on("proxyRes", (proxyRes, req) => {
            if (req.url?.includes("/stream")) {
              proxyRes.headers["cache-control"] = "no-cache";
              proxyRes.headers["x-accel-buffering"] = "no";
            }
          });
        },
      },
    },
  },
  build: {
    outDir: resolve(configDir, "../dist/web"),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("/react/") || id.includes("/react-dom/") || id.includes("/scheduler/")) {
            return "react-vendor";
          }
          if (id.includes("/react-markdown/") || id.includes("/remark-gfm/") || id.includes("/micromark/")) {
            return "markdown-vendor";
          }
          if (id.includes("/@xterm/")) return "terminal-vendor";
          if (id.includes("/lucide-react/")) return "icons-vendor";
          return "vendor";
        },
      },
    },
  },
});
