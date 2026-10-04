/** Deliberately small Cloudflare-compatible boundary, not an SDK replacement. */
export interface Statement {
  bind(...values: unknown[]): Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[]; success: boolean }>;
  run(): Promise<{ success: boolean; meta: { changes?: number } }>;
}
export interface Database { prepare(sql: string): Statement; batch(items: Statement[]): Promise<unknown[]>; }
export interface Env {
  DB: Database;
  ASSETS: { fetch(request: Request): Promise<Response> };
  PUBLIC_ORIGIN: string;
  ACCESS_ISSUER: string;
  ACCESS_AUDIENCE: string;
  PRINCIPAL_HMAC_KEY: string;
  INFERENCE_MODE: 'extractive' | 'api' | 'plan';
  INFERENCE_ENABLED: string;
  API_BILLING_APPROVED?: string;
  OPENAI_API_KEY?: string;
  MODEL?: string;
  PLAN_REMOTE_ELIGIBILITY_REF?: string;
  PLAN_VISIBILITY_DECISION_REF?: string;
  BROKER?: { idFromName(name: string): unknown; get(id: unknown): {fetch(request: Request): Promise<Response>} };
}
export interface Principal { id: string; email: string; }
export type EvidenceLayer = 'source_evidence' | 'mechanics_claim' | 'simulation_result' | 'research_report' | 'boundary_note';
export interface Chunk {
  chunk_id: string; release_id: string; document_id: string; heading: string;
  body: string; snapshot_id: string; layer: EvidenceLayer; fidelity: string;
  authority: 'client' | 'server' | 'conditional_model' | 'report_only';
  assumptions: string[]; unresolved: string[]; source_sha256: string;
  source_file: string; start_line: number; end_line: number; body_sha256: string;
  publication: 'fixture_only' | 'tester_approved'; tags: string[];
}
export type PublicationClass = 'SOURCE' | 'DERIVED' | 'MODEL' | 'OBSERVED' | 'OPEN';
export interface PublicPublicationCard {
  card_id: string;
  class: PublicationClass;
  title: string;
  statement: string;
  snapshot: string;
  scope: string;
  limitations: string[];
  assumptions?: string[];
  formula?: string;
  inputs?: Record<string,unknown>[];
  inputs_note?: string;
  environment?: Record<string,unknown>;
  open_boundary?: {question:string;closes_with:string;[key:string]:unknown};
  superseded_by?: string[];
}
export interface Hit {
  chunk: Chunk;
  rank: number;
  publication_card?: PublicPublicationCard;
  context_role?: 'primary' | 'required';
}
export interface ConversationTurn { role:'user'|'assistant'; content:string; }
export interface PublicCitation {
  id: string; title: string; excerpt: string; status: string; assumptions: string[];
  class?: PublicationClass; snapshot?: string; scope?: string; limitations?: string[];
  formula?: string; inputs?: Record<string,unknown>[]; inputs_note?: string;
  environment?: Record<string,unknown>; open_boundary?: Record<string,unknown>;
  context_role?: 'primary'|'required';
  card_id?: string;
  publication_card?: PublicPublicationCard;
}
export type AnswerClass = 'evidence_summary' | 'conditional' | 'unknown';
export interface AnswerDraft {
  answer_class: AnswerClass;
  paragraphs: { text: string; evidence_ids: string[] }[];
  caveats: string[];
  research_needed: boolean;
}
export interface EvidenceRelease {release_id:string;profile:string;producer_release:string|null;producer_corpus_sha256:string|null;public_cards_sha256:string|null;requested_snapshot:string;publication:'candidate_only'|'tester_approved';scope_notice:string;}
export interface PublicAnswer {
  evidence_release?: EvidenceRelease;
  evidence_status?: string;
  interaction_id: string; answer_class: AnswerClass;
  paragraphs: {text: string; citations: string[]}[];
  citations: PublicCitation[]; caveats: string[]; research_recorded: boolean;
  files: {label: string; path: string}[];
}
export interface ProviderDiagnostic {http_status:number;code:string|null;request_id:string|null;}
export class AppError extends Error {
  constructor(public code: string, public httpStatus = 400, public diagnostic?:ProviderDiagnostic) { super(code); this.name = 'AppError'; }
}
export interface Fetcher { (input: RequestInfo | URL, init?: RequestInit): Promise<Response>; }
/** E01 transport views preserve native strings and full rows, independently of publication cards. */
export interface AcceptedClaim {
  schema:string; claim_id:string; native_id_field:string; source_selector:string;
  native:{member:string;member_sha256:string;csv_line:number;headers:string[];row:Record<string,string>};
  native_semantics:Record<string,string>;
  supersession:{native_direction:string;native_value:string;exact_supersedes_id:string|null;derived_successor_ids:string[]};
}
export interface AcceptedIndexEntry {
  claim_id:string;default_discovery:boolean;derived_successor_ids:string[];
  [key:string]:unknown;
}
export interface AcceptedKnowledgeDocument {
  manifest:{schema:string;artifact_namespace:string;claim_count:number;source:{sha256:string;[key:string]:unknown};[key:string]:unknown};
  index:{schema:string;claims:AcceptedIndexEntry[];[key:string]:unknown};
  claims:AcceptedClaim[];
}
