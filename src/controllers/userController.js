const supabase = require('../config/supabase');

const userController = {
    // Get user profile
    getProfile: async (req, res) => {
        try {
            const { userId } = req.params;
            const { data, error } = await supabase
                .from('profiles')
                .select('*')
                .eq('id', userId)
                .single();

            if (error) throw error;
            res.json(data);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    },

    // Update balance (e.g., after deposit or game result)
    updateBalance: async (req, res) => {
        try {
            const { userId, amount } = req.body;

            // Get current balance first
            const { data: profile, error: getError } = await supabase
                .from('profiles')
                .select('balance')
                .eq('id', userId)
                .single();

            if (getError) throw getError;

            const newBalance = parseFloat(profile.balance) + parseFloat(amount);

            const { data, error } = await supabase
                .from('profiles')
                .update({ balance: newBalance })
                .eq('id', userId)
                .select()
                .single();

            if (error) throw error;
            res.json(data);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    },

    // Sync profile (create or update)
    syncProfile: async (req, res) => {
        try {
            const { uid, email, name } = req.body;
            console.log('[UserController] Syncing profile:', { uid, email, name });

            if (!uid) {
                return res.status(400).json({ error: 'UID is required' });
            }

            const { data, error } = await supabase
                .from('profiles')
                .upsert({
                    id: uid,
                    email: email,
                    full_name: name,
                    updated_at: new Date().toISOString()
                })
                .select()
                .single();

            if (error) {
                console.error('[UserController] Supabase sync error:', error);
                throw error;
            }

            res.json(data);
        } catch (error) {
            console.error('[UserController] Catch sync error:', error.message);
            res.status(500).json({ error: error.message });
        }
    },

    // Submit payment proof
    submitPaymentProof: async (req, res) => {
        try {
            const { userId, packageId, amount, screenshotUrl, transactionId } = req.body;
            console.log('[UserController] Submitting payment proof:', { userId, packageId, amount, transactionId });

            if (!userId || !packageId || !amount) {
                return res.status(400).json({ error: 'Missing required fields' });
            }

            const { data, error } = await supabase
                .from('payment_proofs')
                .insert({
                    user_id: userId,
                    package_id: packageId,
                    amount: amount,
                    screenshot_url: screenshotUrl,
                    transaction_id: transactionId,
                    status: 'pending'
                })
                .select()
                .single();

            if (error) {
                console.error('[UserController] Supabase insert error:', error);
                throw error;
            }

            res.json(data);
        } catch (error) {
            console.error('[UserController] Catch submit error:', error.message);
            res.status(500).json({ error: error.message });
        }
    },

    // Get payment history for a user
    getUserPayments: async (req, res) => {
        try {
            const { userId } = req.params;
            const { data, error } = await supabase
                .from('payment_proofs')
                .select(`
                    *,
                    packages (
                        name
                    )
                `)
                .eq('user_id', userId)
                .order('submitted_at', { ascending: false });

            if (error) throw error;
            res.json(data);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    },

    // Add more user-related logic here
};

module.exports = userController;
