const supabase = require('../config/supabase');

async function createTable() {
  console.log('Creating manual_deposits table...');
  
  const { error } = await supabase.rpc('exec_sql', {
    sql_string: `
      CREATE TABLE IF NOT EXISTS manual_deposits (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        user_id UUID REFERENCES auth.users(id),
        user_email TEXT,
        amount DECIMAL(12, 2),
        transaction_id TEXT,
        proof_url TEXT,
        method TEXT,
        status TEXT DEFAULT 'pending',
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now()
      );
    `
  });

  if (error) {
    // If rpc fails, it might be because exec_sql doesn't exist. 
    // Usually in managed Supabase we can't run arbitrary SQL via RPC unless defined.
    console.error('Error creating table via RPC:', error.message);
    console.log('Please create the table manually in Supabase SQL Editor if this fails.');
  } else {
    console.log('Table manual_deposits created successfully!');
  }
}

createTable();
