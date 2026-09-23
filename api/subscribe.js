export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const { email, phone, preference } = req.body

    const url = process.env.SUPABASE_URL + '/rest/v1/subscribers'
    const key = process.env.SUPABASE_ANON_KEY

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': key,
        'Authorization': 'Bearer ' + key,
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({ email, phone, preference })
    })

    const text = await response.text()
    
    if (!response.ok) {
      return res.status(500).json({ error: text })
    }

    return res.status(200).json({ success: true })

  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}