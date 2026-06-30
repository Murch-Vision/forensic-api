/* -.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.
 * File Name   : geospatialService.ts
 * Created at  : 2026-06-23
 * Updated at  : 2026-06-23
 * Author      : jeefo
 * Purpose     :
 * Description :
.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.*/
import type {Suspect} from "../models/types";

// Ported from Services/GeospatialService.cs — resolves City/Address free text
// to Mongolian city / Ulaanbaatar district centroids (WGS84).

const COORDINATES: Record<string, [number, number]> = {
  "БГД": [47.9170, 106.8550], "Баянгол": [47.9170, 106.8550],
  "Bayangol": [47.9170, 106.8550], "БЗД": [47.9100, 106.9700],
  "Баянзүрх": [47.9100, 106.9700], "Bayanzurkh": [47.9100, 106.9700],
  "СХД": [47.9500, 106.8900], "Сүхбаатар": [47.9500, 106.8900],
  "Sukhbaatar": [47.9500, 106.8900], "ХУД": [47.8600, 106.7500],
  "Хан-Уул": [47.8600, 106.7500], "Khan-Uul": [47.8600, 106.7500],
  "ЧД": [47.9180, 106.9170], "Чингэлтэй": [47.9180, 106.9170],
  "Chingeltei": [47.9180, 106.9170], "СБД": [47.9590, 107.0100],
  "Songinokhairkhan": [47.9000, 106.7000], "Сонгинохайрхан": [47.9000, 106.7000],
  "Налайх": [47.7800, 107.2570], "Nalaikh": [47.7800, 107.2570],
  "Багануур": [47.8200, 108.4200], "Baganuur": [47.8200, 108.4200],
  "Багахангай": [47.7800, 107.6800],
  "Улаанбаатар": [47.9210, 106.9180], "Ulaanbaatar": [47.9210, 106.9180],
  "UB": [47.9210, 106.9180], "Эрдэнэт": [49.0344, 104.0444],
  "Erdenet": [49.0344, 104.0444], "Дархан": [49.4869, 105.9228],
  "Darkhan": [49.4869, 105.9228], "Чойбалсан": [48.0719, 114.5325],
  "Choibalsan": [48.0719, 114.5325], "Мөрөн": [49.6333, 100.1583],
  "Moron": [49.6333, 100.1583], "Ховд": [48.0050, 91.6419],
  "Khovd": [48.0050, 91.6419], "Улгий": [48.9683, 89.9617],
  "Ulgii": [48.9683, 89.9617], "Алтай": [46.3742, 96.2611],
  "Altai": [46.3742, 96.2611], "Завхан": [47.7700, 96.3000],
  "Uliastai": [47.7400, 96.8425], "Сайншанд": [44.8956, 110.1389],
  "Sainshand": [44.8956, 110.1389],
};

const lookup = new Map<string, [number, number]>(
  Object.entries(COORDINATES).map(([k, v]) => [k.toLowerCase(), v]));

export interface SuspectLocation {
  suspectId    : number;
  fullName     : string;
  displayName  : string;
  lat          : number;
  lng          : number;
  resolvedFrom : string;
}

function tokenize(address: string): string[] {
  return address.split(/[\s,;./\\—\-]+/)
    .map((raw) => raw.trim().replace(/[.,]+$/, ""))
    .filter((token) => token.length >= 2);
}

export interface ResolvedLocation {
  lat: number;
  lng: number;
  displayName: string;
}

export interface DwellZone {
  lat: number;
  lng: number;
  hits: number;
  displayName: string;
  hoursDistribution: number[];
}

export interface LocationDensity {
  lat: number;
  lng: number;
  count: number;
  displayName: string;
}

export interface LocatedEvent {
  timestamp: string;
  location: string | null;
  kind: string;
}

export class GeospatialService {
  // Resolve any free-text location string to a known coordinate; longest
  // tokens are matched first. Null when no token is recognised.
  resolveLocationString(location: string | null): ResolvedLocation | null {
    if (!location || !location.trim()) return null;
    for (const token of tokenize(location)) {
      const c = lookup.get(token.toLowerCase());
      if (c) return {lat: c[0], lng: c[1], displayName: token};
    }
    return null;
  }

  resolve(suspect: Suspect): SuspectLocation | null {
    if (suspect.address?.trim()) {
      for (const token of tokenize(suspect.address)) {
        const c = lookup.get(token.toLowerCase());
        if (c) {
          return {
            suspectId: suspect.id, fullName: suspect.fullName, displayName: token,
            lat: c[0], lng: c[1], resolvedFrom: `address:'${token}'`,
          };
        }
      }
    }
    if (suspect.city?.trim()) {
      const c = lookup.get(suspect.city.trim().toLowerCase());
      if (c) {
        return {
          suspectId: suspect.id, fullName: suspect.fullName,
          displayName: suspect.city.trim(), lat: c[0], lng: c[1],
          resolvedFrom: `city:'${suspect.city}'`,
        };
      }
    }
    return null;
  }

  resolveAll(suspects: Suspect[]): SuspectLocation[] {
    const out: SuspectLocation[] = [];
    for (const s of suspects) {
      const loc = this.resolve(s);
      if (loc) out.push(loc);
    }
    return out;
  }

  // F-4 · cluster located events into dwell zones with an hour-of-day
  // distribution (ported from ClusterDwellZones).
  clusterDwellZones(events: LocatedEvent[], maxResults = 10): DwellZone[] {
    const byPlace = new Map<string,
      {lat: number; lng: number; hits: number; hours: number[]; name: string}>();
    for (const e of events) {
      const r = this.resolveLocationString(e.location);
      if (!r) continue;
      const key = `${r.lat.toFixed(4)},${r.lng.toFixed(4)}`;
      const hour = new Date(e.timestamp).getUTCHours();
      const b = byPlace.get(key);
      if (b) {
        b.hits++;
        b.hours[hour]++;
      } else {
        const hours = new Array(24).fill(0);
        hours[hour]++;
        byPlace.set(key,
          {lat: r.lat, lng: r.lng, hits: 1, hours, name: r.displayName});
      }
    }
    return [...byPlace.values()]
      .sort((a, b) => b.hits - a.hits)
      .slice(0, Math.max(1, maxResults))
      .map((b) => ({lat: b.lat, lng: b.lng, hits: b.hits,
        displayName: b.name, hoursDistribution: b.hours}));
  }

  // F-3 · aggregate (lat,lng) points into density buckets snapped to a
  // gridKm grid (equirectangular approx anchored at ~47°N).
  aggregateGrid(
    points: {lat: number; lng: number; displayName: string}[],
    gridKm = 1
  ): LocationDensity[] {
    if (gridKm <= 0) gridKm = 1;
    const stepLat = gridKm / 111;
    const stepLng = gridKm / 76;
    const buckets = new Map<string,
      {sumLat: number; sumLng: number; count: number; name: string}>();
    for (const p of points) {
      const key = `${Math.floor(p.lat / stepLat)},${Math.floor(p.lng / stepLng)}`;
      const b = buckets.get(key);
      if (b) {
        b.sumLat += p.lat;
        b.sumLng += p.lng;
        b.count++;
      } else {
        buckets.set(key,
          {sumLat: p.lat, sumLng: p.lng, count: 1, name: p.displayName});
      }
    }
    return [...buckets.values()]
      .map((b) => ({lat: b.sumLat / b.count, lng: b.sumLng / b.count,
        count: b.count, displayName: b.name}))
      .sort((a, b) => b.count - a.count);
  }
}
