import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: false,
  },
  build: {
    outDir: "dist",
    sourcemap: false, // Disable sourcemaps in production (save ~750KB)
    minify: "esbuild", // Fast minification with esbuild
    target: "es2020",
    cssMinify: true,
    rollupOptions: {
      output: {
        manualChunks: {
          // Core vendor chunks — stable across builds
          "vendor-react": ["react", "react-dom"],
          "vendor-router": ["react-router-dom"],
          // Cobe globe is heavy and only used on homepage — isolate it
          "vendor-cobe": ["cobe"],
        },
        // Compact chunk filenames
        chunkFileNames: "assets/[hash].js",
        entryFileNames: "assets/[hash].js",
        // Aggressive tree-shaking
      },
    },
  },
});
