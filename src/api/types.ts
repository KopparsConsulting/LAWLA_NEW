/**
 * Typer enligt backendens OpenAPI-spec (https://lawla.berge.tech/swagger/v1/swagger.json),
 * avstämda 2026-10-15. Fält som är nullable i specen är markerade med `| null`.
 */

export interface UserDto {
  id: number;
  email: string | null;
  name: string | null;
  role: string | null;
  isActive: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  isMember: boolean;
  isAdmin: boolean;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
  name: string;
}

/** Svar från Workerns /auth/login och /auth/register (token stannar i cookie). */
export interface SessionResponse {
  user: UserDto | null;
  message: string | null;
}

export interface FeatureStatusDto {
  ai: { enabled: boolean; ragEnabled: boolean; embeddingsEnabled: boolean; analysisEnabled: boolean };
  elasticsearch: { enabled: boolean; contentIndexingEnabled: boolean };
  tts: { enabled: boolean };
  googleAuth: { enabled: boolean };
  security: { requireLogin: boolean; allowRegistrations: boolean; autoApproveRegistrations: boolean };
  documentAnalysisEnabled: boolean;
  documentManagementEnabled: boolean;
}

/* ─── Projekt (= rättsutredningar) ───────────────────────────────────── */

/** ProjectStatus är ett heltals-enum i backend (0–3). */
export type ProjectStatus = 0 | 1 | 2 | 3;
/** EvidenceType är ett heltals-enum i backend (0–2). */
export type EvidenceType = 0 | 1 | 2;

export interface ProjectSummaryDto {
  id: number;
  title: string | null;
  description: string | null;
  status: ProjectStatus;
  isActive: boolean;
  questionCount: number;
  circumstanceCount: number;
  legalIssueCount: number;
  evidenceCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface TextItemDto {
  id: number;
  text: string | null;
  sortOrder: number;
  createdAt: string;
}

export type ProjectQuestionDto = TextItemDto;
export type ProjectCircumstanceDto = TextItemDto;
export interface ProjectLegalIssueDto extends TextItemDto {
  analysisCount: number;
}

export interface ProjectEvidenceDto {
  id: number;
  type: EvidenceType;
  documentId: number | null;
  chunkId: number | null;
  canonicalReference: string | null;
  displayLabel: string | null;
  annotation: string | null;
  createdAt: string;
}

export interface ProjectDetailDto {
  id: number;
  title: string | null;
  description: string | null;
  caseOverview: string | null;
  status: ProjectStatus;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  questions: ProjectQuestionDto[] | null;
  circumstances: ProjectCircumstanceDto[] | null;
  legalIssues: ProjectLegalIssueDto[] | null;
  evidence: ProjectEvidenceDto[] | null;
}

export interface CreateProjectRequest {
  title: string;
  description?: string | null;
}

export interface UpdateProjectRequest {
  title: string | null;
  description: string | null;
  caseOverview: string | null;
  status: ProjectStatus;
}

export interface ExpandedEvidenceDto {
  id: number;
  type: EvidenceType;
  displayLabel: string | null;
  content: string | null;
  annotation: string | null;
  documentId: number | null;
  documentTitle: string | null;
  chunkId: number | null;
  chunkIndex: number | null;
  chapter: string | null;
  paragraph: string | null;
}

export interface AddEvidenceRequest {
  documentId?: number | null;
  chunkId?: number | null;
  content?: string | null;
  displayLabel?: string | null;
  annotation?: string | null;
}

export interface ProjectAnalysisDto {
  id: number;
  createdAt: string;
  outputContent: string | null;
  inputSummary: {
    questionCount: number;
    circumstanceCount: number;
    legalIssueCount: number;
    evidenceCount: number;
  } | null;
}

export interface LegalIssueAnalysisDto {
  id: number;
  legalIssueId: number;
  outputContent: string | null;
  createdAt: string;
}

/* ─── Dokument ───────────────────────────────────────────────────────── */

export interface DocumentDto {
  id: number;
  title: string | null;
  timestamp: string;
  lastModified: string;
  source: string | null;
  sourceType: string | null;
  documentType: string | null;
  canonicalId: string | null;
  tags: string[] | null;
  hasAnalysis: boolean;
  hasEmbeddings: boolean;
  chunkCount: number;
  outgoingReferenceCount: number;
  incomingReferenceCount: number;
}

export interface DocumentStatsDto {
  totalCount: number;
  typeCounts: Record<string, number> | null;
}

export interface DocumentTocEntryDto {
  chunkId: number;
  chunkIndex: number;
  displayLabel: string | null;
}

export interface ChunkDetailDto {
  id: number;
  documentId: number;
  documentTitle: string | null;
  documentType: string | null;
  canonicalId: string | null;
  content: string | null;
  chunkIndex: number;
  structuralMetadata: Record<string, unknown> | null;
  displayLabel: string | null;
  preview: string | null;
}

export interface DocumentReferenceDto {
  id: number;
  canonicalForm: string | null;
  referenceType: string | null;
  displayText: string | null;
  citationText: string | null;
  targetDocumentId: number | null;
  targetDocumentTitle: string | null;
  isResolved: boolean;
}

export interface IncomingReferenceDto {
  id: number;
  sourceDocumentId: number;
  sourceDocumentTitle: string | null;
  referenceType: string | null;
  citationText: string | null;
  targetCanonicalForm: string | null;
}

/* ─── RAG ────────────────────────────────────────────────────────────── */

export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
  toolContext?: string | null;
}

export interface RagQueryRequest {
  question: string;
  topK?: number;
  minSimilarity?: number;
  passagesPerBook?: number;
  documentIds?: number[] | null;
  temperature?: number;
  maxResponseTokens?: number;
  conversationHistory?: ConversationMessage[] | null;
}

export interface RagSourcePassage {
  chunkId: number;
  text: string;
  similarityScore: number;
  chapter?: string | null;
  paragraph?: string | null;
  displayLabel: string;
}

export interface RagSourceDto {
  documentId: number;
  title: string;
  documentType?: string | null;
  relevanceScore: number;
  passages: RagSourcePassage[];
}

export interface RagToolEntry {
  toolName: string;
  success: boolean;
  error?: string;
  executionTimeMs: number;
  summary: string;
}

/** Händelser i SSE-strömmen från /api/Rag/query-stream (och analysströmmar). */
export interface StreamEvent {
  type: "status" | "content" | "tool" | "sources" | "analysis" | "done" | "error";
  content?: string;
  toolEntry?: RagToolEntry;
  sources?: RagSourceDto[];
  analysisContent?: string;
  analysisTitle?: string;
  followUpSuggestions?: string[];
  error?: string;
  processingTimeMs?: number;
}

/* ─── Feedback (ny endpoint i backend, se docs/BACKEND.md) ───────────── */

export interface FeedbackRequest {
  description: string;
  path: string;
  priority: "low" | "normal" | "high";
  userAgent: string;
  viewport: string;
}
