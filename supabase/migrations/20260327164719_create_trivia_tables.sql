CREATE TABLE trivia_questions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  spotify_track_id TEXT NOT NULL,
  question TEXT NOT NULL,
  options JSONB NOT NULL,
  correct_index SMALLINT NOT NULL CHECK (correct_index BETWEEN 0 AND 3),
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  UNIQUE (profile_id, spotify_track_id)
);

CREATE INDEX idx_trivia_questions_lookup
  ON trivia_questions (profile_id, spotify_track_id);

ALTER TABLE trivia_questions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read trivia questions"
  ON trivia_questions FOR SELECT USING (true);
CREATE POLICY "Service role insert/update trivia questions"
  ON trivia_questions FOR ALL USING (auth.role() = 'service_role');


CREATE TABLE trivia_scores (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  player_name TEXT NOT NULL CHECK (char_length(player_name) BETWEEN 1 AND 20),
  score INTEGER NOT NULL DEFAULT 0 CHECK (score >= 0),
  first_score_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  UNIQUE (profile_id, session_id)
);

CREATE INDEX idx_trivia_scores_leaderboard
  ON trivia_scores (profile_id, score DESC, first_score_at ASC);

ALTER TABLE trivia_scores REPLICA IDENTITY FULL;

ALTER TABLE trivia_scores ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read trivia scores"
  ON trivia_scores FOR SELECT USING (true);
CREATE POLICY "Service role manage trivia scores"
  ON trivia_scores FOR ALL USING (auth.role() = 'service_role');


CREATE OR REPLACE FUNCTION trivia_determine_winner_and_reset(
  p_profile_id UUID
)
RETURNS TABLE (winner_name TEXT, winner_score INTEGER) AS $$
BEGIN
  RETURN QUERY
  SELECT ts.player_name, ts.score
  FROM trivia_scores ts
  WHERE ts.profile_id = p_profile_id
    AND ts.score > 0
  ORDER BY ts.score DESC, ts.first_score_at ASC
  LIMIT 1;

  DELETE FROM trivia_scores WHERE trivia_scores.profile_id = p_profile_id;
END;
$$ LANGUAGE plpgsql;
