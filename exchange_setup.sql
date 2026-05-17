-- ==========================================
-- BETTING EXCHANGE SCHEMA SETUP FOR COINWAVE
-- Paste and run this script in your Supabase SQL Editor
-- ==========================================

-- 1. Create exchange_markets table
CREATE TABLE IF NOT EXISTS public.exchange_markets (
  id TEXT PRIMARY KEY, -- match id e.g. 'e1', 'e2' or auto-uuid
  sport TEXT NOT NULL, -- 'cricket', 'football', 'tennis'
  tournament TEXT NOT NULL,
  start_time TIMESTAMP WITH TIME ZONE,
  status TEXT DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'SUSPENDED', 'CLOSED')),
  winner_runner_id TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. Create exchange_runners table
CREATE TABLE IF NOT EXISTS public.exchange_runners (
  id TEXT PRIMARY KEY, -- e.g. 'r1', 'r2'
  market_id TEXT REFERENCES public.exchange_markets(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 3. Create exchange_bets table
CREATE TABLE IF NOT EXISTS public.exchange_bets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT REFERENCES public.profiles(id) ON DELETE CASCADE,
  market_id TEXT REFERENCES public.exchange_markets(id) ON DELETE CASCADE,
  runner_id TEXT REFERENCES public.exchange_runners(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('BACK', 'LAY')),
  price DECIMAL(12, 2) NOT NULL, -- odds
  size DECIMAL(12, 2) NOT NULL, -- stake requested
  matched_size DECIMAL(12, 2) DEFAULT 0.00 NOT NULL,
  status TEXT DEFAULT 'unmatched' CHECK (status IN ('unmatched', 'matched', 'cancelled', 'won', 'lost', 'voided')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 4. Create exchange_exposures table
CREATE TABLE IF NOT EXISTS public.exchange_exposures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT REFERENCES public.profiles(id) ON DELETE CASCADE,
  market_id TEXT REFERENCES public.exchange_markets(id) ON DELETE CASCADE,
  exposure_amount DECIMAL(12, 2) DEFAULT 0.00 NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  UNIQUE(user_id, market_id)
);

-- 5. Create exchange_transactions table
CREATE TABLE IF NOT EXISTS public.exchange_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT REFERENCES public.profiles(id) ON DELETE CASCADE,
  amount DECIMAL(12, 2) NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('place_bet', 'cancel_bet', 'bet_matched', 'settlement_win', 'settlement_lose', 'commission')),
  reference_id TEXT, -- bet id or market id
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 6. Insert initial seed markets (optional, for immediate testing)
INSERT INTO public.exchange_markets (id, sport, tournament, start_time, status)
VALUES 
  ('m1', 'cricket', 'Indian Premier League', timezone('utc'::text, now() + interval '11 days'), 'OPEN'),
  ('m2', 'football', 'Champions League Final', timezone('utc'::text, now()), 'OPEN')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.exchange_runners (id, market_id, name)
VALUES 
  ('r1', 'm1', 'Mumbai Indians'),
  ('r2', 'm1', 'Chennai Super Kings'),
  ('f1', 'm2', 'Real Madrid'),
  ('f2', 'm2', 'Manchester City')
ON CONFLICT (id) DO NOTHING;

-- 7. Add row level security (RLS) policies
ALTER TABLE public.exchange_markets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exchange_runners ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exchange_bets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exchange_exposures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exchange_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow read for all exchange_markets" ON public.exchange_markets FOR SELECT USING (true);
CREATE POLICY "Allow read for all exchange_runners" ON public.exchange_runners FOR SELECT USING (true);
CREATE POLICY "Allow all for exchange_bets" ON public.exchange_bets FOR ALL USING (true);
CREATE POLICY "Allow all for exchange_exposures" ON public.exchange_exposures FOR ALL USING (true);
CREATE POLICY "Allow all for exchange_transactions" ON public.exchange_transactions FOR ALL USING (true);
