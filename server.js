require('dotenv').config();
const express = require('express');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const STEAM_KEY = process.env.STEAM_KEY;

if (!STEAM_KEY) {
  console.error('❌ STEAM_KEY mancante! Crea un file .env con STEAM_KEY=la_tua_chiave');
  process.exit(1);
}

app.use(express.static(path.join(__dirname, 'public')));

const MEMBERS = [
  { id: '76561198142803553', name: 'MrNieft', initials: 'NE' },
  { id: '76561198044574276', name: 'Boris', initials: 'BO' },
  { id: '76561198155403000', name: 'ErCipolla', initials: 'RI' },
  { id: '76561198093585873', name: 'ManushBlades', initials: 'MA' },
  { id: '76561198093194853', name: 'WaCagher', initials: 'WA' },
  { id: '76561198089183727', name: 'Ture', initials: 'TI' },
];

// ── CACHE ────────────────────────────────────────────────────────────────────
let cacheData = { summary: null, wishlists: {}, lastUpdate: 0 };
let fetchingPromise = null;
const CACHE_DURATION = 15 * 60 * 1000;

const sleep = (ms) => new Promise(res => setTimeout(res, ms));

// ── STEAM HELPERS ─────────────────────────────────────────────────────────────
async function fetchUserWishlist(steamId) {
  try {
    const url = `https://api.steampowered.com/IWishlistService/GetWishlist/v1/?key=${STEAM_KEY}&steamid=${steamId}`;
    const response = await axios.get(url, { timeout: 15000 });
    return response.data?.response?.items || [];
  } catch (err) {
    console.error(`❌ Errore Steam per ${steamId}: ${err.message}`);
    return [];
  }
}

// ── SSE: stream offerte in tempo reale ────────────────────────────────────────
app.get('/api/deals-stream', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  // Serve dalla cache se fresca
  const now = Date.now();
  if (cacheData.summary && (now - cacheData.lastUpdate < CACHE_DURATION)) {
    console.log('🚀 Cache Hit: stream dalla cache');
    send('meta', { counts: cacheData.summary.counts, totalCommon: cacheData.summary.totalCommon });
    for (const game of cacheData.summary.discounted) {
      send('game', game);
    }
    send('done', { total: cacheData.summary.discounted.length, fromCache: true });
    return res.end();
  }

  // Altrimenti fetch live
  console.log('📡 Fetch live da Steam...');
  try {
    const gameCounter = {};
    const counts = {};
    const newWishlists = {};

    // 1. Scarica le wishlist
    for (const member of MEMBERS) {
      send('status', { msg: `Caricamento wishlist di ${member.name}...` });
      const items = await fetchUserWishlist(member.id);
      counts[member.name] = items.length;
      const formatted = {};
      items.forEach(item => {
        formatted[item.appid] = item;
        const id = String(item.appid);
        if (!gameCounter[id]) gameCounter[id] = { count: 0, users: [] };
        gameCounter[id].count++;
        gameCounter[id].users.push(member);
      });
      newWishlists[member.id] = formatted;
      await sleep(1500);
    }

    const allIds = Object.keys(gameCounter);
    send('meta', { counts, totalCommon: allIds.length });
    send('status', { msg: `Controllo prezzi su ${allIds.length} giochi...` });
    console.log(`📋 Wishlist scaricate. Giochi unici: ${allIds.length}`);
    Object.entries(counts).forEach(([name, c]) => console.log(`   ${name}: ${c} giochi`));

    // 2. Controlla i prezzi uno per uno con retry su rate limit
    const discounted = [];
    let checked = 0;
    let skipped = 0;
    let ratelimited = 0;

    for (let i = 0; i < allIds.length; i++) {
      if (req.destroyed) break;

      const id = allIds[i];
      checked++;

      let success = false;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const url = `https://store.steampowered.com/api/appdetails?appids=${id}&cc=it`;
          const r = await axios.get(url, { timeout: 15000, headers: { 'User-Agent': 'Mozilla/5.0' } });
          const steamData = r.data?.[id];

          if (steamData?.success && steamData.data) {
            const game = steamData.data;
            if (game.price_overview?.discount_percent > 0) {
              const entry = {
                id,
                name: game.name || 'Titolo sconosciuto',
                image: `https://cdn.cloudflare.steamstatic.com/steam/apps/${id}/header.jpg`,
                discount_percent: game.price_overview.discount_percent,
                final_price: game.price_overview.final_formatted,
                original_price: game.price_overview.initial_formatted,
                members: gameCounter[id].users,
              };
              discounted.push(entry);
              send('game', entry);
              console.log(`✅ ${game.name} -${game.price_overview.discount_percent}%`);
            }
            success = true;
            break;
          } else if (steamData?.success === false) {
            // Gioco rimosso o non disponibile in Italia, skip normale
            success = true;
            break;
          } else {
            // Risposta vuota = rate limit
            ratelimited++;
            console.warn(`⏳ Rate limit su ${id} (tentativo ${attempt + 1}/3), aspetto...`);
            await sleep(3000 * (attempt + 1));
          }
        } catch (e) {
          console.error(`⚠️ Errore ${id}: ${e.message}`);
          await sleep(2000);
        }
      }
      if (!success) skipped++;

      // Progress ogni 10 giochi
      if (checked % 10 === 0 || checked === allIds.length) {
        send('progress', { checked, total: allIds.length });
        console.log(`📊 ${checked}/${allIds.length} — offerte: ${discounted.length} — rate limited: ${ratelimited} — saltati: ${skipped}`);
      }

      // Pausa tra richieste: 400ms normalmente, 2s ogni 20 giochi
      await sleep(checked % 20 === 0 ? 2000 : 400);
    }

    // 3. Salva in cache e manda done
    discounted.sort((a, b) => b.discount_percent - a.discount_percent);
    cacheData = {
      summary: { counts, totalCommon: allIds.length, discounted },
      wishlists: newWishlists,
      lastUpdate: Date.now(),
    };

    send('done', { total: discounted.length, fromCache: false });
    res.end();
  } catch (err) {
    send('error', { msg: err.message });
    res.end();
  }
});

// ── REST endpoints ────────────────────────────────────────────────────────────
app.get('/api/wishlist/:steamId', (req, res) => {
  res.json(cacheData.wishlists[req.params.steamId] || {});
});

app.get('/api/members', (req, res) => res.json(MEMBERS));

// Debug: controlla quante wishlist sono pubbliche
app.get('/api/debug-wishlists', async (req, res) => {
  console.log('Debug wishlist...');
  const results = [];
  for (const member of MEMBERS) {
    const items = await fetchUserWishlist(member.id);
    const result = {
      name: member.name,
      id: member.id,
      count: items.length,
      status: items.length > 0 ? 'pubblica' : 'vuota o privata'
    };
    console.log(`${member.name}: ${items.length} giochi — ${result.status}`);
    results.push(result);
    await sleep(1000);
  }
  res.json(results);
});

app.listen(PORT, () => console.log(`Server su porta ${PORT}`));
