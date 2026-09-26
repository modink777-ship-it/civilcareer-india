async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {}
    if (String(body.website || '').trim()) return res.status(200).json({ success: true })

    const email = String(body.email || '').trim().toLowerCase()
    const phone = String(body.phone || '').trim().slice(0, 30)
    const preference = String(body.preference || 'jobs').trim().slice(0, 80)

    if (email.length < 5 || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Enter a valid email address.' })
    }
    if (!['jobs', 'government', 'private', 'all'].includes(preference)) {
      return res.status(400).json({ error: 'Invalid alert preference.' })
    }

    const supabaseUrl = process.env.SUPABASE_URL
    const key = process.env.SUPABASE_ANON_KEY
    if (!supabaseUrl || !key) return res.status(503).json({ error: 'Subscription service is not configured.' })

    const response = await fetch(supabaseUrl + '/rest/v1/subscribers', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': key,
        'Authorization': 'Bearer ' + key,
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({ email, phone, preference })
    })

    if (!response.ok) {
      console.error('subscribe failed:', response.status)
      return res.status(response.status === 409 ? 409 : 502).json({ error: 'Unable to save your subscription right now.' })
    }

    res.setHeader('Cache-Control', 'no-store')
    return res.status(200).json({ success: true })
  } catch (e) {
    console.error('subscribe error:', e)
    return res.status(500).json({ error: 'Unable to save your subscription right now.' })
  }
}

module.exports = handler;
