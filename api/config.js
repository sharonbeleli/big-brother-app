// Public client config only (anon key is designed to be public; RLS protects data). Never expose the service role key.
module.exports = (req, res) => {
  res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store');
  res.status(200).send(JSON.stringify({ url: process.env.SUPABASE_URL || null, anonKey: process.env.SUPABASE_ANON_KEY || null }));
};
