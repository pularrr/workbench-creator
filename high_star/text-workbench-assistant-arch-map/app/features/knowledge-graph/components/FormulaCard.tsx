"use client";

import katex from "katex";
import "katex/dist/katex.min.css";
import { useMemo, useState } from "react";
import { formulaMeta, type FormulaSymbol } from "../model/knowledgeViewModel";

function Latex({ value, inline = false }: { value: string; inline?: boolean }) {
  const html = useMemo(
    () =>
      katex.renderToString(value, {
        displayMode: !inline,
        throwOnError: false,
        strict: "warn",
        trust: false,
        output: "htmlAndMathml",
      }),
    [value, inline],
  );
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
}

export function FormulaCard({ nodeId, fallback }: { nodeId: string; fallback: string }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const meta = formulaMeta[nodeId];
  const latex = meta?.latex ?? fallback;
  const symbols: FormulaSymbol[] = meta?.symbols ?? [];

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(latex);
    } catch {
      const field = document.createElement("textarea");
      field.value = latex;
      document.body.appendChild(field);
      field.select();
      document.execCommand("copy");
      field.remove();
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="formula-card" id={`formula-${nodeId}`}>
      <div className="formula-head">
        <a href={`?node=${encodeURIComponent(nodeId)}#formula-${nodeId}`} aria-label="链接到此公式">
          FORMULA #
        </a>
        <div className="formula-actions">
          <button onClick={copy}>{copied ? "已复制" : "复制 LaTeX"}</button>
          <button
            className={expanded ? "active" : ""}
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
            aria-controls={`formula-symbols-${nodeId}`}
            title="展开字母与符号解释"
          >
            ?
          </button>
        </div>
      </div>
      <div className="formula-render">
        <Latex value={latex} />
      </div>
      {expanded && (
        <div className="formula-symbols" id={`formula-symbols-${nodeId}`}>
          {symbols.length ? (
            symbols.map((symbol) => (
              <div key={symbol.symbol}>
                <strong>
                  <Latex value={symbol.latex} inline />
                </strong>
                <span>{symbol.explanation}</span>
                {symbol.unit && <small>单位：{symbol.unit}</small>}
              </div>
            ))
          ) : (
            <p>该公式暂不需要额外符号说明。</p>
          )}
        </div>
      )}
    </div>
  );
}
