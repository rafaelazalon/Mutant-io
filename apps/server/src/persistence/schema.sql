-- Esquema PostgreSQL para a etapa de contas e estatísticas permanentes.
-- Ainda não conectado: o servidor usa MemoryStatsRepository até DATABASE_URL ser configurada
-- e um driver (ex.: `pg`) ser adicionado.

CREATE TABLE IF NOT EXISTS accounts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name  VARCHAR(16) NOT NULL,
  account_xp    INTEGER NOT NULL DEFAULT 0 CHECK (account_xp >= 0),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS matches (
  id          BIGSERIAL PRIMARY KEY,
  room_id     TEXT NOT NULL,
  match_no    INTEGER NOT NULL,
  ended_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (room_id, match_no)
);

-- Uma linha por jogador humano por partida (bots não são gravados).
CREATE TABLE IF NOT EXISTS match_players (
  match_id    BIGINT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  account_id  UUID REFERENCES accounts(id) ON DELETE SET NULL,
  name        VARCHAR(16) NOT NULL,
  placement   SMALLINT NOT NULL,
  score       INTEGER NOT NULL,
  kills       SMALLINT NOT NULL,
  deaths      SMALLINT NOT NULL,
  max_level   SMALLINT NOT NULL,
  build_code  VARCHAR(16) NOT NULL,
  hybrids     TEXT[] NOT NULL DEFAULT '{}',
  PRIMARY KEY (match_id, placement)
);

-- Registro de mutações/híbridos descobertos por conta.
CREATE TABLE IF NOT EXISTS discoveries (
  account_id  UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  item_id     VARCHAR(32) NOT NULL,
  first_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, item_id)
);

-- Cosméticos: apenas visuais, nunca alteram atributos.
CREATE TABLE IF NOT EXISTS cosmetics_owned (
  account_id  UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  cosmetic_id VARCHAR(32) NOT NULL,
  PRIMARY KEY (account_id, cosmetic_id)
);
