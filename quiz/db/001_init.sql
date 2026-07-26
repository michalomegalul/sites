CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE surveys (
  id             SERIAL PRIMARY KEY,
  slug           TEXT UNIQUE NOT NULL,
  default_locale TEXT NOT NULL DEFAULT 'cs',
  locales        TEXT[] NOT NULL DEFAULT ARRAY['cs','en'],
  consent_ver    TEXT NOT NULL DEFAULT 'v1',
  is_open        BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE survey_i18n (
  survey_id  INT NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
  locale     TEXT NOT NULL,
  title      TEXT NOT NULL,
  intro_md   TEXT,
  consent_md TEXT,
  thanks_md  TEXT,
  PRIMARY KEY (survey_id, locale)
);

CREATE TABLE questions (
  id        SERIAL PRIMARY KEY,
  survey_id INT NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
  position  INT NOT NULL,
  code      TEXT NOT NULL,
  kind      TEXT NOT NULL CHECK (kind IN
              ('text','textarea','single','multi','scale','number','date','bodymap')),
  required  BOOLEAN NOT NULL DEFAULT false,
  spec      JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (survey_id, code),
  UNIQUE (survey_id, position) DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE question_i18n (
  question_id INT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  locale      TEXT NOT NULL,
  prompt      TEXT NOT NULL,
  help        TEXT,
  labels      JSONB NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (question_id, locale)
);

CREATE TABLE sources (
  id        SERIAL PRIMARY KEY,
  survey_id INT NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
  code      TEXT NOT NULL,
  label     TEXT,
  UNIQUE (survey_id, code)
);

CREATE TABLE responses (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  survey_id    INT NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
  source_id    INT REFERENCES sources(id) ON DELETE SET NULL,
  locale       TEXT NOT NULL,
  started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  submitted_at TIMESTAMPTZ,
  consent_ver  TEXT,
  ua_family    TEXT
);

CREATE TABLE answers (
  response_id UUID NOT NULL REFERENCES responses(id) ON DELETE CASCADE,
  question_id INT  NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  value       JSONB NOT NULL,
  PRIMARY KEY (response_id, question_id)
);

CREATE TABLE followups (
  id         SERIAL PRIMARY KEY,
  survey_id  INT NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
  email      TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (survey_id, email)
);

CREATE INDEX ON responses (survey_id, submitted_at);
CREATE INDEX ON responses (source_id);
CREATE INDEX ON answers (question_id);

CREATE VIEW v_source_stats AS
SELECT r.survey_id,
       COALESCE(s.code, 'direct') AS source,
       count(*) AS started,
       count(*) FILTER (WHERE r.submitted_at IS NOT NULL) AS completed
FROM responses r
LEFT JOIN sources s ON s.id = r.source_id
GROUP BY 1, 2;

CREATE VIEW v_answers_long AS
SELECT r.id AS response_id, r.survey_id, r.locale, r.source_id,
       r.submitted_at, q.code AS question, q.kind, a.value
FROM responses r
JOIN answers a ON a.response_id = r.id
JOIN questions q ON q.id = a.question_id
WHERE r.submitted_at IS NOT NULL;
