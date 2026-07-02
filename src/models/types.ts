/* -.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.
 * File Name   : types.ts
 * Created at  : 2026-06-23
 * Updated at  : 2026-06-23
 * Author      : jeefo
 * Purpose     :
 * Description :
.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.*/
import type {
  AlertSeverity,
  CasePriority,
  CaseStatus,
  EvidenceSourceType,
  FlagStatus,
  LinkConfidence,
  RiskLevel,
  SuspectLinkType,
  SuspectStatus,
} from "./enums";

// Row shapes ported from the C# Models/*.cs entities. Dates are stored and
// returned as ISO-8601 strings (SQLite has no native date type); decimals as
// JS numbers. camelCase is used end-to-end (DB column = TS key = GQL field).

export interface Suspect {
  id           : number;
  suspectId    : string;
  fullName     : string;
  aliases      : string | null;
  nationalId   : string | null;
  passportNumber : string | null;
  dateOfBirth  : string | null;
  gender       : string | null;
  address      : string | null;
  city         : string | null;
  country      : string | null;
  primaryPhone : string | null;
  email        : string | null;
  occupation   : string | null;
  organization : string | null;
  riskLevel    : RiskLevel;
  notes        : string | null;
  photoPath    : string | null;
  photoData    : string | null;
  status       : SuspectStatus;
  createdAt    : string;
  updatedAt    : string;
  caseId       : string | null;
}

export interface SuspectTag {
  id        : number;
  suspectId : number;
  tag       : string;
  color     : string;
}

export interface SuspectLink {
  id                      : number;
  sourceSuspectId         : number;
  targetSuspectId         : number;
  linkType                : SuspectLinkType;
  description             : string | null;
  strength                : number;
  totalFinancialValue     : number | null;
  totalCallCount          : number | null;
  totalCallDurationSeconds : number | null;
  firstContact            : string | null;
  lastContact             : string | null;
  createdAt               : string;
  confidenceLevel         : LinkConfidence;
}

export interface BankAccount {
  id                : number;
  accountNumber     : string;
  bankName          : string | null;
  branchCode        : string | null;
  iban              : string | null;
  accountType       : string;
  currency          : string;
  currentBalance    : number;
  status            : string;
  suspectId         : number | null;
  accountHolderName : string | null;
  createdAt         : string;
}

export interface BankTransaction {
  id                  : number;
  bankAccountId       : number;
  timestamp           : string;
  amount              : number;
  type                : string;
  category            : string | null;
  description         : string | null;
  referenceNumber     : string | null;
  counterpartyAccount : string | null;
  counterpartyName    : string | null;
  channel             : string | null;
  location            : string | null;
  runningBalance      : number;
  currency               : string;
  flagStatus          : FlagStatus;
}

export interface PhoneNumber {
  id             : number;
  number         : string;
  provider       : string | null;
  imei           : string | null;
  imsi           : string | null;
  phoneType      : string;
  status         : string;
  suspectId      : number | null;
  subscriberName : string | null;
  activationDate : string | null;
}

export interface CallRecord {
  id            : number;
  callerNumber  : string;
  calledNumber  : string;
  startTime     : string;
  durationSeconds : number;
  callType      : string;
  direction     : string;
  cellTower     : string | null;
  location      : string | null;
  latitude      : number | null;
  longitude     : number | null;
  imei          : string | null;
  imsi          : string | null;
  flagStatus    : string | null;
  phoneNumberId : number | null;
  suspectId     : number | null;
}

export interface CaseFile {
  id               : number;
  caseId           : string;
  caseName         : string;
  description      : string | null;
  status           : CaseStatus;
  priority         : CasePriority;
  leadInvestigator : string | null;
  caseType         : string | null;
  createdAt        : string;
  updatedAt        : string;
  closedAt         : string | null;
}

export interface CaseNote {
  id         : number;
  caseFileId : number | null;
  suspectId  : number | null;
  content    : string;
  noteType   : string;
  author     : string | null;
  createdAt  : string;
  isPinned   : boolean;
}

export interface AnalysisResult {
  id                     : number;
  bankAccountId          : number;
  analyzedAt             : string;
  benfordPasses          : boolean;
  benfordChiSquared      : number;
  benfordPValue          : number;
  nearThresholdCount     : number;
  nearThresholdPercentage : number;
  avgTransactionsPerDay  : number;
  maxTransactionsPerDay  : number;
  weeklyVelocityStdDev   : number;
  roundNumberCount       : number;
  roundNumberPercentage  : number;
  offHoursCount          : number;
  offHoursPercentage     : number;
  weekendPercentage      : number;
  velocityScore          : number;
  amountVarianceScore    : number;
  roundNumberScore       : number;
  offHoursScore          : number;
  nearThresholdScore     : number;
  categoryDiversityScore : number;
  overallRisk            : number;
  riskLevel              : RiskLevel;
  verdict                : string | null;
}

export interface TimelineEvent {
  id                : number;
  timestamp         : string;
  eventType         : string;
  description       : string;
  suspectId         : number | null;
  relatedEntityType : string | null;
  relatedEntityId   : number | null;
  amount            : number | null;
  severity          : AlertSeverity | null;
  iconGlyph         : string;
}

export interface ChartEntity {
  id                 : number;
  entityId           : string;
  entityType         : string;
  label              : string;
  description        : string | null;
  iconType           : string | null;
  x                  : number;
  y                  : number;
  attributes         : string | null;
  sourceType         : string | null;
  sourceId           : number | null;
  gradeOfInformation : string | null;
  isPinned           : boolean;
  isHidden           : boolean;
  createdAt          : string;
}

export interface ChartLink {
  id              : number;
  sourceEntityId  : number;
  targetEntityId  : number;
  linkType        : string;
  label           : string | null;
  description     : string | null;
  weight          : number;
  isDirectional   : boolean;
  isDashed        : boolean;
  dateFrom        : string | null;
  dateTo          : string | null;
  confidenceLevel : string | null;
  financialValue  : number | null;
  eventCount      : number | null;
  createdAt       : string;
}

export interface ChartEvent {
  id              : number;
  timestamp       : string;
  endTime         : string | null;
  eventType       : string;
  title           : string;
  description     : string | null;
  severity        : string;
  linkedEntityIds : string | null;
  amount          : number | null;
  location        : string | null;
  createdAt       : string;
}

export interface AuditEvent {
  id           : number;
  timestampUtc : string;
  actor        : string;
  action       : string;
  target       : string | null;
  detail       : string | null;
  severity     : AlertSeverity;
  toolVersion  : string | null;
  chainHash    : string | null;
}

export interface EvidenceEntry {
  id            : number;
  caseFileId    : number;
  exhibitNumber : number;
  sourceType    : EvidenceSourceType;
  sourceId      : number;
  description   : string | null;
  severity      : AlertSeverity;
  taggedBy      : string;
  taggedAtUtc   : string;
}

export interface SanctionsRefreshLog {
  id           : number;
  fetchedAtUtc : string;
  sourceUrl    : string;
  sha256Hex    : string;
  byteCount    : number;
  entryCount   : number;
  success      : boolean;
  note         : string | null;
}

export interface AccessLogEntry {
  id              : number;
  timestamp       : string;
  accountOrUserId : string;
  fullName        : string | null;
  ipAddress       : string | null;
  deviceUuid      : string | null;
  fingerprint     : string | null;
  userAgent       : string | null;
  deviceModel     : string | null;
  deviceMake      : string | null;
  os              : string | null;
  osVersion       : string | null;
  source          : string;
  suspectId       : number | null;
}
