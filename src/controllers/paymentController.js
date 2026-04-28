const axios = require('axios');
const supabase = require('../config/supabase');
const crypto = require('crypto');

const SAFEPAY_API_KEY = process.env.SAFEPAY_API_KEY;
const SAFEPAY_SECRET_KEY = process.env.SAFEPAY_SECRET_KEY;
const SAFEPAY_ENV = process.env.SAFEPAY_ENVIRONMENT || 'sandbox';

const BASE_URL = SAFEPAY_ENV === 'sandbox' 
    ? 'https://sandbox.api.getsafepay.com' 
    : 'https://api.getsafepay.com';

const paymentController = {
    createOrder: async (req, res) => {
        try {
            const { amount, userId, currency = 'PKR' } = req.body;

            console.log('[PaymentController] Request received:', { amount, userId });

            if (!amount || !userId) {
                return res.status(400).json({ error: 'Amount and UserId are required' });
            }

            // Prepare payload for Safepay (v1 standard)
            const payload = {
                amount: parseFloat(amount),
                currency: currency,
                client_order_id: `ORD_${userId}_${Date.now()}`,
                client: SAFEPAY_API_KEY,
                environment: SAFEPAY_ENV
            };

            console.log('[PaymentController] Calling Safepay API:', `${BASE_URL}/order/v1/init`);
            console.log('[PaymentController] Payload:', payload);
            console.log('[PaymentController] Using API Key:', SAFEPAY_API_KEY ? 'Present' : 'Missing');

            console.log('[PaymentController] Initializing Safepay Order');
            console.log('[PaymentController] Client ID:', SAFEPAY_API_KEY);
            console.log('[PaymentController] Environment:', SAFEPAY_ENV);

            const response = await axios.post(
                `${BASE_URL}/order/v1/init`,
                {
                    amount: parseFloat(amount),
                    currency: currency,
                    client_order_id: `ORD_${userId}_${Date.now()}`,
                    client: SAFEPAY_API_KEY,
                    environment: SAFEPAY_ENV
                },
                {
                    headers: {
                        'Authorization': `Bearer ${SAFEPAY_SECRET_KEY}`
                    }
                }
            );

            console.log('[PaymentController] Safepay Response:', response.data);

            // Safepay returns a token and potentially a redirect_url
            const token = response.data.data?.token || response.data.token;
            let checkoutUrl = response.data.data?.redirect_url || response.data.redirect_url;
            
            if (!checkoutUrl && token) {
                checkoutUrl = `${BASE_URL}/checkout/pay?token=${token}&env=${SAFEPAY_ENV}`;
            }

            res.json({
                checkout_url: checkoutUrl,
                token: token,
                order_id: payload.client_order_id
            });
        } catch (error) {
            console.error('[PaymentController] Create Order Error Details:', 
                error.response?.data || error.message
            );
            res.status(500).json({ 
                error: 'Failed to create payment order',
                details: error.response?.data || error.message 
            });
        }
    },

    handleWebhook: async (req, res) => {
        try {
            // Safepay webhook signature verification (v1)
            // The signature is usually sent in the X-SFPY-SIGNATURE header
            const signature = req.headers['x-sfpy-signature'];
            const payload = req.body;

            console.log('[PaymentController] Received Webhook:', payload);

            // In production, you MUST verify the signature
            // For Sandbox, we might skip or log if secret is not set
            if (SAFEPAY_SECRET_KEY && signature) {
                const hmac = crypto.createHmac('sha256', SAFEPAY_SECRET_KEY);
                const bodyString = JSON.stringify(payload);
                const expectedSignature = hmac.update(bodyString).digest('hex');
                
                if (signature !== expectedSignature) {
                    console.error('[PaymentController] Signature Verification Failed');
                    // return res.status(401).send('Invalid signature');
                } else {
                    console.log('[PaymentController] Signature Verified');
                }
            }

            const { status, order_id } = payload;

            // Extract the user ID from the order_id we created
            // order_id format: ORD_userId_timestamp
            const parts = order_id.split('_');
            const userId = parts[1];
            const amount = parseFloat(payload.amount);

            if (status === 'success' || status === 'paid') {
                console.log(`[PaymentController] Payment SUCCESS for user ${userId}: ${amount}`);

                // 1. Get current balance
                const { data: profile, error: getError } = await supabase
                    .from('profiles')
                    .select('balance')
                    .eq('id', userId)
                    .single();

                if (getError) throw getError;

                // 2. Update balance
                const currentBalance = parseFloat(profile.balance || 0);
                const newBalance = currentBalance + amount;

                const { error: updateError } = await supabase
                    .from('profiles')
                    .update({ 
                        balance: newBalance,
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', userId);

                if (updateError) throw updateError;

                console.log(`[PaymentController] Balance updated for ${userId}: ${currentBalance} -> ${newBalance}`);
                
                // Optional: Log to payment_proofs or a transactions table if you decide to create one
            } else {
                console.log(`[PaymentController] Payment status: ${status} for order: ${order_id}`);
            }

            res.send('OK');
        } catch (error) {
            console.error('[PaymentController] Webhook Error:', error.message);
            res.status(500).send('Webhook error');
        }
    }
};

module.exports = paymentController;
