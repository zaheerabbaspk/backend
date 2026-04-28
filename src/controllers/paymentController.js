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

            console.log('[PaymentController] Calling URL:', `${BASE_URL}/order/v1/init`);

            const fetchResponse = await fetch(`${BASE_URL}/order/v1/init`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${SAFEPAY_SECRET_KEY}`
                },
                body: JSON.stringify({
                    amount: parseFloat(amount),
                    currency: currency,
                    client_order_id: `ORD_${userId}_${Date.now()}`,
                    client: SAFEPAY_API_KEY,
                    environment: SAFEPAY_ENV,
                    metadata: {
                        "order_id": `ORD_${userId}_${Date.now()}`
                    },
                    redirect_url: "http://localhost:8100/home",
                    cancel_url: "http://localhost:8100/deposit"
                })
            });

            const responseData = await fetchResponse.json();
            console.log('[PaymentController] Safepay Response:', JSON.stringify(responseData));

            if (!fetchResponse.ok) {
                throw new Error(responseData.message || 'Safepay API Error');
            }

            const token = responseData.data?.token || responseData.token;
            let checkoutUrl = responseData.data?.redirect_url || responseData.redirect_url;

            if (!checkoutUrl && token) {
                const checkoutBase = SAFEPAY_ENV === 'sandbox' 
                    ? 'https://sandbox.api.getsafepay.com/checkout/pay' 
                    : 'https://api.getsafepay.com/checkout/pay';
                
                checkoutUrl = `${checkoutBase}?beacon=${token}&env=${SAFEPAY_ENV}&client=${SAFEPAY_API_KEY}`;
            }

            console.log('[PaymentController] Final Checkout URL:', checkoutUrl);

            if (checkoutUrl) {
                res.json({ 
                    url: checkoutUrl,
                    checkout_url: checkoutUrl 
                });
            } else {
                throw new Error('Failed to generate checkout URL');
            }
        } catch (error) {
            console.error('[PaymentController] Error:', error.message);
            res.status(500).json({ 
                error: 'Failed to initiate payment',
                details: error.message
            });
        }
    },

    handleWebhook: async (req, res) => {
        try {
            console.log('[Webhook] Received Safepay Webhook Payload:', JSON.stringify(req.body));
            
            // Safepay v1 webhook payload structure
            const status = req.body.status || req.body.state;
            const client_order_id = req.body.client_order_id || req.body.metadata?.order_id || req.body.order_id;
            const amount = req.body.amount;

            console.log('[Webhook] Debug Info:', { status, client_order_id, amount });

            // Check for various success indicators
            const isSuccess = status === 'success' || status === 'paid' || status === 'TRACKER_ENDED' || status === 'completed';

            if (isSuccess) {
                console.log('[Webhook] Transaction Success confirmed. Parsing order ID...');
                // client_order_id format: ORD_userId_timestamp
                const parts = (client_order_id || '').split('_');
                const userId = parts[1];

                if (!userId) {
                    console.error('[Webhook] Could not identify user from order_id:', client_order_id);
                    return res.status(200).send('OK but no user found');
                }

                console.log(`[Webhook] Success confirmed. Updating balance for User: ${userId}, Amount: ${amount}`);

                // 1. Fetch current profile
                const { data: profiles, error: fetchError } = await supabase
                    .from('profiles')
                    .select()
                    .eq('id', userId);

                if (fetchError) {
                    console.error('[Webhook] Database Error (Fetch):', fetchError.message);
                    throw fetchError;
                }

                if (!profiles || profiles.length === 0) {
                    console.error('[Webhook] No profile found for user:', userId);
                    return res.status(200).send('OK but no user found');
                }

                const profile = profiles[0];
                const currentBalance = parseFloat(profile.balance || 0);
                const depositAmount = parseFloat(amount || 0);
                const newBalance = currentBalance + depositAmount;

                // 2. Update balance
                const { error: updateError } = await supabase
                    .from('profiles')
                    .update({ 
                        balance: newBalance,
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', userId);

                if (updateError) {
                    console.error('[Webhook] Database Error (Update):', updateError.message);
                    throw updateError;
                }

                console.log(`[Webhook] Wallet Updated! User: ${userId} | New Balance: ${newBalance}`);
            } else {
                console.log(`[Webhook] Payment not successful yet. Status: ${status}`);
            }

            res.status(200).send('Webhook Processed Successfully');
        } catch (error) {
            console.error('[Webhook] Fatal Error:', error.message);
            res.status(500).send('Webhook processing failed');
        }
    }
};

module.exports = paymentController;
