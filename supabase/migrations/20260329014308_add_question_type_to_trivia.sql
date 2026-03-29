-- Add question_type column to trivia_questions to track which Q-type (Q1–Q8)
-- was used when generating a question. This enables the trivia API to pass
-- explicit type codes back to the AI to prevent repetitive question types.
ALTER TABLE trivia_questions
  ADD COLUMN IF NOT EXISTS question_type text;
