CREATE OR REPLACE FUNCTION public.get_track_popularity_histogram(p_user_id uuid)
RETURNS TABLE(popularity_range text, track_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    CASE 
      WHEN t.popularity >= 0 AND t.popularity < 20 THEN '0-19'
      WHEN t.popularity >= 20 AND t.popularity < 40 THEN '20-39'
      WHEN t.popularity >= 40 AND t.popularity < 60 THEN '40-59'
      WHEN t.popularity >= 60 AND t.popularity < 80 THEN '60-79'
      WHEN t.popularity >= 80 AND t.popularity <= 100 THEN '80-100'
      ELSE 'Unknown'
    END AS popularity_range,
    COUNT(t.id)::INTEGER AS track_count
  FROM
    public.tracks t
  JOIN
    public.suggested_tracks st ON t.id = st.track_id
  JOIN
    public.profiles p ON st.profile_id = p.id
  WHERE
    p.id = p_user_id
  GROUP BY
    CASE 
      WHEN t.popularity >= 0 AND t.popularity < 20 THEN '0-19'
      WHEN t.popularity >= 20 AND t.popularity < 40 THEN '20-39'
      WHEN t.popularity >= 40 AND t.popularity < 60 THEN '40-59'
      WHEN t.popularity >= 60 AND t.popularity < 80 THEN '60-79'
      WHEN t.popularity >= 80 AND t.popularity <= 100 THEN '80-100'
      ELSE 'Unknown'
    END
  ORDER BY
    CASE popularity_range
      WHEN '0-19' THEN 1
      WHEN '20-39' THEN 2
      WHEN '40-59' THEN 3
      WHEN '60-79' THEN 4
      WHEN '80-100' THEN 5
      ELSE 6
    END;
END;
$function$;
