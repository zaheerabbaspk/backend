const supabase = require('../config/supabase');
const gameEngine = require('../game/GameEngine');

const adminController = {
    // Get admin stats (total users, total balance, etc.)
    getStats: async (req, res) => {
        try {
            const { data: users, count, error } = await supabase
                .from('profiles')
                .select('*', { count: 'exact' });

            if (error) throw error;

            const totalBalance = users.reduce((sum, user) => sum + parseFloat(user.balance || 0), 0);

            // Calculate status counts
            const activeCount = users.filter(u => u.status === 'active').length;
            const blockedCount = users.filter(u => u.status === 'blocked').length;
            const suspendedCount = users.filter(u => u.status === 'suspended').length;

            res.json({
                totalUsers: count,
                totalBalance: totalBalance,
                activeUsers: activeCount,
                blockedUsers: blockedCount,
                suspendedUsers: suspendedCount,
                currentGameStatus: gameEngine.state,
                currentMultiplier: gameEngine.multiplier.toFixed(2)
            });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    },

    // Get all users for admin table
    getAllUsers: async (req, res) => {
        try {
            const { data, error } = await supabase
                .from('profiles')
                .select('*')
                .order('created_at', { ascending: false });

            if (error) throw error;
            res.json(data);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    },

    // Update user status (active, blocked, suspended)
    updateUserStatus: async (req, res) => {
        try {
            const { userId } = req.params;
            const { status } = req.body;

            const { data, error } = await supabase
                .from('profiles')
                .update({ status })
                .eq('id', userId)
                .select()
                .single();

            if (error) throw error;
            res.json(data);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    },

    // Get all admins
    getAdmins: async (req, res) => {
        try {
            const { data, error } = await supabase
                .from('admins')
                .select(`
                    *,
                    profiles (
                        full_name,
                        email
                    )
                `);

            if (error) throw error;
            res.json(data);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    },

    // Get all payment proofs for review
    getPaymentProofs: async (req, res) => {
        try {
            const { data, error } = await supabase
                .from('payment_proofs')
                .select(`
                    *,
                    profiles (
                        full_name,
                        email
                    ),
                    packages (
                        name
                    )
                `)
                .order('submitted_at', { ascending: false });

            if (error) throw error;
            res.json(data);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    },

    // Approve or reject a payment proof
    handlePaymentProof: async (req, res) => {
        try {
            const { id } = req.params;
            const { status, rejectionReason } = req.body; // 'approved' or 'rejected'

            if (!['approved', 'rejected'].includes(status)) {
                return res.status(400).json({ error: 'Invalid status' });
            }

            // 1. Update the proof status and reason
            const { data: proof, error: proofError } = await supabase
                .from('payment_proofs')
                .update({
                    status,
                    rejection_reason: status === 'rejected' ? rejectionReason : null
                })
                .eq('id', id)
                .select()
                .single();

            if (proofError) throw proofError;

            // 2. If approved, update the user's package
            if (status === 'approved') {
                // Get package name
                const { data: pkg } = await supabase
                    .from('packages')
                    .select('name')
                    .eq('id', proof.package_id)
                    .single();

                await supabase
                    .from('profiles')
                    .update({ package: pkg ? pkg.name : 'Pro' }) // Fallback to 'Pro' if package not found
                    .eq('id', proof.user_id);
            }

            res.json(proof);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    },

    // Update game settings (e.g., waiting time)
    updateGameSettings: async (req, res) => {
        try {
            const { waitingTime, crashedTime } = req.body;

            if (waitingTime) gameEngine.waitingTime = waitingTime;
            if (crashedTime) gameEngine.crashedTime = crashedTime;

            res.json({
                message: 'Settings updated',
                waitingTime: gameEngine.waitingTime,
                crashedTime: gameEngine.crashedTime
            });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    },

    // Manual crash trigger (already exists in socket but available via API too)
    triggerCrash: (req, res) => {
        gameEngine.triggerManualCrash();
        res.json({ message: 'Manual crash triggered' });
    }
};

module.exports = adminController;
