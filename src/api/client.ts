import { createSseParser } from "./sse";
import type {
  AddEvidenceRequest,
  ChunkDetailDto,
  CreateProjectRequest,
  DocumentDto,
  DocumentReferenceDto,
  DocumentStatsDto,
  DocumentTocEntryDto,
  ExpandedEvidenceDto,
  FeatureStatusDto,
  FeedbackRequest,
  IncomingReferenceDto,
  LegalIssueAnalysisDto,
  LoginRequest,
  ProjectAnalysisDto,
  ProjectDetailDto,
  ProjectEvidenceDto,
  ProjectLegalIssueDto,
  ProjectSummaryDto,
  RagQueryRequest,
  RegisterRequest,
  SessionResponse,
  StreamEvent,
  TextItemDto,
  UpdateProjectRequest,
  UserDto,
} from "./types";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Anropas när en request får 401 – AuthProvider kopplar in sig här. */
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: (() => void) | null) {
  onUnauthorized = fn;
}

async function toError(res: Response): Promise<ApiError> {
  const text = await res.text().catch(() => "");
  let message = text;
  try {
    const data = JSON.parse(text) as { error?: string; message?: string; title?: string };
    message = data.error || data.message || data.title || text;
  } catch {
    /* behåll text */
  }
  if (!message) message = res.status >= 500 ? "Servern svarar inte just nu." : `Fel ${res.status}`;
  return new ApiError(res.status, message.slice(0, 500));
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("x-lawla-request", "1");
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const res = await fetch(path, { ...init, headers, credentials: "same-origin" });
  if (res.status === 401 && !path.startsWith("/auth/")) onUnauthorized?.();
  if (!res.ok) throw await toError(res);
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

const get = <T>(path: string) => request<T>(path);
const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });
const put = <T>(path: string, body: unknown) => request<T>(path, { method: "PUT", body: JSON.stringify(body) });
const del = (path: string) => request<void>(path, { method: "DELETE" });

/**
 * POST som läser ett SSE-svar. Om servern svarar med vanlig JSON i stället
 * (t.ex. analys-endpointen) returneras den parsade kroppen.
 */
export async function stream(
  path: string,
  body: unknown,
  onEvent: (event: StreamEvent) => void,
  signal?: AbortSignal,
): Promise<unknown> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream", "x-lawla-request": "1" },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "same-origin",
    signal,
  });
  if (res.status === 401) onUnauthorized?.();
  if (!res.ok) throw await toError(res);

  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("text/event-stream")) {
    const text = await res.text();
    return text ? JSON.parse(text) : undefined;
  }
  if (!res.body) throw new ApiError(500, "Tomt svar från servern.");

  const parser = createSseParser(onEvent);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parser.push(decoder.decode(value, { stream: true }));
  }
  parser.push(decoder.decode());
  parser.end();
  return undefined;
}

/* ─── Endpoints ──────────────────────────────────────────────────────── */

const enc = encodeURIComponent;

export const authApi = {
  me: () => get<{ user: UserDto }>("/auth/me"),
  login: (body: LoginRequest) => post<SessionResponse>("/auth/login", body),
  register: (body: RegisterRequest) => post<SessionResponse>("/auth/register", body),
  logout: () => post<void>("/auth/logout"),
};

export const systemApi = {
  features: () => get<FeatureStatusDto>("/api/System/features"),
};

type ItemKind = "questions" | "circumstances" | "legal-issues";

export const projectsApi = {
  list: () => get<ProjectSummaryDto[]>("/api/Projects"),
  get: (id: number) => get<ProjectDetailDto>(`/api/Projects/${id}`),
  create: (body: CreateProjectRequest) => post<ProjectDetailDto>("/api/Projects", body),
  update: (id: number, body: UpdateProjectRequest) => put<ProjectDetailDto>(`/api/Projects/${id}`, body),
  remove: (id: number) => del(`/api/Projects/${id}`),

  addItem: (id: number, kind: ItemKind, text: string) =>
    post<TextItemDto | ProjectLegalIssueDto>(`/api/Projects/${id}/${kind}`, { text }),
  updateItem: (id: number, kind: ItemKind, itemId: number, text: string) =>
    put<TextItemDto>(`/api/Projects/${id}/${kind}/${itemId}`, { text }),
  removeItem: (id: number, kind: ItemKind, itemId: number) => del(`/api/Projects/${id}/${kind}/${itemId}`),

  evidence: (id: number) => get<ExpandedEvidenceDto[]>(`/api/Projects/${id}/evidence/expanded`),
  addEvidence: (id: number, body: AddEvidenceRequest) => post<ProjectEvidenceDto>(`/api/Projects/${id}/evidence`, body),
  removeEvidence: (id: number, evidenceId: number) => del(`/api/Projects/${id}/evidence/${evidenceId}`),

  issueAnalyses: (id: number, issueId: number) =>
    get<LegalIssueAnalysisDto[]>(`/api/Projects/${id}/legal-issues/${issueId}/analyses`),
  analyzeIssue: (id: number, issueId: number) =>
    post<LegalIssueAnalysisDto>(`/api/Projects/${id}/legal-issues/${issueId}/analyze`),

  analyses: (id: number) => get<ProjectAnalysisDto[]>(`/api/Projects/${id}/analyses`),
  /** Kör samlad analys. Strömmar text om backend svarar med SSE, annars returneras analysen. */
  runAnalysis: (id: number, onEvent: (e: StreamEvent) => void, signal?: AbortSignal) =>
    stream(`/api/Projects/${id}/analyses`, undefined, onEvent, signal) as Promise<ProjectAnalysisDto | undefined>,
};

export interface DocumentQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  tag?: string;
  documentType?: string;
  searchContent?: boolean;
}

export const documentsApi = {
  stats: () => get<DocumentStatsDto>("/api/Documents/stats"),
  list: (q: DocumentQuery) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== "" && v !== false) params.set(k, String(v));
    return get<DocumentDto[]>(`/api/Documents?${params}`);
  },
  get: (id: number) => get<DocumentDto>(`/api/Documents/${id}`),
  chunks: (id: number) => get<ChunkDetailDto[]>(`/api/Documents/${id}/chunks`),
  chunk: (chunkId: number) => get<ChunkDetailDto>(`/api/Documents/chunks/${chunkId}`),
  toc: (id: number) => get<DocumentTocEntryDto[]>(`/api/Documents/${id}/toc`),
  outgoing: (id: number) => get<DocumentReferenceDto[]>(`/api/References/document/${enc(String(id))}/outgoing`),
  incoming: (id: number) => get<IncomingReferenceDto[]>(`/api/References/document/${enc(String(id))}/incoming`),
};

export const ragApi = {
  query: (body: RagQueryRequest, onEvent: (e: StreamEvent) => void, signal?: AbortSignal) =>
    stream("/api/Rag/query-stream", body, onEvent, signal),
};

export const feedbackApi = {
  send: (body: FeedbackRequest) => post<void>("/api/feedback", body),
};
