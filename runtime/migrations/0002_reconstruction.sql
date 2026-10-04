PRAGMA foreign_keys=ON;
ALTER TABLE runs ADD COLUMN dispatch_state TEXT NOT NULL DEFAULT 'pre_dispatch' CHECK(dispatch_state IN ('pre_dispatch','dispatched'));
ALTER TABLE runs ADD COLUMN retryable INTEGER NOT NULL DEFAULT 0 CHECK(retryable IN (0,1));
ALTER TABLE runs ADD COLUMN conversation_id TEXT;
DROP INDEX research_candidate_fingerprint;
CREATE UNIQUE INDEX research_candidate_release_fingerprint ON research_candidates(release_id,fingerprint);

CREATE TABLE release_adapters(
  release_id TEXT PRIMARY KEY REFERENCES releases(release_id),
  contract TEXT NOT NULL CHECK(contract IN ('echoes-publication-card/v1')),
  fixture_only INTEGER NOT NULL CHECK(fixture_only IN (0,1))
);

CREATE TABLE publication_cards(
  rowid INTEGER PRIMARY KEY,
  card_id TEXT NOT NULL,
  release_id TEXT NOT NULL REFERENCES releases(release_id),
  publication TEXT NOT NULL CHECK(publication IN ('candidate_only','tester_approved')),
  class TEXT NOT NULL CHECK(class IN ('SOURCE','DERIVED','MODEL','OBSERVED','OPEN')),
  snapshot TEXT NOT NULL,
  title TEXT NOT NULL,
  statement TEXT NOT NULL,
  tags TEXT NOT NULL,
  is_superseded INTEGER NOT NULL DEFAULT 0 CHECK(is_superseded IN (0,1)),
  record_json TEXT NOT NULL CHECK(json_valid(record_json)),
  UNIQUE(release_id,card_id)
);
CREATE INDEX publication_cards_release ON publication_cards(release_id,publication,is_superseded,snapshot);
CREATE VIRTUAL TABLE publication_cards_fts USING fts5(title,statement,tags,content='publication_cards',content_rowid='rowid',tokenize='unicode61');
CREATE TRIGGER publication_cards_insert AFTER INSERT ON publication_cards BEGIN
  INSERT INTO publication_cards_fts(rowid,title,statement,tags) VALUES(new.rowid,new.title,new.statement,new.tags);
END;
CREATE TRIGGER publication_cards_delete AFTER DELETE ON publication_cards BEGIN
  INSERT INTO publication_cards_fts(publication_cards_fts,rowid,title,statement,tags) VALUES('delete',old.rowid,old.title,old.statement,old.tags);
END;
CREATE TRIGGER publication_cards_immutable BEFORE UPDATE ON publication_cards BEGIN SELECT RAISE(ABORT,'PUBLICATION_CARDS_IMMUTABLE'); END;
CREATE TRIGGER publication_cards_immutable_delete BEFORE DELETE ON publication_cards BEGIN SELECT RAISE(ABORT,'PUBLICATION_CARDS_IMMUTABLE'); END;

CREATE TABLE conversations(
  conversation_id TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL,
  release_id TEXT NOT NULL REFERENCES releases(release_id),
  created_ms INTEGER NOT NULL,
  updated_ms INTEGER NOT NULL
);
CREATE INDEX conversations_principal ON conversations(principal_id,updated_ms);
CREATE TABLE conversation_turns(
  turn_id INTEGER PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(conversation_id),
  ordinal INTEGER NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('user','assistant')),
  content TEXT NOT NULL CHECK(length(content)<=12000),
  interaction_id TEXT REFERENCES runs(interaction_id),
  UNIQUE(conversation_id,ordinal)
);
CREATE INDEX conversation_turns_lookup ON conversation_turns(conversation_id,ordinal);
