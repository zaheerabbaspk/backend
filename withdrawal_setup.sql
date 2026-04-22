-- 1. Drop existing policies to prevent "policy already exists" errors
DROP POLICY IF EXISTS "Users can insert their own requests" ON public.withdrawal_requests;
DROP POLICY IF EXISTS "Users can view their own requests" ON public.withdrawal_requests;
DROP POLICY IF EXISTS "Admins can do everything" ON public.withdrawal_requests;

-- 2. Create withdrawal_requests table (Ensure user_id is TEXT to match profiles.id)
CREATE TABLE IF NOT EXISTS public.withdrawal_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),    
  user_id TEXT REFERENCES public.profiles(id) ON DELETE CASCADE,
  account_id UUID REFERENCES public.withdrawal_accounts(id) ON DELETE CASCADE,
  amount DECIMAL(12, 2) NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  rejection_reason TEXT,
  submitted_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);
 
-- 3. Enable Security
ALTER TABLE public.withdrawal_requests ENABLE ROW LEVEL SECURITY;

-- 4. Recreate Policies
CREATE POLICY "Users can insert their own requests" ON public.withdrawal_requests 
  FOR INSERT WITH CHECK (auth.uid()::text = user_id);

CREATE POLICY "Users can view their own requests" ON public.withdrawal_requests 
  FOR SELECT USING (auth.uid()::text = user_id);

CREATE POLICY "Admins can do everything" ON public.withdrawal_requests 
  FOR ALL USING (true);

