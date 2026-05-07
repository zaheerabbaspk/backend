-- 1. Ensure withdrawal_password column exists in profiles
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS withdrawal_password TEXT;

-- 2. Create withdrawal_accounts table if it doesn't exist
CREATE TABLE IF NOT EXISTS public.withdrawal_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT REFERENCES public.profiles(id) ON DELETE CASCADE,
    method_key TEXT NOT NULL, -- e.g., 'jazzcash', 'easypaisa'
    method_name TEXT NOT NULL, -- e.g., 'JazzCash', 'Easypaisa'
    real_name TEXT NOT NULL, -- Account Holder Name
    account_id TEXT NOT NULL, -- Account Number / Phone
    id_number TEXT, -- Optional CNIC or ID
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 3. Ensure withdrawal_requests table is correctly structured
CREATE TABLE IF NOT EXISTS public.withdrawal_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT REFERENCES public.profiles(id) ON DELETE CASCADE,
    account_id UUID REFERENCES public.withdrawal_accounts(id) ON DELETE CASCADE,
    amount DECIMAL(12, 2) NOT NULL,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    rejection_reason TEXT,
    submitted_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 4. Enable RLS
ALTER TABLE public.withdrawal_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.withdrawal_requests ENABLE ROW LEVEL SECURITY;

-- 5. Policies for withdrawal_accounts
DROP POLICY IF EXISTS "Users can manage their own accounts" ON public.withdrawal_accounts;
CREATE POLICY "Users can manage their own accounts" ON public.withdrawal_accounts
    FOR ALL USING (auth.uid()::text = user_id);

DROP POLICY IF EXISTS "Admins can view all accounts" ON public.withdrawal_accounts;
CREATE POLICY "Admins can view all accounts" ON public.withdrawal_accounts
    FOR SELECT USING (EXISTS (SELECT 1 FROM public.admins WHERE admins.user_id = auth.uid()::text));

-- 6. Policies for withdrawal_requests
DROP POLICY IF EXISTS "Users can view their own requests" ON public.withdrawal_requests;
CREATE POLICY "Users can view their own requests" ON public.withdrawal_requests
    FOR SELECT USING (auth.uid()::text = user_id);

DROP POLICY IF EXISTS "Users can insert their own requests" ON public.withdrawal_requests;
CREATE POLICY "Users can insert their own requests" ON public.withdrawal_requests
    FOR INSERT WITH CHECK (auth.uid()::text = user_id);

DROP POLICY IF EXISTS "Admins can manage all requests" ON public.withdrawal_requests;
CREATE POLICY "Admins can manage all requests" ON public.withdrawal_requests
    FOR ALL USING (EXISTS (SELECT 1 FROM public.admins WHERE admins.user_id = auth.uid()::text));
