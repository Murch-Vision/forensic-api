/* -.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.
 * File Name   : schema.ts
 * Created at  : 2026-06-23
 * Updated at  : 2026-08-07
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
    # Ids of the transactions backing a FINANCIAL_TRANSFER link, so the client
    # can re-total the connection under the active noise filter. [] otherwise.
    contributingTxnIds: [Int!]!
    # The saved board a MANUAL connection belongs to (null = default/unsaved
    # view). Null for auto-generated evidence links.
    caseGraphId: Int
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
  }

  """
  Нэг данс, дээр нь хэдэн мөр өгөгдөл байгаа нь. Буруу оруулсан хуулгыг
  дансаар нь буцааж устгахын өмнө юу алга болохыг харуулна. Тоо нь ЦЭВЭР
  бодит мөрийн тоо: чухал биш гэж хассан мөрүүд ч хамт устана.
  """
  type AccountRecord {
    id: Int!
    accountNumber: String!
    bankName: String
    ownerName: String
    txnCount: Int!
    firstTxn: String
    lastTxn: String
    createdAt: String!
  }

  "Устгасны дараа яг хэдэн мөр устсаныг мэдээлнэ."
  type AccountDeletion {
    accountNumber: String!
    transactions: Int!
    analyses: Int!
    conclusions: Int!
    evidence: Int!
    links: Int!
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
    currency: String!
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
    "The detective who owns this case (null for legacy cases)."
    ownerUserId: Int
  }

  """
  Харьцаа — one counterparty of the case's imported statement accounts, with
  everything that moved between them. Credit/debit are seen from OUR account:
  credit = орлого (in), debit = зарлага (out).
  """
  type CaseRelation {
    key: String!
    name: String!
    account: String
    nationalId: String
    txnCount: Int!
    creditCount: Int!
    debitCount: Int!
    creditTotal: Float!
    debitTotal: Float!
    "creditTotal − debitTotal."
    netTotal: Float!
    "Which imported statement accounts this counterparty appears on."
    accountIds: [Int!]!
    "Дундын харьцаа — appears on two or more of our statement accounts."
    mutual: Boolean!
    """
    Үнэлгээ — "Их давтамж, их дүн" / "Их давтамж" / "Их дүн" / "Ердийн", from the
    AML high-value floor. Only set inside an account analysis; null elsewhere.
    """
    rating: String
    "Registration number matches a subject on the case's subject list."
    subjectMatch: Boolean!
  }

  "One imported statement account with its own counterparty list."
  type AccountRelations {
    accountId: Int!
    label: String!
    ownerName: String
    accountNumber: String!
    txnCount: Int!
    relationCount: Int!
    "Counterparties on this account that other statement accounts also deal with."
    mutualCount: Int!
    creditCount: Int!
    debitCount: Int!
    creditTotal: Float!
    debitTotal: Float!
    netTotal: Float!
    relations: [CaseRelation!]!
  }

  """
  The active case's counterparty picture. Totals count exactly the transactions
  the analyst still has in the case — rows removed as noise are excluded here
  too, so these figures match the transaction list.
  """
  type CaseRelationSummary {
    "Accounts a statement was actually imported for (i.e. that have rows)."
    statementAccounts: Int!
    totalRelations: Int!
    mutualRelations: Int!
    txnCount: Int!
    creditCount: Int!
    debitCount: Int!
    creditTotal: Float!
    debitTotal: Float!
    netTotal: Float!
    """
    Transactions whose statement row names no counterparty at all (banks write
    "-" into every column they have nothing for). Counted in the totals above,
    but they can never appear in the list below.
    """
    unnamedTxnCount: Int!
    "Every counterparty, most transactions first."
    relations: [CaseRelation!]!
    byAccount: [AccountRelations!]!
  }

  "One bucket of activity: an hour, a weekday, or a calendar month."
  type ActivityBucket {
    "0-23, 0-6 (Sun-first), or YYYY-MM."
    key: String!
    label: String!
    count: Int!
    creditCount: Int!
    debitCount: Int!
    creditTotal: Float!
    debitTotal: Float!
  }

  """
  Дансны дүн шинжилгээ — one imported statement account. Same scoped,
  noise-filtered rows the transaction list shows, so the report and the screen
  cannot disagree.
  """
  type AccountAnalysis {
    accountId: Int!
    label: String!
    accountNumber: String!
    ownerName: String
    txnCount: Int!
    counterpartyCount: Int!
    creditCount: Int!
    debitCount: Int!
    creditTotal: Float!
    debitTotal: Float!
    netTotal: Float!
    """
    Шөнийн гүйлгээ, counted with the department's configured night window
    (AML nightHoursStart–nightHoursEnd). Zero when hasTimeOfDay is false.
    """
    nightCount: Int!
    nightTotal: Float!
    firstTxn: String
    lastTxn: String
    """
    False when the imported statement carried no clock (every row midnight).
    byHour, nightCount and peakHour are then empty and must NOT be shown — an
    hourly chart from date-only rows is a single bar at 00:00, and a night count
    would read as "every transaction happened at night".
    """
    hasTimeOfDay: Boolean!
    byHour: [ActivityBucket!]!
    byWeekday: [ActivityBucket!]!
    byMonth: [ActivityBucket!]!
    "Busiest bucket by transaction count — fills the report's Тайлбар sentence."
    peakHour: String
    peakWeekday: String
    peakMonth: String
    "Counterparties of THIS account, most transactions first (default top 30)."
    topCounterparties: [CaseRelation!]!
  }

  """
  Хоорондоо харилцсан шууд гүйлгээ — money between two accounts we hold
  statements for, evidenced by the counterparty account number on the row.
  """
  type DirectTransfer {
    fromAccountId: Int!
    toAccountId: Int!
    fromLabel: String!
    toLabel: String!
    txnCount: Int!
    total: Float!
    byMonth: [ActivityBucket!]!
  }

  """
  Дүгнэлт — the examiner's written conclusion. bankAccountId null = the
  link-analysis conclusion, which belongs to the case rather than one account.
  The program never writes this text.
  """
  type CaseConclusion {
    id: Int!
    caseFileId: Int!
    bankAccountId: Int
    text: String!
    updatedAt: String!
    updatedByUserId: Int
  }

  "A login account. ADMIN = department boss; DETECTIVE = scoped analyst."
  type User {
    id: Int!
    username: String!
    "Цол — rank/title, kept apart from the name so it can be listed on its own."
    rank: String
    fullName: String
    role: String!
    active: Boolean!
    "True when this account is locked to a device (detectives only)."
    deviceBound: Boolean!
    "Cases this account owns. They transfer to the admin if it is deleted."
    ownedCaseCount: Int!
  }

  "Returned by login: the bearer token plus the account it belongs to."
  type AuthPayload {
    token: String!
    user: User!
  }

  input CreateUserInput {
    username: String!
    password: String!
    rank: String
    fullName: String
    role: String
  }

  "Every field is optional: only the ones sent are written."
  input UpdateUserInput {
    username: String
    rank: String
    fullName: String
    role: String
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
    "Data rows this range yields, blank ones already dropped."
    totalRows: Int!
    detectedProfile: String
    domain: String
    confidence: String!
    mapping: [ColumnMap!]!
    """
    The rows this preview was read from, numbered as the spreadsheet numbers
    them (1-based, blank rows counted). Detected when the caller passed none,
    so the screen can show its guess and let the analyst correct it.
    """
    headerRow: Int!
    firstDataRow: Int!
    "Defaults to the last row holding data — files carry blank rows after it."
    lastDataRow: Int!
    "Rows in the sheet, for bounding what may be picked."
    sheetRows: Int!
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

  type SampleDataResult {
    enrichedCalls: Int!
    networkCalls: Int!
    phonesEnsured: Int!
    linksCreated: Int!
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

  "A saved connection-graph board (a named snapshot of the whole link chart)."
  type CaseGraph {
    id: Int!
    name: String!
    "JSON snapshot: visible edge kinds, noise floor, hidden nodes, layout."
    state: String!
    createdAt: String!
    updatedAt: String!
  }

  "One description-pattern noise rule."
  type DescRule {
    mode: String!
    text: String!
  }

  "The analyst's permanent 'unimportant data' decisions for the active case."
  type NoiseFilter {
    minAmount: Float!
    ignoredPairs: [String!]!
    ignoredTxns: [Int!]!
    descRules: [DescRule!]!
  }

  input DescRuleInput {
    mode: String!
    text: String!
  }

  input NoiseFilterInput {
    minAmount: Float!
    ignoredPairs: [String!]!
    ignoredTxns: [Int!]!
    descRules: [DescRuleInput!]!
  }

  "An analyst-drawn relationship between two suspects (family, friends, etc.)."
  input ManualLinkInput {
    sourceSuspectId: Int!
    targetSuspectId: Int!
    "Free-text relationship label, e.g. 'Гэр бүл', 'Найз', 'Мансууруулах'."
    description: String!
    confidenceLevel: LinkConfidence
    "The saved board this connection belongs to (null = default/unsaved view)."
    caseGraphId: Int
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

  "One checkout the workstation runs — backend and frontend are separate repos."
  type RepoVersion {
    name: String!
    path: String!
    version: String!
    commit: String!
    branch: String!
    "True when the checkout has uncommitted local changes."
    dirty: Boolean!
    "Commit the SERVED build was made from — null for the backend (runs from source), empty when unknown."
    builtCommit: String
    "Why the checkout could not be read (git missing, dubious ownership, not a checkout). Null when it reads fine."
    error: String
  }

  "Running build identity — shown in Settings. Top-level fields describe the backend; \`repos\` covers every checkout."
  type VersionInfo {
    version: String!
    commit: String!
    branch: String!
    repos: [RepoVersion!]!
  }

  "What a self-update did to one checkout."
  type RepoUpdate {
    name: String!
    updated: Boolean!
    "True when the pull or the build ERRORED — distinct from having nothing to do."
    failed: Boolean!
    previousCommit: String!
    newCommit: String!
    message: String!
  }

  "Live output of the update currently running — Settings polls it while the button spins."
  type UpdateLog {
    running: Boolean!
    lines: [String!]!
  }

  "Outcome of a self-update (git pull + optional restart)."
  type UpdateResult {
    updated: Boolean!
    "True when at least one checkout could not be pulled or rebuilt."
    failed: Boolean!
    previousCommit: String!
    newCommit: String!
    previousVersion: String!
    newVersion: String!
    message: String!
    restarting: Boolean!
    "Per-checkout outcome — one entry each for backend and frontend."
    repos: [RepoUpdate!]!
  }

  type Query {
    suspects: [Suspect!]!
    suspect(id: Int!): Suspect
    dashboardStats: DashboardStats!
    "Running version + git commit for the Settings page."
    appVersion: VersionInfo!
    "Live progress of the running self-update (empty when idle)."
    updateLog: UpdateLog!
    "This server's IPv4 addresses on the local network — Settings shows them with the app's port so other computers know what to open."
    lanAddresses: [String!]!
    bankAccounts: [BankAccount!]!
    """
    Идэвхтэй хэрэгт ХУУЛГА нь орсон дансууд — өөрөөр хэлбэл сэжигтний
    дансууд, мөрийн тоотойгоо, хамгийн олон мөртэй нь эхэлж. Гүйлгээгүй данс
    энд ОРОХГҮЙ: тэдгээр нь харилцагчийн баганаас үүссэн хоосон бүртгэл.
    """
    accountRecords: [AccountRecord!]!
    transactions(includeRemoved: Boolean): [BankTransaction!]!
    "Харьцаа of the active case's statement accounts, aggregated."
    caseRelations: CaseRelationSummary!
    "Per-account analysis for every statement account in the active case."
    accountAnalyses(topLimit: Int): [AccountAnalysis!]!
    "Direct transfers between the case's own statement accounts."
    directTransfers: [DirectTransfer!]!
    "Дүгнэлт written for the active case (per account + one for the links)."
    caseConclusions: [CaseConclusion!]!
    callRecords: [CallRecord!]!
    suspectLinks: [SuspectLink!]!
    caseFiles: [CaseFile!]!
    "The logged-in account (null when not authenticated)."
    me: User
    "All accounts (ADMIN only) — the boss's user-management list."
    users: [User!]!
    "Detectives granted access to a case (ADMIN only)."
    caseMembers(caseFileId: Int!): [User!]!
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
    previewImport(
      content: String!
      filename: String
      sheetName: String
      uploadId: String
      "1-based, as the spreadsheet numbers its rows. Null = detect."
      headerRow: Int
      "1-based first data row. Null = the row after the header."
      startRow: Int
      "1-based last data row, inclusive. Null = the last row holding data."
      endRow: Int
    ): ImportPreview!
    excelSheets(content: String!, filename: String!, uploadId: String): [String!]!
    reportPdf: ReportFile!
    "Per-suspect financial PDF: profile, income/outgoing totals and the transaction ledger. minAmount hides transactions below the given amount."
    reportSuspectPdf(suspectId: Int!, minAmount: Int): ReportFile!
    "Financial PDF: combined summary + a section each. Without minAmount it covers the marked suspects (status UNDER_INVESTIGATION); with minAmount it covers EVERYONE holding a transaction at/above that amount, flagged or not."
    reportMarkedSuspectsPdf(minAmount: Int): ReportFile!
    reportExcel: ReportFile!
    reportWord: ReportFile!
    """
    ДАНСНЫ ДҮН ШИНЖИЛГЭЭ — the verdict document for the active case, in the shape
    of the client's template. Figures are tables, not screenshots.
    """
    reportVerdictDocx: ReportFile!
    screenSuspect(id: Int!): [SanctionsHit!]!
    sanctionsStatus: SanctionsStatus!
    sanctionsRefreshLogs(take: Int): [SanctionsRefreshLog!]!
    auditVerify: AuditChainVerdict!
    evidenceForCase(caseFileId: Int!): [EvidenceEntry!]!
    settings: FawSettings!
    travelCorrelations(suspectId: Int, hourWindow: Float): [TravelHit!]!
    activeCase: CaseFile
    "The active case's saved noise-filter (empty defaults when none/no case)."
    caseNoiseFilter: NoiseFilter!
    "Saved connection-graph boards for the active case (newest first)."
    caseGraphs: [CaseGraph!]!
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

  "Admin → developer request, proxied into the maestro feedback inbox."
  input SupportRequestInput {
    "Алдаа | Санал"
    type: String!
    text: String!
    "Client-compressed image data URIs (data:image/…), up to 3."
    images: [String!]
    """
    Which screen the sender was on (route path). Without it every report starts
    with a round-trip asking where it happened.
    """
    page: String
    "Browser · OS · window size, for reproducing what the sender saw."
    client: String
  }

  type Mutation {
    "Pull the latest code from git; restarts the server when new commits arrive (ADMIN only)."
    selfUpdate: UpdateResult!
    createSuspect(input: SuspectInput!): Suspect!
    updateSuspect(id: Int!, input: SuspectInput!): Suspect!
    "Set (or clear, with null) ONLY a suspect's photo — leaves all other fields untouched."
    setSuspectPhoto(id: Int!, photoData: String): Suspect!
    deleteSuspect(id: Int!): Boolean!
    "Flag/unflag a person as a suspect under investigation (sets status)."
    markAsSuspect(id: Int!, marked: Boolean!): Suspect!
    generateLinks: [SuspectLink!]!
    "Draw a manual relationship connection between two suspects."
    createManualLink(input: ManualLinkInput!): SuspectLink!
    "Relabel / re-rate an existing manual connection."
    updateManualLink(
      id: Int!
      description: String!
      confidenceLevel: LinkConfidence
    ): SuspectLink!
    "Remove a manual connection by id."
    deleteManualLink(id: Int!): Boolean!
    "Persist the active case's noise-filter (unimportant-data decisions)."
    saveCaseNoiseFilter(input: NoiseFilterInput!): NoiseFilter!
    """
    Save the current connection graph as a new named board. When
    claimUnassignedLinks is true, any manual connections drawn in the default
    (no-board) view are moved into this new board — so "save current graph"
    captures the connections you drew before saving.
    """
    createCaseGraph(
      name: String!, state: String!, claimUnassignedLinks: Boolean
    ): CaseGraph!
    "Rename and/or overwrite a saved graph board."
    updateCaseGraph(id: Int!, name: String, state: String): CaseGraph!
    "Delete a saved graph board."
    deleteCaseGraph(id: Int!): Boolean!
    runAccountAnalysis(bankAccountId: Int!): AnalysisResult!
    setAmlJurisdiction(jurisdiction: String!): AmlConfig!
    importData(
      content: String!
      kind: ImportKind!
      bankAccountId: Int
      filename: String
      sheetName: String
      subjectSuspectId: Int
      subjectNumber: String
      mapping: [ColumnMapInput!]
      uploadId: String
      "Rows to read, 1-based as the spreadsheet numbers them. Null = detect."
      headerRow: Int
      startRow: Int
      endRow: Int
    ): ImportSummary!
    "Populate the active case with a lifelike demo call/device network so the analytics charts and connection graph are meaningful."
    generateSampleData: SampleDataResult!
    "Begin a chunked upload for a large import file; returns an uploadId."
    uploadStart: String!
    "Append one chunk to a chunked upload; returns the running chunk count."
    uploadAppend(uploadId: String!, chunk: String!): Int!
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
    """
    Нэг дансыг бүх гүйлгээ, шинжилгээ, дүгнэлт, баримтын холбоосынх нь хамт
    устгана — буруу оруулсан хуулгыг буцааж авах зам. Хүн (субьект) устахгүй,
    бусад дансны хуулга дээр энэ данс харилцагчаар бичигдсэн мөрүүд ч устахгүй
    (тэдгээр нь тэр дансны хуулга). Дахин импортлоход данс дахин үүснэ.
    """
    deleteBankAccount(id: Int!): AccountDeletion!
    createPhoneNumber(input: PhoneNumberInput!): PhoneNumber!
    createCaseFile(input: CaseFileInput!): CaseFile!
    updateCaseFile(caseFileId: Int!, input: CaseFileUpdateInput!): CaseFile!
    setCaseStatus(caseFileId: Int!, status: CaseStatus!): CaseFile!
    mergeCases(sourceCaseFileIds: [Int!]!, targetCaseFileId: Int!): CaseFile!
    addCaseNote(input: CaseNoteInput!): Int!

    "Authenticate and receive a bearer token. deviceId locks DETECTIVE accounts to one device."
    login(username: String!, password: String!, deviceId: String): AuthPayload!
    "Revoke the current session token."
    logout: Boolean!
    "Create a detective (or admin) account. ADMIN only."
    createUser(input: CreateUserInput!): User!
    "Edit an account's login name, rank, name or role. ADMIN only."
    updateUser(userId: Int!, input: UpdateUserInput!): User!
    """
    Delete an account for good. If it owns cases, transferToUserId must name
    their new owner — a case is never left ownerless, and never reassigned as a
    silent side effect. ADMIN only.
    """
    deleteUser(userId: Int!, transferToUserId: Int): Boolean!
    "Activate/deactivate an account — deactivating kills live sessions. ADMIN only."
    setUserActive(userId: Int!, active: Boolean!): User!
    "Set a new password for an account. ADMIN only."
    resetUserPassword(userId: Int!, password: String!): Boolean!
    "Forget a detective's bound device so they can log in from a new one. ADMIN only."
    resetUserDevice(userId: Int!): Boolean!
    """
    Store a Дүгнэлт. bankAccountId null targets the link-analysis conclusion;
    an empty text clears it and returns null.
    """
    saveCaseConclusion(bankAccountId: Int, text: String!): CaseConclusion
    "Grant a detective access to a case. ADMIN only."
    grantCaseAccess(caseFileId: Int!, userId: Int!): Boolean!
    "Revoke a detective's access to a case. ADMIN only."
    revokeCaseAccess(caseFileId: Int!, userId: Int!): Boolean!
    "Send a technical request to the developer. ADMIN only."
    sendSupportRequest(input: SupportRequestInput!): Boolean!
  }
`;
