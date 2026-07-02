/* -.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.
 * File Name   : schema.ts
 * Created at  : 2026-06-23
 * Updated at  : 2026-06-23
 * Author      : jeefo
 * Purpose     :
 * Description :
.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.*/

// GraphQL SDL for the forensic platform. Enums mirror Models/DomainEnums.cs
// (canonical UPPERCASE form); object types mirror Models/*.cs. Dates are
// ISO-8601 strings. Suspect operations are fully resolved (vertical slice);
// the remaining types are declared so the schema is complete end-to-end.

export const typeDefs = /* GraphQL */ `
  enum RiskLevel { UNKNOWN LOW MEDIUM HIGH CRITICAL }
  enum SuspectStatus { UNKNOWN ACTIVE UNDER_INVESTIGATION CLOSED CLEARED }
  enum CaseStatus { UNKNOWN OPEN ACTIVE CLOSED ARCHIVED }
  enum CasePriority { UNKNOWN LOW MEDIUM HIGH CRITICAL }
  enum FlagStatus { UNKNOWN NORMAL SUSPICIOUS FLAGGED }
  enum SuspectLinkType {
    UNKNOWN FINANCIAL_TRANSFER PHONE_CONTACT SHARED_ADDRESS
    SHARED_DEVICE SHARED_IP MANUAL
  }
  enum LinkConfidence { UNKNOWN LOW MEDIUM HIGH }
  enum AlertSeverity { UNKNOWN INFO LOW MEDIUM HIGH CRITICAL }
  enum EvidenceSourceType {
    UNKNOWN TRANSACTION SUSPECT CALL_RECORD BANK_ACCOUNT
    PHONE_NUMBER SUSPECT_LINK
  }

  type Suspect {
    id: Int!
    suspectId: String!
    fullName: String!
    aliases: String
    nationalId: String
    passportNumber: String
    dateOfBirth: String
    gender: String
    address: String
    city: String
    country: String
    primaryPhone: String
    email: String
    occupation: String
    organization: String
    riskLevel: RiskLevel!
    notes: String
    photoPath: String
    photoData: String
    status: SuspectStatus!
    createdAt: String!
    updatedAt: String!
    caseId: String

    "Computed [NotMapped] members from the C# Suspect model."
    initials: String!
    age: Int!

    "Eager-loaded relations (EF .Include())."
    bankAccounts: [BankAccount!]!
    phoneNumbers: [PhoneNumber!]!
    tags: [SuspectTag!]!
    caseNotes: [CaseNote!]!
    links: [SuspectLink!]!
    recordCounts: SuspectRecordCounts!
  }

  type SuspectRecordCounts {
    transactionCount: Int!
    callRecordCount: Int!
  }

  type SuspectTag {
    id: Int!
    suspectId: Int!
    tag: String!
    color: String!
  }

  type SuspectLink {
    id: Int!
    sourceSuspectId: Int!
    targetSuspectId: Int!
    linkType: SuspectLinkType!
    description: String
    strength: Int!
    totalFinancialValue: Float
    totalCallCount: Int
    totalCallDurationSeconds: Int
    firstContact: String
    lastContact: String
    createdAt: String!
    confidenceLevel: LinkConfidence!
  }

  type BankAccount {
    id: Int!
    accountNumber: String!
    bankName: String
    branchCode: String
    iban: String
    accountType: String!
    currency: String!
    currentBalance: Float!
    status: String!
    suspectId: Int
    accountHolderName: String
    createdAt: String!
    "Computed: masked account number for display."
    maskedNumber: String!
  }

  type BankTransaction {
    id: Int!
    bankAccountId: Int!
    timestamp: String!
    amount: Float!
    type: String!
    category: String
    description: String
    referenceNumber: String
    counterpartyAccount: String
    counterpartyName: String
    channel: String
    location: String
    runningBalance: Float!
    flagStatus: FlagStatus!
  }

  type PhoneNumber {
    id: Int!
    number: String!
    provider: String
    imei: String
    imsi: String
    phoneType: String!
    status: String!
    suspectId: Int
    subscriberName: String
    activationDate: String
  }

  type CallRecord {
    id: Int!
    callerNumber: String!
    calledNumber: String!
    startTime: String!
    durationSeconds: Int!
    callType: String!
    direction: String!
    cellTower: String
    location: String
    latitude: Float
    longitude: Float
    imei: String
    imsi: String
    flagStatus: String
    phoneNumberId: Int
    suspectId: Int
  }

  type CaseFile {
    id: Int!
    caseId: String!
    caseName: String!
    description: String
    status: CaseStatus!
    priority: CasePriority!
    leadInvestigator: String
    caseType: String
    createdAt: String!
    updatedAt: String!
    closedAt: String
  }

  "One case a global person is tied to (via a SUSPECT evidence entry)."
  type PersonCaseRef {
    caseFile: CaseFile!
    suspectId: Int!
    exhibitNumber: Int!
    severity: AlertSeverity!
    taggedAtUtc: String!
  }

  "A human being across every case: suspect records grouped by identity."
  type GlobalPerson {
    key: String!
    fullName: String!
    aliases: [String!]!
    riskLevel: RiskLevel!
    photoData: String
    occupation: String
    nationalId: String
    "Why records were grouped: NAME | PHONE | NATIONAL_ID."
    matchedBy: [String!]!
    suspects: [Suspect!]!
    cases: [PersonCaseRef!]!
    phoneNumbers: [String!]!
    accountNumbers: [String!]!
    transactionCount: Int!
    callRecordCount: Int!
  }

  type CaseNote {
    id: Int!
    caseFileId: Int
    suspectId: Int
    content: String!
    noteType: String!
    author: String
    createdAt: String!
    isPinned: Boolean!
  }

  type AccessLogEntry {
    id: Int!
    timestamp: String!
    accountOrUserId: String!
    fullName: String
    ipAddress: String
    deviceUuid: String
    fingerprint: String
    userAgent: String
    deviceModel: String
    deviceMake: String
    os: String
    osVersion: String
    source: String!
    suspectId: Int
  }

  type EvidenceEntry {
    id: Int!
    caseFileId: Int!
    exhibitNumber: Int!
    sourceType: EvidenceSourceType!
    sourceId: Int!
    description: String
    severity: AlertSeverity!
    taggedBy: String!
    taggedAtUtc: String!
  }

  type DashboardStats {
    totalSuspects: Int!
    activeSuspects: Int!
    totalBankAccounts: Int!
    totalTransactions: Int!
    totalPhoneNumbers: Int!
    totalCallRecords: Int!
    totalLinks: Int!
    openCases: Int!
    highRiskSuspects: Int!
    flaggedTransactions: Int!
    earliestTransaction: String
    latestTransaction: String
    totalTransactionVolume: Float!
    earliestCall: String
    latestCall: String
  }

  type AnalysisResult {
    id: Int!
    bankAccountId: Int!
    analyzedAt: String!
    benfordPasses: Boolean!
    benfordChiSquared: Float!
    benfordPValue: Float!
    nearThresholdCount: Int!
    nearThresholdPercentage: Float!
    avgTransactionsPerDay: Float!
    maxTransactionsPerDay: Int!
    weeklyVelocityStdDev: Float!
    roundNumberCount: Int!
    roundNumberPercentage: Float!
    offHoursCount: Int!
    offHoursPercentage: Float!
    weekendPercentage: Float!
    velocityScore: Float!
    amountVarianceScore: Float!
    roundNumberScore: Float!
    offHoursScore: Float!
    nearThresholdScore: Float!
    categoryDiversityScore: Float!
    overallRisk: Float!
    riskLevel: RiskLevel!
    verdict: String
  }

  type AuditEvent {
    id: Int!
    timestampUtc: String!
    actor: String!
    action: String!
    target: String
    detail: String
    severity: AlertSeverity!
    toolVersion: String
    chainHash: String
  }

  type PatternAlert {
    alertType: String!
    severity: String!
    description: String!
    timestamp: String!
    relatedAccountId: Int
  }

  type CorrelationHit {
    suspectId: Int!
    suspectName: String!
    date: String!
    transactionTime: String!
    transactionAmount: Float!
    transactionType: String!
    transactionDescription: String
    callTime: String!
    callerNumber: String!
    calledNumber: String!
    callDuration: Int!
    timeDifferenceMinutes: Float!
    severity: String!
  }

  type RuleViolation {
    ruleId: Int!
    ruleName: String!
    severity: String!
    description: String!
    score: Float!
    timestamp: String
  }

  type RuleEngineResult {
    bankAccountId: Int!
    violations: [RuleViolation!]!
    baseScore: Float!
    ruleBoost: Float!
    finalScore: Float!
    criticalFlags: Int!
    highFlags: Int!
    finalAction: String!
    finalRisk: String!
    modelScore: Float
    modelAction: String!
  }

  type RecipientInfo {
    account: String!
    name: String!
    totalAmount: Float!
    count: Int!
  }
  type CategoryInfo { category: String! count: Int! totalAmount: Float! }
  type ChannelInfo { channel: String! count: Int! totalAmount: Float! }
  type MonthlyTrend {
    label: String!
    credits: Float!
    debits: Float!
    count: Int!
  }

  type AccountStatistics {
    bankAccountId: Int!
    totalTransactions: Int!
    totalAmount: Float!
    averageAmount: Float!
    medianAmount: Float!
    maxAmount: Float!
    minAmount: Float!
    stdDeviation: Float!
    totalDebits: Float!
    totalCredits: Float!
    debitCount: Int!
    creditCount: Int!
    debitCreditRatio: Float!
    netFlow: Float!
    peakHour: Int!
    peakDay: String!
    hourlyDistribution: [Int!]!
    dayOfWeekDistribution: [Int!]!
    topRecipients: [RecipientInfo!]!
    categoryBreakdown: [CategoryInfo!]!
    channelBreakdown: [ChannelInfo!]!
    monthlyTrends: [MonthlyTrend!]!
  }

  type NetworkFlowData {
    nodeLabels: [String!]!
    nodeColors: [String!]!
    sourceIndices: [Int!]!
    targetIndices: [Int!]!
    values: [Float!]!
    linkColors: [String!]!
  }

  type SuspectLocation {
    suspectId: Int!
    fullName: String!
    displayName: String!
    lat: Float!
    lng: Float!
    resolvedFrom: String!
  }

  type AmlConfig {
    cashReportingThreshold: Float!
    nearThresholdRangeLow: Float!
    nearThresholdRangeHigh: Float!
    roundNumberMinAmount: Float!
    roundNumberModulus: Float!
    nightHoursStart: Int!
    nightHoursEnd: Int!
    highValueTxnFloor: Float!
    muleDailyInflowMin: Float!
    muleOutflowRatio: Float!
    smurfingUnitMax: Float!
    smurfingDailyTotalMin: Float!
    currencySymbol: String!
    currencyFormat: String!
  }

  type TrainSummary {
    examples: Int!
    features: Int!
    auc: Float!
    epochs: Int!
  }

  enum ImportKind { AUTO BANK CDR ACCESS_LOG }

  type ColumnMap {
    field: String!
    column: String!
  }

  type ImportPreview {
    headers: [String!]!
    sampleRows: [[String]!]!
    totalRows: Int!
    detectedProfile: String
    domain: String
    confidence: String!
    mapping: [ColumnMap!]!
  }

  type ImportSummary {
    totalRows: Int!
    importedRows: Int!
    skippedRows: Int!
    errors: [String!]!
    messages: [String!]!
    detectedProfile: String
    domain: String
  }

  type ReportFile {
    filename: String!
    mimeType: String!
    base64: String!
  }

  type SanctionsEntry {
    id: String!
    schema: String!
    caption: String!
    names: [String!]!
    aliases: [String!]!
    country: String
    programs: [String!]!
    birthDate: String
  }

  type SanctionsHit {
    entry: SanctionsEntry!
    score: Float!
    reason: String!
  }

  type SanctionsStatus {
    loaded: Boolean!
    entryCount: Int!
    loadedFrom: String
  }

  type SanctionsRefreshLog {
    id: Int!
    fetchedAtUtc: String!
    sourceUrl: String!
    sha256Hex: String!
    byteCount: Int!
    entryCount: Int!
    success: Boolean!
    note: String
  }

  type AuditChainVerdict {
    valid: Boolean!
    brokenAt: Int
  }

  type OsintSettings {
    autoRefreshEnabled: Boolean!
    refreshUrl: String!
    intervalHours: Int!
  }

  type FawSettings {
    schemaVersion: Int!
    language: String!
    theme: String!
    auditRetentionDays: Int!
    telemetryEnabled: Boolean!
    aml: AmlConfig!
    osint: OsintSettings!
  }

  input AmlConfigInput {
    cashReportingThreshold: Float!
    nearThresholdRangeLow: Float!
    nearThresholdRangeHigh: Float!
    roundNumberMinAmount: Float!
    roundNumberModulus: Float!
    nightHoursStart: Int!
    nightHoursEnd: Int!
    highValueTxnFloor: Float!
    muleDailyInflowMin: Float!
    muleOutflowRatio: Float!
    smurfingUnitMax: Float!
    smurfingDailyTotalMin: Float!
    currencySymbol: String!
    currencyFormat: String!
  }

  input OsintSettingsInput {
    autoRefreshEnabled: Boolean!
    refreshUrl: String!
    intervalHours: Int!
  }

  input SettingsInput {
    language: String!
    theme: String!
    auditRetentionDays: Int!
    telemetryEnabled: Boolean!
    aml: AmlConfigInput!
    osint: OsintSettingsInput!
  }

  type AssociationCell {
    rowEntityId: String!
    colEntityId: String!
    rowLabel: String!
    colLabel: String!
    linkCount: Int!
    totalFinancialValue: Float!
    totalCallCount: Int!
    totalCallDuration: Int!
    strongestLinkType: String!
    strength: Float!
  }

  type AnbGenResult {
    entities: Int!
    links: Int!
  }

  type ChartEntity {
    id: Int!
    entityId: String!
    entityType: String!
    label: String!
    description: String
    x: Float!
    y: Float!
    attributes: String
    sourceType: String
    sourceId: Int
    gradeOfInformation: String
  }

  type ChartLink {
    id: Int!
    sourceEntityId: Int!
    targetEntityId: Int!
    linkType: String!
    label: String
    weight: Float!
    isDirectional: Boolean!
    isDashed: Boolean!
    financialValue: Float
    eventCount: Int
  }

  type ChartEvent {
    id: Int!
    timestamp: String!
    eventType: String!
    title: String!
    description: String
    severity: String!
    amount: Float
    location: String
  }

  type AnbExport {
    entitiesCsv: String!
    linksCsv: String!
    anx: String!
  }

  type TransactionDrillDown {
    target: BankTransaction
    relatedWindow: [BankTransaction!]!
    ruleResult: RuleEngineResult!
  }

  type DwellZone {
    lat: Float!
    lng: Float!
    hits: Int!
    displayName: String!
    hoursDistribution: [Int!]!
  }

  type LocationDensity {
    lat: Float!
    lng: Float!
    count: Int!
    displayName: String!
  }

  type WorkflowAnalysis {
    riskLevel: RiskLevel!
    overallRisk: Float!
    verdict: String
    benfordPasses: Boolean!
    benfordChiSquared: Float!
    avgTransactionsPerDay: Float!
    maxTransactionsPerDay: Int!
    nearThresholdPercentage: Float!
    roundNumberPercentage: Float!
    offHoursPercentage: Float!
    weekendPercentage: Float!
    velocityScore: Float!
    amountVarianceScore: Float!
    roundNumberScore: Float!
    offHoursScore: Float!
    nearThresholdScore: Float!
    categoryDiversityScore: Float!
  }

  type WorkflowResult {
    bankAccountId: Int!
    accountName: String!
    analysis: WorkflowAnalysis!
    ruleResult: RuleEngineResult!
    benfordObserved: [Float!]!
  }

  type LocaleEntry {
    key: String!
    value: String!
  }

  type TelemetryCount {
    kind: String!
    count: Int!
  }

  type TravelHit {
    suspectId: Int!
    suspectName: String!
    eventTime: String!
    transactionAmount: Float!
    transactionType: String!
    transactionLocation: String!
    callNumber: String!
    callLocation: String!
    timeDifferenceMinutes: Float!
  }

  input ColumnMapInput {
    field: String!
    column: String!
  }

  input BankAccountInput {
    accountNumber: String!
    bankName: String
    accountType: String
    currency: String
    currentBalance: Float
    status: String
    suspectId: Int
    accountHolderName: String
  }

  input PhoneNumberInput {
    number: String!
    provider: String
    phoneType: String
    status: String
    suspectId: Int
    subscriberName: String
  }

  input CaseFileInput {
    caseId: String!
    caseName: String!
    description: String
    status: CaseStatus
    priority: CasePriority
    leadInvestigator: String
    caseType: String
  }

  input CaseFileUpdateInput {
    caseName: String!
    description: String
    priority: CasePriority
    leadInvestigator: String
  }

  input CaseNoteInput {
    caseFileId: Int
    suspectId: Int
    content: String!
    noteType: String
    author: String
  }

  input SuspectInput {
    fullName: String!
    aliases: String
    nationalId: String
    passportNumber: String
    dateOfBirth: String
    gender: String
    address: String
    city: String
    country: String
    primaryPhone: String
    email: String
    occupation: String
    organization: String
    riskLevel: RiskLevel
    notes: String
    photoData: String
    status: SuspectStatus
  }

  type Query {
    suspects: [Suspect!]!
    suspect(id: Int!): Suspect
    dashboardStats: DashboardStats!
    bankAccounts: [BankAccount!]!
    transactions: [BankTransaction!]!
    callRecords: [CallRecord!]!
    suspectLinks: [SuspectLink!]!
    caseFiles: [CaseFile!]!
    globalPeople: [GlobalPerson!]!
    analysisResults: [AnalysisResult!]!
    auditEvents(limit: Int): [AuditEvent!]!
    accessLogEntries(suspectId: Int): [AccessLogEntry!]!
    patterns: [PatternAlert!]!
    correlations(suspectId: Int): [CorrelationHit!]!
    accountStatistics(bankAccountId: Int!): AccountStatistics!
    ruleEngine(bankAccountId: Int!): RuleEngineResult!
    networkFlow: NetworkFlowData!
    suspectLocations: [SuspectLocation!]!
    benfordObserved(bankAccountId: Int!): [Float!]!
    amlConfig: AmlConfig!
    previewImport(content: String!, filename: String, sheetName: String): ImportPreview!
    excelSheets(content: String!, filename: String!): [String!]!
    reportPdf: ReportFile!
    reportExcel: ReportFile!
    reportWord: ReportFile!
    screenSuspect(id: Int!): [SanctionsHit!]!
    sanctionsStatus: SanctionsStatus!
    sanctionsRefreshLogs(take: Int): [SanctionsRefreshLog!]!
    auditVerify: AuditChainVerdict!
    evidenceForCase(caseFileId: Int!): [EvidenceEntry!]!
    settings: FawSettings!
    travelCorrelations(suspectId: Int, hourWindow: Float): [TravelHit!]!
    activeCase: CaseFile
    pinnedSuspectIds: [Int!]!
    associationMatrix: [AssociationCell!]!
    chartEntities: [ChartEntity!]!
    chartLinks: [ChartLink!]!
    chartEvents: [ChartEvent!]!
    localeStrings(language: String): [LocaleEntry!]!
    telemetrySnapshot: [TelemetryCount!]!
    transactionDrillDown(transactionId: Int!): TransactionDrillDown!
    reportBundle: ReportFile!
    anbExport: AnbExport!
    dwellZones(suspectId: Int!): [DwellZone!]!
    locationDensity(windowDays: Int): [LocationDensity!]!
    fraudWorkflow: [WorkflowResult!]!
    auditSearch(
      fromUtc: String
      toUtc: String
      actor: String
      action: String
      take: Int
    ): [AuditEvent!]!
  }

  type Mutation {
    createSuspect(input: SuspectInput!): Suspect!
    updateSuspect(id: Int!, input: SuspectInput!): Suspect!
    deleteSuspect(id: Int!): Boolean!
    generateLinks: [SuspectLink!]!
    runAccountAnalysis(bankAccountId: Int!): AnalysisResult!
    setAmlJurisdiction(jurisdiction: String!): AmlConfig!
    importData(
      content: String!
      kind: ImportKind!
      bankAccountId: Int
      filename: String
      sheetName: String
      subjectSuspectId: Int
      mapping: [ColumnMapInput!]
    ): ImportSummary!
    tagEvidence(
      caseFileId: Int!
      sourceType: EvidenceSourceType!
      sourceId: Int!
      description: String
      severity: AlertSeverity
    ): EvidenceEntry!
    untagEvidence(id: Int!): Boolean!
    refreshSanctions(url: String): SanctionsRefreshLog!
    updateSettings(input: SettingsInput!): FawSettings!
    setActiveCase(caseFileId: Int): CaseFile
    togglePin(suspectId: Int!): [Int!]!
    generateAnbChart: AnbGenResult!
    createBankAccount(input: BankAccountInput!): BankAccount!
    createPhoneNumber(input: PhoneNumberInput!): PhoneNumber!
    createCaseFile(input: CaseFileInput!): CaseFile!
    updateCaseFile(caseFileId: Int!, input: CaseFileUpdateInput!): CaseFile!
    setCaseStatus(caseFileId: Int!, status: CaseStatus!): CaseFile!
    mergeCases(sourceCaseFileIds: [Int!]!, targetCaseFileId: Int!): CaseFile!
    addCaseNote(input: CaseNoteInput!): Int!
    clearAllData: Boolean!
  }
`;
