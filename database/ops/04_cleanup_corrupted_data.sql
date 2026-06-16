
CREATE OR REPLACE FUNCTION cleanup_attempt_history()
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  user_record RECORD;
  cleaned_history JSONB;
  item JSONB;
BEGIN
  FOR user_record IN 
    SELECT user_id, attempt_history 
    FROM user_progress
  LOOP
    cleaned_history := '[]'::jsonb;
    
    FOR item IN 
      SELECT * FROM jsonb_array_elements(user_record.attempt_history)
    LOOP
      IF jsonb_typeof(item) = 'object' THEN
        IF item ? 'challenge_id' 
           AND item ? 'timestamp' 
           AND item ? 'correct' 
           AND item ? 'time_used' 
           AND item ? 'score' 
        THEN
          cleaned_history := cleaned_history || jsonb_build_array(item);
        END IF;
      END IF;
    END LOOP;
    
    UPDATE user_progress
    SET attempt_history = cleaned_history,
        updated_at = NOW()
    WHERE user_id = user_record.user_id;
    
    RAISE NOTICE 'Cleaned attempt_history for user %', user_record.user_id;
  END LOOP;
  
  RAISE NOTICE 'Cleanup completed successfully';
END;
$$;

SELECT cleanup_attempt_history();

SELECT 
  user_id,
  xp,
  level,
  jsonb_array_length(attempt_history) as attempt_count,
  attempt_history
FROM user_progress
ORDER BY updated_at DESC;

