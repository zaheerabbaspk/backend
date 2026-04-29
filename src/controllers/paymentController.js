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
                    reference: `ORD_${userId}_${Date.now()}`,
                    client: SAFEPAY_API_KEY,
                    environment: SAFEPAY_ENV,
                    metadata: {
                        "userId": userId,
                        "order_id": `ORD_${userId}_${Date.now()}`
                    },
                    source: userId,
                    custom_field: userId,
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
            console.log('[Webhook] Received Safepay Webhook Payload Keys:', Object.keys(req.body));
            console.log('[Webhook] Received Safepay Webhook Payload:', JSON.stringify(req.body));
            
            // Handle both Safepay v1 and v2 structures
            const status = req.body.status || req.body.state || req.body.data?.state || req.body.tracker?.state || req.body.data?.status;
            const amount = req.body.amount || req.body.data?.amount || req.body.tracker?.amount;
            
            // Search everywhere for client_order_id or userId
            let client_order_id = req.body.reference || req.body.data?.reference || req.body.client_order_id || req.body.metadata?.order_id || req.body.data?.metadata?.userId;
            let directUserId = req.body.userId || req.body.metadata?.userId || req.body.data?.metadata?.userId || req.body.data?.userId;
            
            if (!client_order_id && !directUserId) {
                // Recursive search for ORD_ pattern or userId
                const findData = (obj) => {
                    if (!obj || typeof obj !== 'object') return null;
                    for (const key in obj) {
                        const val = obj[key];
                        if (key === 'userId' || key === 'user_id') return { userId: val };
                        if (typeof val === 'string' && val.startsWith('ORD_')) return { orderId: val };
                        if (typeof val === 'object') {
                            const found = findData(val);
                            if (found) return found;
                        }
                    }
                    return null;
                };
                const found = findData(req.body);
                if (found?.userId) directUserId = found.userId;
                if (found?.orderId) client_order_id = found.orderId;
            }

            console.log('[Webhook] Debug Info:', { status, client_order_id, directUserId, amount });

            // Check for various success indicators
            const isSuccess = 
                status === 'success' || 
                status === 'paid' || 
                status === 'PAID' || 
                status === 'TRACKER_ENDED' || 
                status === 'completed';

            if (isSuccess && (client_order_id || directUserId)) {
                console.log('[Webhook] Transaction Success confirmed. Parsing user ID...');
                const parts = (client_order_id || '').split('_');
                let userId = directUserId || (parts.length > 1 ? parts[1] : parts[0]);

                if (!userId || userId === 'ORD') {
                    console.error('[Webhook] Still no valid userId found. Full Payload for debugging:', JSON.stringify(req.body));
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
            res.status(500).json({ error: error.message });
        }
    },

    submitManualDeposit: async (req, res) => {
        try {
            const { userId, userEmail, amount, transactionId, method } = req.body;
            const file = req.file;

            console.log('[ManualDeposit] Received:', { userId, userEmail, amount, transactionId });

            if (!file) {
                return res.status(400).json({ error: 'No proof file uploaded' });
            }

            // 1. Upload file to Supabase Storage
            const fileName = `proofs/${userId}_${Date.now()}_${file.originalname}`;
            const { data: uploadData, error: uploadError } = await supabase.storage
                .from('aviator-jeet')
                .upload(fileName, file.buffer, {
                    contentType: file.mimetype,
                    upsert: true
                });

            if (uploadError) {
                console.error('[ManualDeposit] Upload Error:', uploadError.message);
                throw uploadError;
            }

            // Get public URL
            const { data: { publicUrl } } = supabase.storage
                .from('aviator-jeet')
                .getPublicUrl(fileName);

            // 2. Save to manual_deposits table
            const { data, error: insertError } = await supabase
                .from('manual_deposits')
                .insert([{
                    user_id: userId,
                    user_email: userEmail,
                    amount: parseFloat(amount),
                    transaction_id: transactionId,
                    proof_url: publicUrl,
                    method: method,
                    status: 'pending'
                }]);

            if (insertError) {
                console.error('[ManualDeposit] Insert Error:', insertError.message);
                throw insertError;
            }

            res.status(200).json({ 
                message: 'Manual deposit submitted successfully',
                data: data 
            });
        } catch (error) {
            console.error('[ManualDeposit] Error:', error.message);
            res.status(500).json({ 
                error: 'Failed to submit manual deposit',
                details: error.message
            });
        }
    }
};

module.exports = paymentController;
