import { HttpsProxyAgent } from 'https-proxy-agent';

const PROXY_URL = 'http://pkg-royal-country-any:jsewamsl1rrirlt9@standard.vital-proxies.com:8603';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only' });
  }

  const { username, token, password, useProxy } = req.body;

  if (!username || !token || !password) {
    return res.status(400).json({ error: 'Missing fields' });
  }

  let lastError = null;
  const maxRetries = 2;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const fetchOptions = {
        method: 'PATCH',
        headers: {
          'Authorization': token,
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'X-Super-Properties': 'eyJvcyI6IldpbmRvd3MiLCJicm93c2VyIjoiQ2hyb21lIiwiZGV2aWNlIjoiIiwic3lzdGVtX2xvY2FsZSI6ImVuLVVTIiwiYnJvd3Nlcl91c2VyX2FnZW50IjoiTW96aWxsYS81LjAgKFdpbmRvd3MgTlQgMTAuMDsgV2luNjQ7IHg2NCkgQXBwbGVXZWJLaXQvNTM3LjM2IChLSHRNTCwgbGlrZSBHZWNrbykgQ2hyb21lLzEyMC4wLjAuMCBTYWZhcmIvNTM3LjM2IiwiYnJvd3Nlcl92ZXJzaW9uIjoiMTIwLjAuMC4wIiwib3NfdmVyc2lvbiI6IjEwIiwicmVmZXJyZXIiOiIiLCJyZWZlcnJpbmdfZG9tYWluIjoiIiwicmVmZXJyZXJfY3VycmVudCI6IiIsInJlZmVycmluZ19kb21haW5fY3VycmVudCI6IiIsInJlbGVhc2VfY2hhbm5lbCI6InN0YWJsZSIsImNsaWVudF9idWlsZF9udW1iZXIiOjI1MjgzNSwiY2xpZW50X2V2ZW50X3NvdXJjZSI6bnVsbCwiZGVzaWduX2lkIjowfQ=='
        },
        body: JSON.stringify({ username, password })
      };

      if (useProxy) {
        fetchOptions.agent = new HttpsProxyAgent(PROXY_URL);
      }

      const discordRes = await fetch('https://discord.com/api/v9/users/@me', fetchOptions);

      const body = await discordRes.json().catch(() => ({}));

      // Success — available
      if (discordRes.status === 200) {
        return res.status(200).json({ status: 'AVAILABLE', username });
      }

      // Bad request — parse error
      if (discordRes.status === 400) {
        const msg = body.message || '';
        const errs = body.errors || {};
        const unameErrs = errs.username?._errors || [];
        const unameMsg = unameErrs[0]?.message || '';

        if (unameMsg.includes('taken') || unameMsg.includes('USERNAME_TOO_MANY_USERS') || msg.includes('taken')) {
          return res.status(200).json({ status: 'TAKEN', username });
        }
        if (unameMsg.includes('invalid') || unameMsg.includes('Invalid') || body.code === 50035) {
          return res.status(200).json({ status: 'INVALID', username, detail: unameMsg || msg });
        }
        return res.status(200).json({ status: 'ERROR', username, code: body.code, detail: unameMsg || msg || 'Unknown 400 error' });
      }

      // Rate limited
      if (discordRes.status === 429) {
        const retryAfter = discordRes.headers.get('retry-after');
        return res.status(200).json({ status: 'RATE_LIMITED', username, retryAfter: retryAfter ? parseInt(retryAfter, 10) : 5 });
      }

      // Auth failure
      if (discordRes.status === 401 || discordRes.status === 403) {
        return res.status(200).json({ status: 'UNAUTHORIZED', username, httpStatus: discordRes.status });
      }

      // Transient server errors — retry
      if ([500, 502, 503, 504].includes(discordRes.status) && attempt < maxRetries) {
        lastError = { status: discordRes.status, detail: body.message || 'Discord server error' };
        await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
        continue;
      }

      // Everything else
      return res.status(200).json({
        status: 'HTTP_ERROR',
        username,
        httpStatus: discordRes.status,
        detail: body.message || body.retry_after ? `Rate limited (retry: ${body.retry_after}s)` : 'Unknown error'
      });

    } catch (err) {
      lastError = { status: 0, detail: err.message };
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
        continue;
      }
      return res.status(200).json({ status: 'NETWORK_ERROR', username, message: err.message });
    }
  }

  // All retries exhausted
  return res.status(200).json({
    status: 'HTTP_ERROR',
    username,
    httpStatus: lastError?.status || 0,
    detail: lastError?.detail || 'Max retries exceeded'
  });
}