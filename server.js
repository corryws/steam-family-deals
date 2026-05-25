const express = require('express');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const STEAM_KEY = process.env.STEAM_KEY;

app.use(express.static(path.join(__dirname, 'public')));

const MEMBERS = [
  { id: '76561198142803553', name: 'MrNieft', initials: 'NE' },
  { id: '76561198044574276', name: 'Boris', initials: 'BO' },
  { id: '76561198155403000', name: 'ErCipolla', initials: 'RI' },
  { id: '76561198093585873', name: 'ManushBlades', initials: 'MA' },
  { id: '76561198093194853', name: 'WaCagher', initials: 'WA' },
  { id: '76561198089183727', name: 'Ture', initials: 'TI' }, 
];

// CACHE UNIFICATA
let cacheData = {
    summary: null,
    wishlists: {},
    lastUpdate: 0
};
const CACHE_DURATION = 15 * 60 * 1000;

const sleep = (ms) => new Promise(res => setTimeout(res, ms));

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

app.get('/api/summary', async (req, res) => {
  const now = Date.now();
  
  // Controllo cache corretto
  if (cacheData.summary && (now - cacheData.lastUpdate < CACHE_DURATION)) {
    console.log("🚀 Cache Hit: Dati inviati istantaneamente");
    return res.json(cacheData.summary);
  }

  console.log("📡 Cache Scaduta: Interrogo Steam (sarà lento)...");
  try {
    const gameCounter = {};
    const counts = {};
    const newWishlists = {};

    for (const member of MEMBERS) {
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
      await sleep(2000); 
    }

    const commonIds = Object.keys(gameCounter).filter(id => gameCounter[id].count >= 1);
    const discounted = [];

    for (let i = 0; i < commonIds.length; i += 5) {
      const chunk = commonIds.slice(i, i + 5);
      await Promise.all(chunk.map(async id => {
        try {
          // RIMOSSI I FILTRI: Chiediamo tutto così non ha scuse per il nome
          const url = `https://store.steampowered.com/api/appdetails?appids=${id}&cc=it`;
          const r = await axios.get(url, { timeout: 10000, headers: { 'User-Agent': 'Mozilla/5.0' } });
          
          const steamData = r.data?.[id];
          
          if (steamData?.success && steamData.data) {
            const game = steamData.data;
            
            // Controlliamo se è in offerta
            if (game.price_overview && game.price_overview.discount_percent > 0) {
              const gameName = game.name || "Gioco senza nome";
              
              console.log(`✅ Trovato: ${gameName} (${id})`);

              /* discounted.push({
                id: id,
                name: gameName,
                discount_percent: game.price_overview.discount_percent,
                final_price: game.price_overview.final_formatted,
                original_price: game.price_overview.initial_formatted,
                members: gameCounter[id].users
              }); */
              discounted.push({
                  id: id,
                  name: gameName,
                  image: `https://cdn.akamai.steamstatic.com/steam/apps/${id}/header.jpg`, // AGGIUNGI QUESTA
                  discount_percent: game.price_overview.discount_percent,
                  final_price: game.price_overview.final_formatted,
                  original_price: game.price_overview.initial_formatted,
                  members: gameCounter[id].users
              });
            }
          }
        } catch (e) {
            console.error(`Errore API per ID ${id}`);
        }
      }));
      await sleep(2000);
    }

    discounted.sort((a, b) => b.discount_percent - a.discount_percent);
    
    cacheData = {
        summary: { counts, totalCommon: commonIds.length, discounted },
        wishlists: newWishlists,
        lastUpdate: now
    };

    res.json(cacheData.summary);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/debug-prices', async (req, res) => {
  try {
    const url = `https://store.steampowered.com/api/appdetails?appids=252490&cc=it`;
    const r = await axios.get(url, { timeout: 15000, headers: { 'User-Agent': 'Mozilla/5.0' } });
    res.json(r.data);
  } catch (err) {
    res.json({ error: err.message, status: err.response?.status });
  }
});

app.get('/api/wishlist/:steamId', (req, res) => {
  res.json(cacheData.wishlists[req.params.steamId] || {});
});

app.get('/api/members', (req, res) => res.json(MEMBERS));

app.listen(PORT, () => console.log(`✅ Server corazzato su porta ${PORT}`));