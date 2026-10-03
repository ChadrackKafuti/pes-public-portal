-- M26 hotfix: the first photo-AI runs failed on every photo with a 400
-- (the structured-output schema used type arrays and numeric constraints
-- the API rejects) and stamped them 'failed'. Clear those stamps so the
-- fixed schema retries them; genuine per-photo results are untouched.

UPDATE pes_photos
SET ai_processed_utc = NULL, ai_status = NULL
WHERE ai_status = 'failed' AND ai_summary IS NULL;
