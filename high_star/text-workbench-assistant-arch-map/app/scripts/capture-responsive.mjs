import { writeFileSync } from "node:fs";

const [, , debugPort, targetUrl, outputPath, scenario = "agent"] = process.argv;
if (!debugPort || !targetUrl || !outputPath) throw new Error("Usage: capture-responsive <port> <url> <output> [agent|history]");

const page = await fetch(`http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent(targetUrl)}`, { method: "PUT" }).then((response) => response.json());
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

let sequence = 0;
const pending = new Map();
socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (!message.id) return;
  const handler = pending.get(message.id);
  if (!handler) return;
  pending.delete(message.id);
  if (message.error) handler.reject(new Error(message.error.message));
  else handler.resolve(message.result);
});

const send = (method, params = {}) => new Promise((resolve, reject) => {
  sequence += 1;
  pending.set(sequence, { resolve, reject });
  socket.send(JSON.stringify({ id: sequence, method, params }));
});

await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", {
  width: 390,
  height: 844,
  deviceScaleFactor: 1,
  mobile: true,
  screenWidth: 390,
  screenHeight: 844,
});
await send("Page.navigate", { url: targetUrl });
await new Promise((resolve) => setTimeout(resolve, 1300));

if (scenario === "history") {
  await send("Runtime.evaluate", {
    expression: `Array.from(document.querySelectorAll('.knowledge-card-tabs button')).find((button) => button.textContent.includes('历史修改'))?.click()`,
  });
} else {
  await send("Runtime.evaluate", { expression: `document.querySelector('.inspector-toggle')?.click(); document.querySelector('.graph-agent')?.scrollIntoView({block:'start'})` });
}
await new Promise((resolve) => setTimeout(resolve, 350));
const result = await send("Page.captureScreenshot", { format: "png", fromSurface: true });
writeFileSync(outputPath, Buffer.from(result.data, "base64"));
socket.close();
await fetch(`http://127.0.0.1:${debugPort}/json/close/${page.id}`);
