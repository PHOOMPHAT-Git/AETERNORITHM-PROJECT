function formatCount(n) {
    if (!Number.isFinite(n) || n <= 0) return '';
    if (n >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
    if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
    return String(n);
}

function parseFollowersString(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.round(value));
    const raw = String(value || '').trim().replace(/[, ]/g, '');
    if (!raw) return 0;
    const m = raw.match(/^([\d.]+)\s*([kmb])?$/i);
    if (!m) return 0;
    const n = parseFloat(m[1]);
    if (!Number.isFinite(n)) return 0;
    const suffix = (m[2] || '').toLowerCase();
    if (suffix === 'k') return Math.round(n * 1e3);
    if (suffix === 'm') return Math.round(n * 1e6);
    if (suffix === 'b') return Math.round(n * 1e9);
    return Math.round(n);
}

function parseYouTubeUrl(input) {
    let u;
    try {
        u = new URL(String(input || '').trim());
    } catch {
        return null;
    }
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    if (host !== 'youtube.com' && host !== 'm.youtube.com' && host !== 'youtu.be') return null;
    const parts = u.pathname.split('/').filter(Boolean);
    if (!parts.length) return null;
    if (parts[0] === 'channel' && parts[1]) return { type: 'id', value: parts[1] };
    if (parts[0].startsWith('@')) return { type: 'handle', value: parts[0] };
    if (parts[0] === 'user' && parts[1]) return { type: 'username', value: parts[1] };
    if (parts[0] === 'c' && parts[1]) return { type: 'custom', value: decodeURIComponent(parts[1]) };
    return null;
}

async function callApi(endpoint, params) {
    const apiKey = process.env.YOUTUBE;
    if (!apiKey) throw new Error('YOUTUBE API key is not configured');
    const url = new URL('https://www.googleapis.com/youtube/v3/' + endpoint);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    url.searchParams.set('key', apiKey);
    const res = await fetch(url);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        const msg = (data && data.error && data.error.message) || ('YouTube API error ' + res.status);
        throw new Error(msg);
    }
    return data;
}

async function resolveChannelId(parsed) {
    if (parsed.type === 'id') return parsed.value;
    if (parsed.type === 'handle') {
        const data = await callApi('channels', { part: 'id', forHandle: parsed.value });
        if (data.items && data.items[0]) return data.items[0].id;
    }
    if (parsed.type === 'username') {
        const data = await callApi('channels', { part: 'id', forUsername: parsed.value });
        if (data.items && data.items[0]) return data.items[0].id;
    }
    const search = await callApi('search', { part: 'snippet', type: 'channel', q: parsed.value, maxResults: '1' });
    if (search.items && search.items[0] && search.items[0].id && search.items[0].id.channelId) {
        return search.items[0].id.channelId;
    }
    return null;
}

async function fetchYouTubeChannel(url) {
    const parsed = parseYouTubeUrl(url);
    if (!parsed) throw new Error('Invalid YouTube URL');
    const channelId = await resolveChannelId(parsed);
    if (!channelId) throw new Error('Channel not found');
    const data = await callApi('channels', {
        part: 'snippet,statistics,brandingSettings',
        id: channelId
    });
    const item = data.items && data.items[0];
    if (!item) throw new Error('Channel not found');
    const snippet = item.snippet || {};
    const stats = item.statistics || {};
    const branding = item.brandingSettings || {};
    const subscribers = Number(stats.subscriberCount) || 0;
    const thumbs = snippet.thumbnails || {};
    const avatar = (thumbs.high && thumbs.high.url)
        || (thumbs.medium && thumbs.medium.url)
        || (thumbs.default && thumbs.default.url)
        || '';
    const banner = (branding.image && branding.image.bannerExternalUrl) || '';
    const handle = snippet.customUrl
        ? (snippet.customUrl.startsWith('@') ? snippet.customUrl : '@' + snippet.customUrl)
        : '';
    return {
        platform: 'youtube',
        name: snippet.title || '',
        handle,
        url: 'https://www.youtube.com/channel/' + channelId,
        avatar,
        banner,
        subscribers,
        followers: formatCount(subscribers)
    };
}

module.exports = {
    fetchYouTubeChannel,
    parseYouTubeUrl,
    parseFollowersString,
    formatCount
};
