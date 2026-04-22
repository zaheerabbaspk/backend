-- 1. Add game_id, invited_by, and lucky_spins to profiles
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS game_id TEXT,
ADD COLUMN IF NOT EXISTS invited_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS lucky_spins INTEGER DEFAULT 0;

-- 2. Ensure the game_id is unique so we can look it up during registration
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS unique_game_id;
ALTER TABLE public.profiles ADD CONSTRAINT unique_game_id UNIQUE (game_id);

-- 3. We need a function that the admin application can securely call to increment spins.
-- Doing this via a secure function solves RLS blocking updates to other users' profiles.
CREATE OR REPLACE FUNCTION increment_lucky_spins(user_id UUID)
RETURNS void AS $$
BEGIN
  UPDATE public.profiles
  SET lucky_spins = lucky_spins + 1
  WHERE id = user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
