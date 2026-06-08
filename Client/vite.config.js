import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: __dirname,
  base: "./",
  build: {
    rollupOptions: {
      input: resolve(__dirname, "index.html")
    }
  },
  server: {
    fs: {
      allow: [resolve(__dirname, "..")]
    }
  }
});
