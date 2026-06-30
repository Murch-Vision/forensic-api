/* -.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.
 * File Name   : anbService.ts
 * Created at  : 2026-06-24
 * Updated at  : 2026-06-24
 * Author      : jeefo
 * Purpose     :
 * Description :
.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.*/
import type {Knex} from "knex";
import type {ChartEntity, ChartLink, ChartEvent} from "../models/types";

// Ported from Services/AnbService.cs — i2 Analyst's Notebook-style chart
// entities / links / events plus the association matrix. generateFromSuspects
// projects the suspect graph (suspects + suspect_links) onto chart entities so
// the matrix has data to work with.

export interface AssociationCell {
  rowEntityId: string;
  colEntityId: string;
  rowLabel: string;
  colLabel: string;
  linkCount: number;
  totalFinancialValue: number;
  totalCallCount: number;
  totalCallDuration: number;
  strongestLinkType: string;
  strength: number;
}

export class AnbService {
  private readonly db: Knex;

  constructor(db: Knex) {
    this.db = db;
  }

  async getAllEntities(): Promise<ChartEntity[]> {
    const rows = await this.db<ChartEntity>("chart_entities").orderBy("id");
    return rows.map((r) => ({...r, isPinned: Boolean(r.isPinned),
      isHidden: Boolean(r.isHidden)}));
  }

  async createEntity(entity: Partial<ChartEntity>): Promise<ChartEntity> {
    const row = {...entity, createdAt: entity.createdAt ?? new Date().toISOString()};
    const [id] = await this.db("chart_entities").insert(row);
    const saved = await this.db<ChartEntity>("chart_entities")
      .where({id: Number(id)}).first();
    return {...saved!, isPinned: Boolean(saved!.isPinned),
      isHidden: Boolean(saved!.isHidden)};
  }

  async updateEntityPosition(id: number, x: number, y: number): Promise<void> {
    await this.db("chart_entities").where({id}).update({x, y});
  }

  async getAllChartLinks(): Promise<ChartLink[]> {
    const rows = await this.db<ChartLink>("chart_links").orderBy("id");
    return rows.map((r) => ({...r, isDirectional: Boolean(r.isDirectional),
      isDashed: Boolean(r.isDashed)}));
  }

  async createChartLink(link: Partial<ChartLink>): Promise<ChartLink> {
    const row = {...link, createdAt: link.createdAt ?? new Date().toISOString()};
    const [id] = await this.db("chart_links").insert(row);
    const saved = await this.db<ChartLink>("chart_links")
      .where({id: Number(id)}).first();
    return saved!;
  }

  getAllEvents(): Promise<ChartEvent[]> {
    return this.db<ChartEvent>("chart_events").orderBy("timestamp");
  }

  async addEvents(events: Partial<ChartEvent>[]): Promise<number> {
    if (events.length === 0) return 0;
    const now = new Date().toISOString();
    await this.db.batchInsert("chart_events",
      events.map((e) => ({...e, createdAt: e.createdAt ?? now})), 200);
    return events.length;
  }

  // Project suspects + suspect_links onto chart entities/links. Idempotent:
  // wipes and rebuilds the auto-generated graph each call.
  async generateFromSuspects(): Promise<{entities: number; links: number}> {
    const suspects = await this.db("suspects")
      .select("id", "suspectId", "fullName", "city", "country", "riskLevel");
    const suspectLinks = await this.db("suspect_links").select("*");

    await this.db("chart_links").del();
    await this.db("chart_entities").del();

    const now = new Date().toISOString();
    const entityIdBySuspect = new Map<number, number>();
    let cx = 350;
    let cy = 250;
    const radius = 200;
    for (let i = 0; i < suspects.length; i++) {
      const s = suspects[i];
      const angle = (i / Math.max(1, suspects.length)) * Math.PI * 2;
      const [id] = await this.db("chart_entities").insert({
        entityId: s.suspectId, entityType: "Person", label: s.fullName,
        description: [s.city, s.country].filter(Boolean).join(", ") || null,
        x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle),
        sourceType: "Suspect", sourceId: s.id, gradeOfInformation: "C3",
        isPinned: false, isHidden: false, createdAt: now,
      });
      entityIdBySuspect.set(s.id, Number(id));
    }

