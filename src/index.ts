/* -.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.
 * File Name   : index.ts
 * Created at  : 2026-06-23
 * Updated at  : 2026-06-23
 * Author      : jeefo
 * Purpose     :
 * Description :
.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.*/
// FIRST — every module below reads process.env while it initialises (knex picks
// up DB_FILE at import time), so .env has to be in place before any of them run.
import "dotenv/config";
import http from "node:http";
import {ApolloServer} from "@apollo/server";
import {expressMiddleware} from "@apollo/server/express4";
import express from "express";
import cors from "cors";
import db from "./db/knex";
import {typeDefs} from "./graphql/schema";
import {resolvers, type GraphQLContext} from "./graphql/resolvers";
import {SuspectService} from "./services/suspectService";
import {DataService} from "./services/dataService";
import {AnalysisService} from "./services/analysisService";
import {GeospatialService} from "./services/geospatialService";
import {ImportService} from "./services/importService";
import {ReportService} from "./services/reportService";
import {AuditLogService} from "./services/auditLogService";
import {EvidenceService} from "./services/evidenceService";
import {PeopleService} from "./services/peopleService";
import {SanctionsService} from "./services/sanctionsService";
import {SanctionsRefreshService} from "./services/sanctionsRefreshService";
import {SettingsService} from "./services/settingsService";
import {TravelCorrelationService} from "./services/travelCorrelationService";
import {CaseSessionService} from "./services/caseSessionService";
import {AnbService} from "./services/anbService";
import {LocalizationService} from "./services/localizationService";
import {TelemetryService} from "./services/telemetryService";
import {NoiseFilterService} from "./services/noiseFilterService";
import {CaseGraphService} from "./services/caseGraphService";
import {AuthService} from "./services/authService";
import {UpdateService} from "./services/updateService";

// CORS_ORIGIN is a comma-separated allow-list, e.g.
//   CORS_ORIGIN=http://localhost:5173,http://192.168.1.50:5173
// Unset reflects whatever origin asked, which is what an on-premise install
// needs: the workstation is reached by localhost, by hostname and by LAN IP,
// and all three are the same machine.
function corsOptions(): cors.CorsOptions {
  const allowed = (process.env.CORS_ORIGIN || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    // Reflecting the origin (rather than "*") is what makes credentials and a
    // preflighted Authorization header work at all.
    origin: allowed.length > 0 ? allowed : true,
    credentials: true,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: [
      "Content-Type", "Authorization", "apollo-require-preflight",
      "x-apollo-operation-name",
    ],
    maxAge: 86400,
  };
}

async function main(): Promise<void> {
  const server = new ApolloServer<GraphQLContext>({typeDefs, resolvers});
  const port = Number(process.env.PORT || 4000);

  const data = new DataService(db);
  const audit = new AuditLogService(db);
  const sanctions = new SanctionsService();
  const geo = new GeospatialService();
  const settings = new SettingsService();
  const auth = new AuthService(db);
  const i18n = new LocalizationService();
  const telemetry = new TelemetryService(settings);
  const update = new UpdateService();
  // Per-request context: resolve the caller from the Authorization: Bearer
  // token so every resolver knows who's asking (and which cases they may see).
  const context = async ({req}: {req?: {headers: Record<string, unknown>}}):
    Promise<GraphQLContext> => {
    const header = String(req?.headers?.authorization ?? "");
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    const user = await auth.userForToken(token);
    return {
      suspects : new SuspectService(db),
      data,
      analysis : new AnalysisService(data),
      geo,
      imports  : new ImportService(db),
      reports  : new ReportService(data),
      audit,
      evidence : new EvidenceService(db, audit),
      people   : new PeopleService(db),
      sanctions,
      sanctionsRefresh : new SanctionsRefreshService(db, sanctions, audit),
      settings,
      travel   : new TravelCorrelationService(data, geo),
      // Active case is per-user now, so the session binds to the caller.
      session  : new CaseSessionService(db, user?.id ?? null),
      anb      : new AnbService(db),
      i18n,
      telemetry,
      noise    : new NoiseFilterService(db),
      graphs   : new CaseGraphService(db),
      auth,
      update,
      user,
      token,
    };
  };

  // startStandaloneServer gives no way to configure CORS, so the browser was
  // stuck with Apollo's defaults: no Authorization on preflight and no way to
  // allow the workstation's own origin. Run the middleware on express instead.
  await server.start();

  const app = express();
  app.use(cors(corsOptions()));
  // Imported statements arrive as base64 in the mutation body, so the default
  // 100kb limit rejects real evidence files.
  app.use(express.json({limit: process.env.BODY_LIMIT || "50mb"}));
  // Plain liveness probe for the launcher / uptime checks.
  app.get("/health", (_req, res) => {
    res.json({ok: true});
  });
  app.use("/", expressMiddleware(server, {context}));

  const httpServer = http.createServer(app);
  await new Promise<void>((resolve) => httpServer.listen({port}, resolve));

  console.log(`Forensic Analyst GraphQL API ready at http://localhost:${port}/`);
  console.log(`CORS: ${process.env.CORS_ORIGIN || "any origin (reflected)"}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
