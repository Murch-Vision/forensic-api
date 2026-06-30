/* -.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.
 * File Name   : settingsService.ts
 * Created at  : 2026-06-24
 * Updated at  : 2026-06-24
 * Author      : jeefo
 * Purpose     :
 * Description :
.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.*/
import fs from "fs";
import path from "path";
import {AmlThresholds, MongoliaDefault, type AmlConfig} from "./amlThresholds";

// Ported from Services/{FawSettings,SettingsService}.cs — operator-tuneable
// runtime settings persisted to data/settings.user.json. Saving re-applies the
// AML thresholds the analysis services consume (AmlThresholds.current).

export interface OsintSettings {
  autoRefreshEnabled: boolean;
  refreshUrl: string;
  intervalHours: number;
}

export interface FawSettings {
  schemaVersion: number;
  language: string;
  theme: string;
  auditRetentionDays: number;
  telemetryEnabled: boolean;
  aml: AmlConfig;
  osint: OsintSettings;
}

// DATA_DIR lets a packaged/desktop build redirect writable state to a per-user
// app-data directory instead of the source-tree ../../data path.
const DATA_DIR = process.env.DATA_DIR
  || path.join(__dirname, "..", "..", "data");
const FILE = path.join(DATA_DIR, "settings.user.json");

function defaults(): FawSettings {
  return {
    schemaVersion: 1,
    language: "mongolian",
    theme: "dark",
    auditRetentionDays: 365,
    telemetryEnabled: false,
    aml: {...MongoliaDefault},
    osint: {
      autoRefreshEnabled: false,
      refreshUrl:
        "https://data.opensanctions.org/datasets/latest/sanctions/targets.simple.csv",
      intervalHours: 24,
    },
  };
}

export class SettingsService {
  private current: FawSettings;

  constructor() {
    this.current = this.loadFromDisk();
    AmlThresholds.current = this.current.aml;
  }

  get(): FawSettings {
    return this.current;
  }

  save(settings: FawSettings): FawSettings {
    // Clamp the OSINT interval like the C# loader does.
    settings.osint.intervalHours = Math.min(168,
      Math.max(1, settings.osint.intervalHours));
    this.current = settings;
    AmlThresholds.current = settings.aml;
    fs.mkdirSync(path.dirname(FILE), {recursive: true});
    fs.writeFileSync(FILE, JSON.stringify(settings, null, 2), "utf8");
    return this.current;
  }

  private loadFromDisk(): FawSettings {
    const base = defaults();
    try {
      if (fs.existsSync(FILE)) {
        const user = JSON.parse(fs.readFileSync(FILE, "utf8"));
        return {
          ...base, ...user,
          aml: {...base.aml, ...(user.aml ?? {})},
          osint: {...base.osint, ...(user.osint ?? {})},
        };
      }
    } catch {
      /* fall back to defaults on a corrupt file */
    }
    return base;
  }
}
