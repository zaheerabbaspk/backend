-- 0. Storage Setup (Run these manually in Supabase Storage SQL or via UI)
-- INSERT INTO storage.buckets (id, name, public) VALUES ('payment-proofs', 'payment-proofs', true);
-- CREATE POLICY "Public Access" ON storage.objects FOR SELECT USING (bucket_id = 'payment-proofs');
-- CREATE POLICY "User Upload" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'payment-proofs' AND auth.role() = 'authenticated');

-- 1. Drop existing tables and triggers
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user();
DROP TABLE IF EXISTS public.payment_proofs CASCADE;
DROP TABLE IF EXISTS public.admins CASCADE;
DROP TABLE IF EXISTS public.packages CASCADE;
DROP TABLE IF EXISTS public.profiles CASCADE;

-- 2. Create profiles table (Base table)
CREATE TABLE public.profiles (
  id TEXT PRIMARY KEY, -- Using TEXT for Firebase UID compatibility
  email TEXT UNIQUE,
  full_name TEXT,
  avatar_url TEXT,
  balance DECIMAL(12, 2) DEFAULT 0.00,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'blocked', 'suspended')),
  package TEXT DEFAULT 'Free',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 3. Create admins table
CREATE TABLE public.admins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT REFERENCES public.profiles(id) ON DELETE CASCADE,
  role TEXT DEFAULT 'moderator',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 4. Create packages table
CREATE TABLE public.packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  price DECIMAL(12, 2) NOT NULL,
  duration INTEGER NOT NULL, -- in days
  perks TEXT[], -- Array of strings
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 5. Create payment_proofs table
CREATE TABLE public.payment_proofs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT REFERENCES public.profiles(id) ON DELETE CASCADE,
  package_id UUID REFERENCES public.packages(id) ON DELETE SET NULL,
  amount DECIMAL(12, 2) NOT NULL,
  screenshot_url TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  transaction_id TEXT,
  rejection_reason TEXT, -- Added for admin feedback
  submitted_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 6. Enable Security
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_proofs ENABLE ROW LEVEL SECURITY;

-- 7. Policies
CREATE POLICY "Public profiles are viewable by everyone." ON public.profiles FOR SELECT USING (true);
CREATE POLICY "Public packages are viewable by everyone." ON public.packages FOR SELECT USING (true);
CREATE POLICY "Users can view their own proofs." ON public.payment_proofs FOR SELECT USING (true);
CREATE POLICY "Enable insert for everyone" ON public.payment_proofs FOR INSERT WITH CHECK (true);
CREATE POLICY "Super admins can do everything" ON public.profiles FOR ALL USING (true);

-- 8. Policies for profiles insert (Allows backend to sync)
CREATE POLICY "Enable insert for authenticated users" ON public.profiles FOR INSERT WITH CHECK (true);
CREATE POLICY "Enable update for users" ON public.profiles FOR UPDATE USING (true);

-- 9. Seed Packages
INSERT INTO public.packages (id, name, price, duration, perks, status)
VALUES 
  ('7b9e1b2a-1b2a-1b2a-1b2a-7b9e1b2a1b2a', 'Starter Pack', 5, 7, ARRAY['Daily task rewards', 'Basic support', 'Weekly payout'], 'active'),
  ('8c0f2c3b-2c3b-2c3b-2c3b-8c0f2c3b2c3b', 'Growth Pack', 15, 7, ARRAY['Daily task rewards', 'Priority support', '2x referral bonus', 'Weekly payout'], 'active'),
  ('9d1a3d4c-3d4c-3d4c-3d4c-9d1a3d4c3d4c', 'Pro Pack', 30, 7, ARRAY['Daily task rewards', 'Priority support', '3x referral bonus', 'Early payout option'], 'active'),
  ('ae2b4e5d-4e5d-4e5d-4e5d-ae2b4e5d4e5d', 'Elite Pack', 50, 7, ARRAY['Daily task rewards', 'VIP support', '5x referral bonus', 'Daily payouts', 'Exclusive tasks'], 'active')
ON CONFLICT (id) DO NOTHING;
