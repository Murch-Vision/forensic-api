/* -.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.
 * File Name   : localizationService.ts
 * Created at  : 2026-06-24
 * Updated at  : 2026-06-24
 * Author      : jeefo
 * Purpose     :
 * Description :
.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.*/
import fs from "fs";
import path from "path";

// Ported from Services/LocalizationService.cs — loads mongolian.csv /
// english.csv key→value tables (copied into backend/assets). Get(key) falls
// back to the key when missing; getChartsPayload mirrors the C# chart locale.

// ASSETS_DIR lets a packaged/desktop build point at bundled read-only assets
// (Tauri resources) instead of the source-tree ../../assets path.
const ASSETS = process.env.ASSETS_DIR
  || path.join(__dirname, "..", "..", "assets");

export class LocalizationService {
  private translations = new Map<string, string>();
  private currentLanguage = "mongolian";

  constructor() {
    this.loadLanguage(this.currentLanguage);
  }

  get language(): string {
    return this.currentLanguage;
  }

  setLanguage(language: string): void {
    if (language !== this.currentLanguage) {
      this.currentLanguage = language;
      this.loadLanguage(language);
    }
  }

  get(key: string, defaultValue?: string): string {
    return this.translations.get(key) ?? defaultValue ?? key;
  }

  all(): Record<string, string> {
    return Object.fromEntries(this.translations);
  }

  getChartsPayload(): Record<string, string> {
    return {
      "axis.leadingDigit": this.get("chart.axis.leadingDigit", "Эхний оронгийн утга"),
      "axis.frequency": this.get("chart.axis.frequency", "Давтамж"),
      "axis.value": this.get("chart.axis.value", "Утга"),
      "axis.hourOfDay": this.get("chart.axis.hourOfDay", "Хоногийн цаг"),
      "legend.credits": this.get("chart.legend.credits", "Орлогын гүйлгээ"),
      "legend.debits": this.get("chart.legend.debits", "Зарлагын гүйлгээ"),
      "legend.expectedBenford": this.get("chart.legend.expectedBenford",
        "Хүлээгдэж буй (Бенфорд)"),
      "legend.observed": this.get("chart.legend.observed", "Ажиглагдсан"),
    };
  }

  private loadLanguage(language: string): void {
    this.translations.clear();
    const file = path.join(ASSETS, `${language}.csv`);
    try {
      const text = fs.readFileSync(file, "utf8");
      const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
      for (let i = 1; i < lines.length; i++) {
        const parts = parseCsvLine(lines[i]);
        if (parts.length >= 2 && parts[0].trim()) {
          this.translations.set(parts[0].trim(), parts[1].trim());
        }
      }
    } catch {
      if (language !== "english") this.loadLanguage("english");
    }
  }
}

function parseCsvLine(line: string): string[] {
  const parts: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (const c of line) {
    if (c === '"') inQuotes = !inQuotes;
    else if (c === "," && !inQuotes) {
      parts.push(cur);
      cur = "";
    } else cur += c;
  }
  parts.push(cur);
  return parts;
}
