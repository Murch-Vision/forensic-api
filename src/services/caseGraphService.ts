/* -.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.
 * File Name   : caseGraphService.ts
 * Created at  : 2026-07-03
 * Updated at  : 2026-07-03
 * Author      : jeefo
 * Purpose     : CRUD for saved connection-graph boards (per case).
 * Description :
.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.*/
import type {Knex} from "knex";

export interface CaseGraph {
  id         : number;
  caseFileId : number;
  name       : string;
  state      : string;   // JSON string
  createdAt  : string;
  updatedAt  : string;
}

export class CaseGraphService {
  private readonly db: Knex;

  constructor(db: Knex) {
    this.db = db;
  }

  listForCase(caseFileId: number): Promise<CaseGraph[]> {
    return this.db<CaseGraph>("case_graphs")
      .where({caseFileId})
      .orderBy("updatedAt", "desc");
  }

  async create(
    caseFileId: number, name: string, state: string,
  ): Promise<CaseGraph> {
    const now = new Date().toISOString();
    const [id] = await this.db("case_graphs").insert({
      caseFileId, name: name.trim() || "Нэргүй граф",
      state: state || "{}", createdAt: now, updatedAt: now,
    });
    const row = await this.db<CaseGraph>("case_graphs")
      .where({id: Number(id)}).first();
    return row!;
  }

  // Update a board's name and/or state. Only the provided fields change.
  async update(
    id: number, patch: {name?: string; state?: string},
  ): Promise<CaseGraph> {
    const row: Record<string, unknown> = {updatedAt: new Date().toISOString()};
    if (patch.name != null) row.name = patch.name.trim() || "Нэргүй граф";
    if (patch.state != null) row.state = patch.state;
    await this.db("case_graphs").where({id}).update(row);
    const updated = await this.db<CaseGraph>("case_graphs")
      .where({id}).first();
    if (!updated) throw new Error(`Graph ${id} not found`);
    return updated;
  }

  async remove(id: number): Promise<boolean> {
    const n = await this.db("case_graphs").where({id}).del();
    return n > 0;
  }
}
