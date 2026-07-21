/* -.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.
 * File Name   : index.ts
 * Created at  : 2026-06-23
 * Updated at  : 2026-06-23
 * Author      : jeefo
 * Purpose     :
 * Description :
.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.*/
import {ApolloServer} from "@apollo/server";
import {startStandaloneServer} from "@apollo/server/standalone";
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

  const {url} = await startStandaloneServer(server, {
    listen: {port},
    context,
  });

  console.log(`Forensic Analyst GraphQL API ready at ${url}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
