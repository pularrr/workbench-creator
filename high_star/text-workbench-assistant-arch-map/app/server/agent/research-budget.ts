import type { LlmMessage } from "../../core/llm/contracts";

export function nextResearchBudget(current: number, limit: number, truncated: boolean) {
  return Math.max(1, Math.min(limit, truncated ? Math.ceil(current * 1.5) : current));
}

/** Reduce a context object without ever slicing serialized JSON mid-object. */
export function boundedContext(value: unknown, limit: number): string {
  const full = JSON.stringify(value);
  if (full.length <= limit) return full;
  function compact(input: unknown, textLimit: number, arrayLimit: number): unknown {
    if (typeof input === "string") return input.length > textLimit ? input.slice(0,textLimit) + "…[上下文节选]" : input;
    if (Array.isArray(input)) return input.slice(0,arrayLimit).map((item) => compact(item,textLimit,arrayLimit));
    if (input && typeof input === "object") return Object.fromEntries(Object.entries(input).map(([key,item]) => [key,compact(item,textLimit,arrayLimit)]));
    return input;
  }
  for (const [textLimit,arrayLimit] of [[2400,120],[1200,60],[600,30],[300,15],[120,6],[60,2]]) {
    const result = JSON.stringify({contextExcerpt:true,data:compact(value,textLimit,arrayLimit)});
    if (result.length <= limit) return result;
  }
  return JSON.stringify({contextExcerpt:true,note:"上下文超出当前模型预算，请按章节提供资料。"});
}

export function fitResearchMessages(messages: readonly LlmMessage[], instructions: string, repair: string, maxInputChars: number): LlmMessage[] {
  const available = maxInputChars - instructions.length - 128;
  if (available < 1000) throw new Error("模型输入预算过小，无法容纳研究契约；请提高输入上限。");
  const entries = [...messages, ...(repair ? [{role:"user" as const,content:repair}] : [])];
  const each = Math.floor(available / Math.max(1,entries.length));
  return entries.map((entry) => {
    if (entry.content.length <= each) return entry;
    try { return {...entry,content:boundedContext(JSON.parse(entry.content),each)}; }
    catch { return {...entry,content:entry.content.slice(0,each-45)+"\n[当前仅注入此部分资料；后续批次继续处理]"}; }
  });
}

/** Extract only fully closed object items from a truncated JSON array. */
export function completeArrayObjects(text: string, key: string): unknown[] {
  const marker = new RegExp('"' + key + '"\\s*:\\s*\\[').exec(text);
  if (!marker) return [];
  const items: unknown[] = [];
  let start = -1, depth = 0, quoted = false, escape = false;
  for (let i = marker.index + marker[0].length; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (escape) escape = false;
      else if (c === "\\") escape = true;
      else if (c === '"') quoted = false;
      continue;
    }
    if (c === '"') { quoted = true; continue; }
    if (start === -1) {
      if (c === "]") break;
      if (c === "{") {start=i;depth=1;}
    } else {
      if (c === "{") depth++;
      if (c === "}") {
        depth--;
        if (depth===0) {
          try {items.push(JSON.parse(text.slice(start,i+1)));} catch { /* Invalid item is not materialized. */ }
          start=-1;
        }
      }
    }
  }
  return items;
}
