CREATE OR REPLACE FUNCTION public.get_track_release_year_histogram(p_user_id uuid)
RETURNS TABLE(decade text, track_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    (FLOOR(t.release_year / 10) * 10)::TEXT || 's' AS decade,
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
    FLOOR(t.release_year / 10)
  ORDER BY
    decade ASC;
END;
$function$;