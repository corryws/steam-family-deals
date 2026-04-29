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
                  image: `https://capsule_main.cea.com/steam/apps/${id}/header.jpg`, // AGGIUNGI QUESTA
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
      await sleep(1000);
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

app.get('/api/wishlist/:steamId', (req, res) => {
  res.json(cacheData.wishlists[req.params.steamId] || {});
});

app.get('/api/members', (req, res) => res.json(MEMBERS));

app.listen(PORT, () => console.log(`✅ Server corazzato su porta ${PORT}`));


/* const express = require('express');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const STEAM_KEY = '5C96F012772FF9309785A4F0055F784D';

// Aggiungi queste due variabili in alto nel file per salvare i dati in memoria
let cacheSummary = null;
let lastCacheTime = 0;
const CACHE_DURATION = 15 * 60 * 1000; // 15 minuti di pausa tra un controllo e l'altro

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
        const response = await axios.get(url, { timeout: 15000 });
        const items = response.data?.response?.items || [];
        
        // DEBUG: Se Steam risponde vuoto, lo scriviamo in console per capire
        if (items.length === 0) console.log(`⚠️ Wishlist vuota o bloccata per ${steamId}`);
        
        return items;
    } catch (err) {
        console.error(`❌ Errore Steam API per ${steamId}:`, err.message);
        return [];
    }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}


app.get('/api/summary', async (req, res) => {
    const now = Date.now();

    // SE ABBIAMO DATI RECENTI IN CACHE, MANDIAMO QUELLI SENZA ROMPERE A STEAM
    if (cacheSummary && (now - lastCacheTime < CACHE_DURATION)) {
        console.log("🚀 Servendo dati dalla cache (nessuna chiamata a Steam)");
        return res.json(cacheSummary);
    }

    try {
        console.log("📡 Recupero nuovi dati da Steam...");
        const gameCounter = {};
        const counts = {};

        // Scarichiamo le wishlist una alla volta (non in parallelo per non far incazzare Steam)
        for (const member of MEMBERS) {
            const items = await fetchUserWishlist(member.id);
            counts[member.name] = items.length;
            items.forEach(item => {
                const id = String(item.appid);
                if (!gameCounter[id]) gameCounter[id] = { count: 0, users: [] };
                gameCounter[id].count++;
                gameCounter[id].users.push(member);
            });
            await sleep(500); // Mezzo secondo di pausa tra un amico e l'altro
        }

        // Filtriamo i giochi (almeno 1 persona)
        const commonIds = Object.keys(gameCounter).filter(id => gameCounter[id].count >= 1);
        const discounted = [];

        // Controlliamo i prezzi a blocchi piccoli
        for (let i = 0; i < commonIds.length; i += 5) {
            const chunk = commonIds.slice(i, i + 5);
            await Promise.all(chunk.map(async id => {
                try {
                    const url = `https://store.steampowered.com/api/appdetails?appids=${id}&cc=it&filters=price_overview,name`;
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
                            final_price: game.price_overview.final_formatted || (game.price_overview.final / 100).toFixed(2) + "€",
                            original_price: game.price_overview.initial_formatted || (game.price_overview.initial / 100).toFixed(2) + "€",
                            members: gameCounter[id].users
                        });
                    }
                } catch (e) {}
            }));
            await sleep(1000); // Un secondo intero di pausa tra i blocchi di prezzi
        }

        discounted.sort((a, b) => b.discount_percent - a.discount_percent);

        // SALVIAMO IN CACHE
        cacheSummary = { counts, totalCommon: commonIds.length, discounted };
        lastCacheTime = now;

        res.json(cacheSummary);
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

app.listen(PORT, () => console.log(`Server pronto su porta ${PORT}`)); */