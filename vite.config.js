import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { execSync } from "child_process";
import { readFileSync } from "fs";

const pkg     = JSON.parse(readFileSync("./package.json", "utf-8"));
const version = pkg.version || "0.0.0";
let   gitHash = "unknown";
try { gitHash = execSync("git rev-parse --short HEAD").toString().trim(); } catch (_) {}

export default defineConfig({
  plugins: [react()],
  define: {
    "import.meta.env.VITE_APP_VERSION": JSON.stringify(`${version}|${gitHash}`),
  },

  build: {
    outDir: "dist",
    sourcemap: false,
    minify: false,   // disables esbuild TDZ hoisting that crashes React hooks in production
    rollupOptions: {
      output: {
        // Split vendor chunks for better caching
        manualChunks: {
          "react-vendor": ["react", "react-dom"],
          "icons":        ["lucide-react"],
        },
      },
    },
  },

});
