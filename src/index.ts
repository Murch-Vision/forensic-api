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

async function main(): Promise<void> {
  const server = new ApolloServer<GraphQLContext>({typeDefs, resolvers});
  const port = Number(process.env.PORT || 4000);

  const data = new DataService(db);
  const audit = new AuditLogService(db);
  const sanctions = new SanctionsService();
  const geo = new GeospatialService();
  const settings = new SettingsService();
  const session = new CaseSessionService(db);
  const i18n = new LocalizationService();
  const telemetry = new TelemetryService(settings);
  const context = async (): Promise<GraphQLContext> => ({
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
    session,
    anb      : new AnbService(db),
    i18n,
    telemetry,
  });

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
