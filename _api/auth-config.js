module.exports=async(req,res)=>{
  if(req.method!=='GET')return res.status(405).json({error:'Method not allowed.'});
  res.setHeader('Cache-Control','no-store');
  /* Public aliases take precedence so a restricted/prefixed key can be served
     to browsers while server handlers keep using the full credentials. */
  const url=process.env.SUPABASE_PUBLIC_URL||process.env.SUPABASE_URL;
  const anon=process.env.SUPABASE_PUBLIC_ANON_KEY||process.env.SUPABASE_ANON_KEY;
  if(!url||!anon)return res.status(503).json({error:'Authentication is not configured.'});
  res.status(200).json({url,anonKey:anon});
}
