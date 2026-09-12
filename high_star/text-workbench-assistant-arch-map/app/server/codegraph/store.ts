import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { CodeGraphState } from "../../core/codegraph/schema";

const empty = (): CodeGraphState => ({ repositories: [], nodes: [], links: [], runs: [], batches: [] });

/** Small local durable store until the runtime JSON → relational migration adds
 * CodeGraph tables.  It never mutates KnowledgeDataset. */
export class CodeGraphStore {
  constructor(private readonly file: string) {}

  async read(): Promise<CodeGraphState> {
    try {
      const value = JSON.parse(await readFile(this.file, "utf8")) as Partial<CodeGraphState>;
      return { repositories: value.repositories ?? [], nodes: value.nodes ?? [], links: value.links ?? [], runs: value.runs ?? [], batches: value.batches ?? [] };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return empty();
      throw error;
    }
  }

  async update(mutator: (state: CodeGraphState) => void): Promise<CodeGraphState> {
    const state = await this.read();
    mutator(state);
    await mkdir(dirname(this.file), { recursive: true });
    const temporary = `${this.file}.tmp`;
    await writeFile(temporary, JSON.stringify(state, null, 2), "utf8");
    await rename(temporary, this.file);
    return state;
  }
}
