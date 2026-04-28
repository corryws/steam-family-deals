const express = require('express');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const STEAM_KEY = '5C96F012772FF9309785A4F0055F784D';

app.use(express.static(path.join(__dirname, 'public')));

const MEMBERS = [
  { id: '76561198142803553', name: 'MrNieft', initials: 'NE' },
  { id: '76561198044574276', name: 'Boris', initials: 'BO' },
  { id: '76561198155403000', name: 'ErCipolla', initials: 'RI' },
  { id: '76561198093585873', name: 'ManushBlades', initials: 'MA' },
  { id: '76561198046999682', name: 'WaCagher', initials: 'WA' },
  { id: '76561198089183727', name: 'Ture', initials: 'TI' }, 
];

async function fetchUserWishlist(steamId) {
  try {
    const url = `https://api.steampowered.com/IWishlistService/GetWishlist/v1/?key=${STEAM_KEY}&steamid=${steamId}`;
    const response = await axios.get(url, { timeout: 10000 });
    return response.data?.response?.items || [];
  } catch (err) {
    return [];
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// NUOVO ENDPOINT: Fa tutto il lavoro sporco per il frontend
app.get('/api/summary', async (req, res) => {
  try {
    const gameCounter = {};
    const counts = {};

    for (const member of MEMBERS) {
      const items = await fetchUserWishlist(member.id);
      counts[member.name] = items.length;
      items.forEach(item => {
        const id = String(item.appid);
        if (!gameCounter[id]) gameCounter[id] = { count: 0, users: [] };
        gameCounter[id].count++;
        gameCounter[id].users.push(member);
      });
    }

    const commonIds = Object.keys(gameCounter).filter(id => gameCounter[id].count >= 1);

    const discounted = [];

    // Chiamate singole a gruppi di 5 in parallelo
    for (let i = 0; i < commonIds.length; i += 5) {
      const chunk = commonIds.slice(i, i + 5);
      await Promise.all(chunk.map(async id => {
        try {
          const url = `https://store.steampowered.com/api/appdetails?appids=${id}&cc=it`;
          const r = await axios.get(url, {
            timeout: 10000,
            headers: { 'User-Agent': 'Mozilla/5.0' }
          });
          const game = r.data?.[id]?.data;
          if (game?.price_overview?.discount_percent > 0) {
            discounted.push({
              id,
              name: game.name,
              discount_percent: game.price_overview.discount_percent,
              final_price: game.price_overview.final,
              original_price: game.price_overview.initial,
              members: gameCounter[id].users
            });
          }
        } catch {}
      }));
      await sleep(200);
    }

    discounted.sort((a, b) => b.discount_percent - a.discount_percent);
    res.json({ counts, totalCommon: commonIds.length, discounted });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
// Rotte standard per compatibilità
app.get('/api/members', (req, res) => res.json(MEMBERS));
app.get('/api/wishlist/:steamId', async (req, res) => {
  const items = await fetchUserWishlist(req.params.steamId);
  const filtered = {};
  items.forEach(i => filtered[i.appid] = i);
  res.json(filtered);
});
app.get('/api/deals', async (req, res) => {
  const r = await axios.get('https://store.steampowered.com/api/featuredcategories?cc=it');
  res.json(r.data);
});

app.get('/api/debug-prices', async (req, res) => {
  try {
    const url = `https://store.steampowered.com/api/appdetails?appids=252490,1091500&cc=it&filters=price_overview,name`;
    const r = await axios.get(url, {
      timeout: 15000,
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    res.json(r.data);
  } catch (err) {
    res.json({ error: err.message, status: err.response?.status });
  }
});

app.listen(PORT, () => console.log(`Server pronto su porta ${PORT}`));