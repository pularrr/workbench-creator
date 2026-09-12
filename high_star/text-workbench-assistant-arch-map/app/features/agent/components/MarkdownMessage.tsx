"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";

/**
 * Normalize LaTeX delimiters before rendering. Models (especially reasoning
 * models) often emit \(...\) for inline math and \[...\] for display math,
 * which remark-math does not recognize by default. Convert them to the
 * standard $...$ / $$...$$ form, but only outside code fences and inline
 * code so we never mutate user-supplied code samples.
 */
function normalizeMathDelimiters(text: string): string {
  const parts: string[] = [];
  const remaining = text;
  // Split by fenced code blocks (```...```) so we skip their content.
  const fenceRe = /```[\s\S]*?```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = fenceRe.exec(remaining)) !== null) {
    parts.push(remaining.slice(lastIndex, match.index));
    parts.push(match[0]); // keep code block verbatim
    lastIndex = fenceRe.lastIndex;
  }
  parts.push(remaining.slice(lastIndex));

  return parts.map((segment) => {
    if (segment.startsWith("```")) return segment;
    // Protect inline code (`...`) by temporarily replacing it.
    const inlineCodes: string[] = [];
    const protectedSegment = segment.replace(/`[^`]+`/g, (code) => {
      inlineCodes.push(code);
      return `\u0000INLINE${inlineCodes.length - 1}\u0000`;
    });
    let converted = protectedSegment
      // Display math \[...\] → $$...$$
      .replace(/\\\[([\s\S]*?)\\\]/g, (_m, inner: string) => `$$${inner}$$`)
      // Inline math \(...\) → $...$
      .replace(/\\\(([\s\S]*?)\\\)/g, (_m, inner: string) => `$${inner}$`);
    // Restore inline code.
    converted = converted.replace(/\u0000INLINE(\d+)\u0000/g, (_m, idx: string) => inlineCodes[Number(idx)]);
    return converted;
  }).join("");
}

/**
 * Renders assistant answer text as GitHub-flavored Markdown with LaTeX math
 * support. Inline math ($...$ / \(...\)) and display math ($$...$$ /
 * \[...\]) are rendered via KaTeX. Tables, task lists, code fences,
 * headings, lists and blockquotes come from remark-gfm.
 */
export function MarkdownMessage({ text }: { text: string }) {
  const normalized = normalizeMathDelimiters(text);
  return (
    <div className="md-message">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
      >
        {normalized}
      </ReactMarkdown>
    </div>
  );
}
