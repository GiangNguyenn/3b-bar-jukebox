alter table profiles
  add column if not exists ai_prompt_preset_id text,
  add column if not exists ai_custom_prompt text,
  add column if not exists ai_autofill_target_size integer default 10;
