"use client";
import { useState } from "react";

export const FONT_SLOTS = [
  ["xs1", "超小 · 辅助", 10], ["xs2", "超小 · 标注", 13],
  ["sm1", "小 · 次正文", 10], ["sm2", "小 · 控件", 13],
  ["md1", "中 · 正文", 13], ["md2", "中 · 强调", 15],
  ["lg1", "大 · 小标题", 16], ["lg2", "大 · 标题", 18],
  ["xl1", "超大 · 页面标题", 22], ["xl2", "超大 · 公式", 28],
] as const;
type Sizes = Record<string, number>;
const defaults = (): Sizes => Object.fromEntries(FONT_SLOTS.map(([key, , size]) => [key, size]));
export function loadTypography(): Sizes {
  let stored: Sizes = {};
  try { stored = JSON.parse(localStorage.getItem("fmcw-font-sizes") || "{}"); } catch { /* Use defaults. */ }
  const sizes = defaults();
  for (const [key] of FONT_SLOTS) {
    if (Number.isFinite(stored?.[key])) sizes[key] = Math.max(10, Math.min(40, stored[key]));
    document.documentElement.style.setProperty("--font-" + key, sizes[key] + "px");
  }
  return sizes;
}
export function TypographySettings() {
  const [sizes, setSizes] = useState<Sizes>(() => typeof window === "undefined" ? defaults() : loadTypography());
  const save = (next: Sizes) => {
    setSizes(next);
    localStorage.setItem("fmcw-font-sizes", JSON.stringify(next));
    for (const [key, value] of Object.entries(next)) document.documentElement.style.setProperty("--font-" + key, value + "px");
  };
  return <section className="typography-settings"><h3>字体大小</h3><div className="font-settings-grid">
    {FONT_SLOTS.map(([key, label]) => <label key={key}>{label}<input type="number" min="10" max="40" step="1" value={sizes[key]} aria-label={label + "字号"} onChange={(event) => { const value = Number(event.target.value); if (value >= 10 && value <= 40) save({ ...sizes, [key]: value }); }} /><span>px</span></label>)}
    </div><button type="button" onClick={() => save(defaults())}>恢复默认字号</button></section>;
}
