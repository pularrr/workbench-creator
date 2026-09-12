import { fileURLToPath } from "node:url";
export const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
export async function withProjectModules(callback, root = projectRoot) {
  const { createServer } = await import("vite");
  const vite = await createServer({ root, configFile: false, appType: "custom",
    resolve: { alias: { "@": root } }, server: { middlewareMode: true, hmr: false, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] } });
  try { return await callback(path => vite.ssrLoadModule(path)); }
  finally { await vite.close(); }
}
