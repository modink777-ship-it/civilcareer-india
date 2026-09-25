module.exports=async(req,res)=>{
  if(req.method!=='GET')return res.status(405).json({error:'Method not allowed.'});
  res.setHeader('Cache-Control','no-store');
  const url=process.env.SUPABASE_URL,anon=process.env.SUPABASE_ANON_KEY;
  if(!url||!anon)return res.status(503).json({error:'Authentication is not configured.'});
  res.status(200).json({url,anonKey:anon});
}
