PRAGMA foreign_keys=ON;
CREATE TABLE releases (
  release_id TEXT PRIMARY KEY,
  manifest_sha256 TEXT NOT NULL CHECK(length(manifest_sha256)=64),
  status TEXT NOT NULL CHECK(status IN ('fixture','staged','published','retired')),
  publication_approval_ref TEXT,
  created_at TEXT NOT NULL,
  CHECK(status!='published' OR (publication_approval_ref IS NOT NULL AND length(publication_approval_ref)>0))
);
CREATE TABLE app_settings(singleton INTEGER PRIMARY KEY CHECK(singleton=1), active_release TEXT REFERENCES releases(release_id));
CREATE TABLE chunks (
  rowid INTEGER PRIMARY KEY,
  chunk_id TEXT NOT NULL UNIQUE,
  release_id TEXT NOT NULL REFERENCES releases(release_id),
  publication TEXT NOT NULL CHECK(publication IN ('fixture_only','tester_approved')),
  heading TEXT NOT NULL,
  body TEXT NOT NULL CHECK(length(body)<=2500),
  tags TEXT NOT NULL,
  record_json TEXT NOT NULL CHECK(json_valid(record_json))
);
CREATE INDEX chunks_release ON chunks(release_id,publication);
CREATE VIRTUAL TABLE chunks_fts USING fts5(heading,body,tags,content='chunks',content_rowid='rowid',tokenize='unicode61');
CREATE TRIGGER chunks_insert AFTER INSERT ON chunks BEGIN
 INSERT INTO chunks_fts(rowid,heading,body,tags) VALUES(new.rowid,new.heading,new.body,new.tags);
END;
CREATE TRIGGER chunks_delete AFTER DELETE ON chunks BEGIN
 INSERT INTO chunks_fts(chunks_fts,rowid,heading,body,tags) VALUES('delete',old.rowid,old.heading,old.body,old.tags);
END;
CREATE TRIGGER chunks_immutable BEFORE UPDATE ON chunks BEGIN SELECT RAISE(ABORT,'CHUNKS_IMMUTABLE'); END;
CREATE TABLE testers (
  email TEXT PRIMARY KEY,
  principal_id TEXT UNIQUE,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
  daily_limit INTEGER NOT NULL DEFAULT 20 CHECK(daily_limit BETWEEN 1 AND 100),
  consent_version TEXT NOT NULL DEFAULT 'research-notice-v1'
);
CREATE TABLE runs (
  interaction_id TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL,
  tester_email TEXT NOT NULL REFERENCES testers(email),
  request_key TEXT NOT NULL,
  prompt_sha256 TEXT NOT NULL,
  prompt TEXT NOT NULL CHECK(length(prompt)<=4000),
  release_id TEXT NOT NULL REFERENCES releases(release_id),
  mode TEXT NOT NULL CHECK(mode IN ('extractive','api','plan')),
  status TEXT NOT NULL CHECK(status IN ('running','completed','failed','unknown')),
  started_ms INTEGER NOT NULL,
  expires_ms INTEGER NOT NULL,
  completed_ms INTEGER,
  public_answer_json TEXT CHECK(public_answer_json IS NULL OR json_valid(public_answer_json)),
  retrieved_chunk_ids TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(retrieved_chunk_ids)),
  usage_json TEXT CHECK(usage_json IS NULL OR json_valid(usage_json)),
  error_code TEXT,
  diagnostic_json TEXT CHECK(diagnostic_json IS NULL OR json_valid(diagnostic_json)),
  UNIQUE(principal_id,request_key)
);
CREATE INDEX runs_started ON runs(started_ms);
CREATE INDEX runs_principal_started ON runs(principal_id,started_ms);
CREATE UNIQUE INDEX runs_one_active ON runs(principal_id) WHERE status IN ('running','unknown');
CREATE TRIGGER runs_admission BEFORE INSERT ON runs BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM testers WHERE email=new.tester_email AND principal_id=new.principal_id AND enabled=1)
  THEN RAISE(ABORT,'NOT_INVITED') END;
 SELECT CASE WHEN (SELECT count(*) FROM runs WHERE status IN ('running','unknown'))>=2
  THEN RAISE(ABORT,'GLOBAL_BUSY') END;
 SELECT CASE WHEN (SELECT count(*) FROM runs WHERE started_ms >= (new.started_ms / 86400000)*86400000)>=100
  THEN RAISE(ABORT,'GLOBAL_DAILY_LIMIT') END;
 SELECT CASE WHEN (SELECT count(*) FROM runs WHERE principal_id=new.principal_id AND started_ms >= (new.started_ms / 86400000)*86400000)
  >= (SELECT daily_limit FROM testers WHERE email=new.tester_email)
  THEN RAISE(ABORT,'TESTER_DAILY_LIMIT') END;
END;
CREATE TABLE feedback (
  interaction_id TEXT NOT NULL REFERENCES runs(interaction_id),
  principal_id TEXT NOT NULL,
  rating TEXT NOT NULL CHECK(rating IN ('useful','wrong','missing_evidence','needs_research')),
  note TEXT NOT NULL DEFAULT '' CHECK(length(note)<=1000),
  created_ms INTEGER NOT NULL,
  PRIMARY KEY(interaction_id,principal_id)
);
CREATE TABLE research_candidates (
  candidate_id TEXT PRIMARY KEY,
  interaction_id TEXT NOT NULL UNIQUE REFERENCES runs(interaction_id),
  release_id TEXT NOT NULL REFERENCES releases(release_id),
  question TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'unreviewed' CHECK(status IN ('unreviewed','duplicate','accepted','rejected','resolved')),
  execution_authority TEXT NOT NULL DEFAULT 'none' CHECK(execution_authority='none'),
  created_ms INTEGER NOT NULL
);
CREATE INDEX research_candidate_fingerprint ON research_candidates(release_id,fingerprint);
