/* -.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.
 * File Name   : travelCorrelationService.ts
 * Created at  : 2026-06-24
 * Updated at  : 2026-06-24
 * Author      : jeefo
 * Purpose     :
 * Description :
.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.*/
import type {DataService} from "./dataService";
import type {GeospatialService} from "./geospatialService";

// Ported from Services/TravelCorrelationService.cs (F-6). Flags "money moved
// in place X, then a call routed through place Y within ΔT" — the suspect
// can't be in two places at once, so it's an investigative signal.

export interface TravelHit {
  suspectId: number;
  suspectName: string;
  eventTime: string;
  transactionAmount: number;
  transactionType: string;
  transactionLocation: string;
  callNumber: string;
  callLocation: string;
  timeDifferenceMinutes: number;
}

export class TravelCorrelationService {
  private readonly db: DataService;
  private readonly geo: GeospatialService;

  constructor(db: DataService, geo: GeospatialService) {
    this.db = db;
    this.geo = geo;
  }

  async findCrossLocationPatterns(
    suspectId: number,
    hourWindow = 4.0
  ): Promise<TravelHit[]> {
    const suspect = await this.db.getSuspectById(suspectId);
    if (!suspect) return [];
    const txnRows = await this.db.getTransactionsForSuspect(suspectId);
    const callRows = await this.db.getCallRecordsForSuspect(suspectId);

    const hits: TravelHit[] = [];
    const windowMs = Math.max(0.1, hourWindow) * 3_600_000;

    for (const t of txnRows) {
      const tLoc = this.geo.resolveLocationString(t.location);
      if (!tLoc) continue;
      for (const c of callRows) {
        const cLoc = this.geo.resolveLocationString(c.location);
        if (!cLoc) continue;
        const dtMs = new Date(c.startTime).getTime()
          - new Date(t.timestamp).getTime();
        if (Math.abs(dtMs) > windowMs) continue;
        if (tLoc.displayName.toLowerCase() === cLoc.displayName.toLowerCase()) {
          continue;
        }
        hits.push({
          suspectId, suspectName: suspect.fullName, eventTime: t.timestamp,
          transactionAmount: t.amount, transactionType: t.type,
          transactionLocation: tLoc.displayName, callNumber: c.callerNumber,
          callLocation: cLoc.displayName, timeDifferenceMinutes: dtMs / 60000,
        });
      }
    }
    return hits.sort((a, b) => b.eventTime.localeCompare(a.eventTime));
  }

  async findCrossLocationPatternsForAll(
    suspectIds: number[],
    hourWindow = 4.0
  ): Promise<TravelHit[]> {
    const all: TravelHit[] = [];
    for (const id of suspectIds) {
      all.push(...await this.findCrossLocationPatterns(id, hourWindow));
    }
    return all.sort((a, b) => b.eventTime.localeCompare(a.eventTime));
  }
}
