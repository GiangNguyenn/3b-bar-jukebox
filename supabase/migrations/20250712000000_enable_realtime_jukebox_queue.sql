-- Enable real-time for the jukebox_queue table
alter publication supabase_realtime add table public.jukebox_queue;

-- Enable RLS
alter table public.jukebox_queue enable row level security;

-- Create policy to allow all operations (for now, we can make this more restrictive later)
create policy "Allow all operations on jukebox_queue" on public.jukebox_queue
  for all using (true);

-- Enable real-time for the tracks table as well
alter publication supabase_realtime add table public.tracks; 