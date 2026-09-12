"use client";

import { useSyncExternalStore } from "react";
import type { KnowledgeHistoryEntry, KnowledgeHistoryKind } from "../../../core/knowledge/schema";

const STORAGE_KEY = "fmcw-knowledge-history-v1";
const CHANGE_EVENT = "fmcw-knowledge-history-change";
let hydrated = false;
let records: KnowledgeHistoryEntry[] = [];

function hydrate(): void {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
  try {
    const value = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]");
    records = Array.isArray(value) ? value.filter((item) => item && typeof item.summary === "string") : [];
  } catch {
    records = [];
  }
}

function subscribe(listener: () => void): () => void {
  hydrate();
  window.addEventListener(CHANGE_EVENT, listener);
  return () => window.removeEventListener(CHANGE_EVENT, listener);
}

function getSnapshot(): readonly KnowledgeHistoryEntry[] {
  hydrate();
  return records;
}

const emptyHistory: readonly KnowledgeHistoryEntry[] = [];
const getServerSnapshot = (): readonly KnowledgeHistoryEntry[] => emptyHistory;

function shorten(summary: string): string {
  const normalized = summary.replace(/\s+/g, " ").trim();
  return normalized.length > 72 ? `${normalized.slice(0, 69)}…` : normalized;
}

export function appendKnowledgeHistory(input: {
  nodeId: string;
  kind: KnowledgeHistoryKind;
  summary: string;
  revision?: number;
  sourceArtifactId?: string;
}): KnowledgeHistoryEntry {
  hydrate();
  const occurredAt = new Date().toISOString();
  const entry: KnowledgeHistoryEntry = {
    id: `history-${Date.now()}-${records.length}`,
    nodeId: input.nodeId,
    kind: input.kind,
    summary: shorten(input.summary),
    occurredAt,
    ...(input.revision !== undefined ? { revision: input.revision } : {}),
    ...(input.sourceArtifactId ? { sourceArtifactId: input.sourceArtifactId } : {}),
  };
  records = [entry, ...records].slice(0, 300);
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  window.dispatchEvent(new Event(CHANGE_EVENT));
  return entry;
}

export function useKnowledgeHistory(nodeId: string): readonly KnowledgeHistoryEntry[] {
  const all = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return all.filter((entry) => entry.nodeId === nodeId).slice(0, 15);
}
