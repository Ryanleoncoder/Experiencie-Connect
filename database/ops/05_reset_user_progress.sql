

UPDATE user_progress
SET 
  xp = 0,
  level = 1,
  completed_challenges = '{}',
  completed_minigames = '{}',
  attempt_history = '[]'::jsonb,
  updated_at = NOW()
WHERE user_id = '978afe56-f037-4b5d-b818-ab8e23b266ae'; -- Substitua pelo seu user_id


SELECT 
  user_id,
  xp,
  level,
  completed_challenges,
  completed_minigames,
  jsonb_array_length(attempt_history) as attempt_count,
  updated_at
FROM user_progress
WHERE user_id = '978afe56-f037-4b5d-b818-ab8e23b266ae'; -- Substitua pelo seu user_id

SELECT 
  sync_type,
  xp_before,
  xp_after,
  xp_delta,
  new_challenges,
  synced_at
FROM progress_history
WHERE user_id = '978afe56-f037-4b5d-b818-ab8e23b266ae' -- Substitua pelo seu user_id
ORDER BY synced_at DESC
LIMIT 10;
