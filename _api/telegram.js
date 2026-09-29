/**
 * CivilCareer — Telegram Auto-Post API
 * Call this after saving a new job to auto-post to Telegram channel
 * Env vars needed: TELEGRAM_BOT_TOKEN, TELEGRAM_CHANNEL_ID
 */
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const key = req.headers['x-owner-key'] || '';
  if (key !== process.env.OWNER_KEY) return res.status(401).json({ error: 'Unauthorized' });

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const channel = process.env.TELEGRAM_CHANNEL_ID || '@CivilCareerIndiaJobs';

  if (!token) return res.status(400).json({ error: 'Telegram bot not configured' });

  let body = req.body || {};
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch(e) { body = {}; } }

  const { job } = body;
  if (!job) return res.status(400).json({ error: 'No job provided' });

  const closed = job.deadline && new Date(job.deadline + 'T23:59:59') < new Date();
  const daysLeft = job.deadline && !closed
    ? Math.ceil((new Date(job.deadline + 'T23:59:59') - new Date()) / 86400000)
    : null;

  const msg = [
    `🆕 *New Job Alert — CivilCareer*`,
    ``,
    `*${job.role || 'Civil Engineering Opportunity'}*`,
    `🏢 ${job.company || 'Organization'}`,
    job.location ? `📍 ${job.location}` : null,
    job.salary ? `💰 ${job.salary}` : null,
    job.qualification ? `🎓 ${job.qualification}` : null,
    daysLeft !== null ? `⏰ Deadline: ${job.deadline} (${daysLeft}d left)` : null,
    ``,
    job.source_url || job.apply_url
      ? `🔗 [View & Apply](${job.apply_url || job.source_url})`
      : `🔗 [Browse Jobs](https://civilcareer-india-two.vercel.app/private-jobs)`,
    ``,
    `⚠️ _Never pay for a job. Always verify the official notification._`,
    ``,
    `📢 @CivilCareerIndiaJobs`
  ].filter(Boolean).join('\n');

  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: channel,
        text: msg,
        parse_mode: 'Markdown',
        disable_web_page_preview: false
      })
    });

    if (!r.ok) {
      const e = await r.text();
      return res.status(500).json({ error: 'Telegram send failed', detail: e });
    }

    return res.status(200).json({ success: true, message: 'Posted to Telegram' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
