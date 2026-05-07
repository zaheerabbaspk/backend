
-- 1. Create transactions table for tracking all monetary movements
CREATE TABLE IF NOT EXISTS public.transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT REFERENCES public.profiles(id) ON DELETE CASCADE,
    amount DECIMAL(12, 2) NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('deposit', 'withdrawal', 'game_win', 'game_loss', 'referral_bonus')),
    method TEXT,
    reference TEXT UNIQUE,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed', 'cancelled')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. Create manual_deposits table for the hidden proof flow
CREATE TABLE IF NOT EXISTS public.manual_deposits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT REFERENCES public.profiles(id) ON DELETE CASCADE,
  user_email TEXT,
  amount DECIMAL(12, 2) NOT NULL,
  transaction_id TEXT,
  proof_url TEXT,
  method TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  submitted_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 3. Enable RLS
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.manual_deposits ENABLE ROW LEVEL SECURITY;

-- 4. Policies
DROP POLICY IF EXISTS "Users can view their own transactions" ON public.transactions;
CREATE POLICY "Users can view their own transactions" ON public.transactions FOR SELECT USING (auth.uid()::text = user_id);

DROP POLICY IF EXISTS "Users can view their own manual deposits" ON public.manual_deposits;
CREATE POLICY "Users can view their own manual deposits" ON public.manual_deposits FOR SELECT USING (auth.uid()::text = user_id);

DROP POLICY IF EXISTS "Admins can do everything on transactions" ON public.transactions;
CREATE POLICY "Admins can do everything on transactions" ON public.transactions FOR ALL USING (true);

DROP POLICY IF EXISTS "Admins can do everything on manual deposits" ON public.manual_deposits;
CREATE POLICY "Admins can do everything on manual deposits" ON public.manual_deposits FOR ALL USING (true);

-- 5. RPC function for submitting manual deposits securely
CREATE OR REPLACE FUNCTION submit_manual_deposit(
    p_user_id TEXT,
    p_user_email TEXT,
    p_amount DECIMAL,
    p_transaction_id TEXT,
    p_proof_url TEXT,
    p_method TEXT
)
RETURNS JSON AS $$
DECLARE
    result JSON;
BEGIN
    INSERT INTO public.manual_deposits (
        user_id,
        user_email,
        amount,
        transaction_id,
        proof_url,
        method,
        status
    ) VALUES (
        p_user_id,
        p_user_email,
        p_amount,
        p_transaction_id,
        p_proof_url,
        p_method,
        'pending'
    );
    
    result := json_build_object('status', 'success', 'message', 'Deposit submitted');
    RETURN result;
EXCEPTION WHEN OTHERS THEN
    result := json_build_object('status', 'error', 'message', SQLERRM);
    RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
