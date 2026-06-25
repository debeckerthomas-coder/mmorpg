import { defineConfig } from "vite";

/**
 * Config Vite du client (Brique 5).
 *
 * Le frontend vit dans `src/client/` (avec son propre `index.html`). En dev,
 * Vite sert l'app sur http://localhost:5173 et le client se connecte au serveur
 * WebSocket autoritaire sur le port 8080 (cf. src/client/main.ts).
 */
export default defineConfig({
  root: "src/client",
  server: {
    port: 5173,
    open: false,
  },
  build: {
    outDir: "../../dist/client",
    emptyOutDir: true,
  },
});