    let linkCount = 0;
    for (const l of suspectLinks) {
      const src = entityIdBySuspect.get(l.sourceSuspectId);
      const tgt = entityIdBySuspect.get(l.targetSuspectId);
      if (src == null || tgt == null) continue;
      const linkType = l.linkType === "FINANCIAL_TRANSFER" ? "Financial"
        : l.linkType === "PHONE_CONTACT" ? "Communication"
        : l.linkType === "SHARED_ADDRESS" ? "Association"
        : l.linkType === "SHARED_DEVICE" ? "Association" : "Association";
      await this.db("chart_links").insert({
        sourceEntityId: src, targetEntityId: tgt, linkType,
        label: l.description, weight: Math.min(10, l.strength ?? 1),
        isDirectional: true, isDashed: false, confidenceLevel: "C3",
        financialValue: l.totalFinancialValue ?? null,
        eventCount: l.totalCallCount ?? null, createdAt: now,
      });
      linkCount++;
    }
    return {entities: suspects.length, links: linkCount};
  }

  // CSV + i2 ANX (Analyst's Notebook Exchange XML) exports of the chart.
  async exportCsv(): Promise<{entitiesCsv: string; linksCsv: string}> {
    const entities = await this.getAllEntities();
    const links = await this.getAllChartLinks();
    const esc = (s: string) =>
      /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    const entitiesCsv = ["EntityId,EntityType,Label,Description,X,Y",
      ...entities.map((e) => [e.entityId, e.entityType, e.label,
        e.description ?? "", e.x, e.y].map((v) => esc(String(v))).join(","))]
      .join("\n");
    const linksCsv = ["SourceEntityId,TargetEntityId,LinkType,Label,Weight,FinancialValue",
      ...links.map((l) => [l.sourceEntityId, l.targetEntityId, l.linkType,
        l.label ?? "", l.weight, l.financialValue ?? ""]
        .map((v) => esc(String(v))).join(","))].join("\n");
    return {entitiesCsv, linksCsv};
  }

  async exportAnx(): Promise<string> {
    const entities = await this.getAllEntities();
    const links = await this.getAllChartLinks();
    const x = (s: string) => (s ?? "").replace(/[<>&"]/g, (c) =>
      ({"<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;"}[c] as string));
    const idByPk = new Map(entities.map((e) => [e.id, e.entityId]));
    const ents = entities.map((e) =>
      `    <Entity Id="${x(e.entityId)}" Type="${x(e.entityType)}" ` +
      `Label="${x(e.label)}" X="${e.x}" Y="${e.y}" />`).join("\n");
    const lks = links.map((l) =>
      `    <Link Source="${x(idByPk.get(l.sourceEntityId) ?? "")}" ` +
      `Target="${x(idByPk.get(l.targetEntityId) ?? "")}" ` +
      `Type="${x(l.linkType)}" Weight="${l.weight}" />`).join("\n");
    return `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<Chart xmlns="urn:i2:anx" generator="ForensicAnalystWorkstation">\n` +
      `  <Entities>\n${ents}\n  </Entities>\n` +
      `  <Links>\n${lks}\n  </Links>\n</Chart>\n`;
  }

  async buildAssociationMatrix(): Promise<AssociationCell[]> {
    const entities = await this.getAllEntities();
    const links = await this.getAllChartLinks();
    const persons = entities.filter((e) => e.entityType === "Person");
    const cells: AssociationCell[] = [];

    const maxFinancial = Math.max(1, ...links
      .filter((l) => l.financialValue != null)
      .map((l) => l.financialValue as number));
    const maxEvents = Math.max(1, ...links
      .filter((l) => l.eventCount != null)
      .map((l) => l.eventCount as number));

    for (let i = 0; i < persons.length; i++) {
      for (let j = 0; j < persons.length; j++) {
        if (i === j) continue;
        const p1 = persons[i];
        const p2 = persons[j];
        const p1Ids = new Set<number>([p1.id]);
        const p2Ids = new Set<number>([p2.id]);
        for (const l of links) {
          if (l.sourceEntityId === p1.id && l.linkType === "Ownership") {
            p1Ids.add(l.targetEntityId);
          }
          if (l.sourceEntityId === p2.id && l.linkType === "Ownership") {
            p2Ids.add(l.targetEntityId);
          }
        }
        const connecting = links.filter((l) => l.linkType !== "Ownership"
          && ((p1Ids.has(l.sourceEntityId) && p2Ids.has(l.targetEntityId))
            || (p2Ids.has(l.sourceEntityId) && p1Ids.has(l.targetEntityId))));
        if (connecting.length === 0) continue;

        const totalFinancial = connecting
          .filter((l) => l.financialValue != null)
          .reduce((a, l) => a + (l.financialValue as number), 0);
        const totalEvents = connecting
          .filter((l) => l.eventCount != null)
          .reduce((a, l) => a + (l.eventCount as number), 0);
        const strongest = connecting.reduce((a, b) => a.weight >= b.weight ? a : b);
        let strength = 0;
        if (maxFinancial > 0) strength += (totalFinancial / maxFinancial) * 0.5;
        if (maxEvents > 0) strength += (totalEvents / maxEvents) * 0.5;
        strength = Math.min(1, strength);

        cells.push({
          rowEntityId: p1.entityId, colEntityId: p2.entityId,
          rowLabel: p1.label, colLabel: p2.label, linkCount: connecting.length,
          totalFinancialValue: totalFinancial,
          totalCallCount: connecting.filter((l) => l.linkType === "Communication")
            .reduce((a, l) => a + (l.eventCount ?? 0), 0),
          totalCallDuration: 0, strongestLinkType: strongest.linkType, strength,
        });
      }
    }
    return cells;
  }
}
