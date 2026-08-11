import { HttpsProxyAgent } from 'https-proxy-agent';

const PROXY_URL = 'http://pkg-royal-country-any:jsewamsl1rrirlt9@standard.vital-proxies.com:8603';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only' });
  }

  const { token, useProxy } = req.body;
  if (!token) {
    return res.status(400).json({ error: 'Token required' });
  }

  try {
    const fetchOptions = {
      method: 'GET',
      headers: {
        'Authorization': token,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    };

    if (useProxy) {
      fetchOptions.agent = new HttpsProxyAgent(PROXY_URL);
    }

    const discordRes = await fetch('https://discord.com/api/v9/users/@me', fetchOptions);
    const body = await discordRes.json().catch(() => ({}));

    if (discordRes.status === 200) {
      return res.status(200).json({
        ok: true,
        username: body.username,
        global_name: body.global_name,
        discriminator: body.discriminator,
        id: body.id,
        avatar: body.avatar
      });
    }

    if (discordRes.status === 401) {
      return res.status(200).json({ ok: false, error: 'Invalid token — got 401 Unauthorized' });
    }

    if (discordRes.status === 403) {
      return res.status(200).json({ ok: false, error: 'Forbidden — token may be missing Bot prefix or scoped incorrectly' });
    }

    return res.status(200).json({ ok: false, error: `Discord returned HTTP ${discordRes.status}` });
  } catch (err) {
    return res.status(200).json({ ok: false, error: err.message });
  }
}