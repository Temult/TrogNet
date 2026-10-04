-- Integration-only addition. No production release or active pointer is seeded here.
ALTER TABLE release_adapters ADD COLUMN profile TEXT NOT NULL DEFAULT 'rc1' CHECK(profile IN ('rc1','publication-v1.2-strict'));
ALTER TABLE release_adapters ADD COLUMN producer_release TEXT;
ALTER TABLE release_adapters ADD COLUMN producer_corpus_sha256 TEXT;
ALTER TABLE release_adapters ADD COLUMN public_cards_sha256 TEXT;
CREATE TRIGGER release_adapter_immutable BEFORE UPDATE ON release_adapters BEGIN SELECT RAISE(ABORT,'RELEASE_ADAPTER_IMMUTABLE'); END;
CREATE TRIGGER release_adapter_immutable_delete BEFORE DELETE ON release_adapters BEGIN SELECT RAISE(ABORT,'RELEASE_ADAPTER_IMMUTABLE'); END;
CREATE TABLE publication_navigation(
 release_id TEXT PRIMARY KEY REFERENCES releases(release_id),
 index_sha256 TEXT NOT NULL CHECK(length(index_sha256)=64),
 record_json TEXT NOT NULL CHECK(json_valid(record_json))
);
CREATE TRIGGER publication_navigation_immutable BEFORE UPDATE ON publication_navigation BEGIN SELECT RAISE(ABORT,'NAVIGATION_IMMUTABLE'); END;
CREATE TRIGGER publication_navigation_immutable_delete BEFORE DELETE ON publication_navigation BEGIN SELECT RAISE(ABORT,'NAVIGATION_IMMUTABLE'); END;
