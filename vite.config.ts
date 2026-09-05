import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  base: "/fieldops-offline/",
  plugins: [react()],
});
