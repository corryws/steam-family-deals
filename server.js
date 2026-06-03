require('dotenv').config();
const express = require('express');
const axios = require('axios');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const STEAM_KEY = process.env.STEAM_KEY;
const CACHE_FILE = path.join(__dirname, 'cache.json');

if (!STEAM_KEY) {
  console.error('❌ STEAM_KEY mancante!');
  process.exit(1);
}

app.use(express.static(path.join(__dirname, 'public')));

const MEMBERS = JSON.parse(process.env.MEMBERS);

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── STATO SCANSIONE ───────────────────────────────────────────────────────────
let scanState = {
  running: false,
  checked: 0,
  total: 0,
  deals: 0,
  status: 'idle',   // idle | running | done | error
  message: '',
  startedAt: null,
};

// ── CACHE SU FILE ─────────────────────────────────────────────────────────────
function loadCache() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const data = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
      console.log(`📦 Cache caricata: ${data.discounted?.length} offerte, ${data.fullPrice?.length} a prezzo pieno`);
      return data;
    }
  } catch (e) {
    console.warn('⚠️ Cache file corrotta, ignoro:', e.message);
  }
  return null;
}

function saveCache(data) {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(data), 'utf8');
    console.log('💾 Cache salvata su file.');
  } catch (e) {
    console.warn('⚠️ Impossibile salvare cache:', e.message);
  }
}

let cache = loadCache();

// ── SCANSIONE IN BACKGROUND ───────────────────────────────────────────────────
async function fetchUserWishlist(steamId) {
  try {
    const url = `https://api.steampowered.com/IWishlistService/GetWishlist/v1/?key=${STEAM_KEY}&steamid=${steamId}`;
    const r = await axios.get(url, { timeout: 15000 });
    return r.data?.response?.items || [];
  } catch (e) {
    console.error(`❌ Wishlist ${steamId}: ${e.message}`);
    return [];
  }
}

async function runScan() {
  if (scanState.running) return;

  scanState = { running: true, checked: 0, total: 0, deals: 0, status: 'running', message: 'Caricamento wishlist...', startedAt: Date.now() };
  console.log('🔍 Scansione avviata...');

  try {
    // 1. Scarica wishlist
    const gameCounter = {};
    const counts = {};
    for (const member of MEMBERS) {
      scanState.message = `Caricamento wishlist di ${member.name}...`;
      const items = await fetchUserWishlist(member.id);
      counts[member.name] = items.length;
      items.forEach(item => {
        const id = String(item.appid);
        if (!gameCounter[id]) gameCounter[id] = { count: 0, users: [] };
        gameCounter[id].count++;
        gameCounter[id].users.push(member);
      });
      console.log(`  ${member.name}: ${items.length} giochi`);
      await sleep(1000);
    }

    // Fetch avatar e displayname per ogni membro
    scanState.message = 'Recupero profili Steam...';
    try {
      const ids = MEMBERS.map(m => m.id).join(',');
      const profileUrl = `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${STEAM_KEY}&steamids=${ids}`;
      const profileRes = await axios.get(profileUrl, { timeout: 10000 });
      const players = profileRes.data?.response?.players || [];
      players.forEach(p => {
        const member = MEMBERS.find(m => m.id === p.steamid);
        if (member) {
          member.avatar = p.avatarmedium || p.avatar || null;
          member.displayName = p.personaname || member.name;
        }
      });
      console.log('🖼️ Avatar caricati');
    } catch(e) {
      console.warn('⚠️ Errore avatar:', e.message);
    }

    const allIds = Object.keys(gameCounter);
    scanState.total = allIds.length;
    scanState.message = `Controllo prezzi su ${allIds.length} giochi...`;
    console.log(`📋 Giochi unici: ${allIds.length}`);

    // 2. Controlla prezzi
    const discounted = [];
    const fullPrice = [];

    for (let i = 0; i < allIds.length; i++) {
      const id = allIds[i];
      scanState.checked = i + 1;

      let success = false;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const url = `https://store.steampowered.com/api/appdetails?appids=${id}&cc=it&l=italian`;
          const r = await axios.get(url, { timeout: 15000, headers: { 'User-Agent': 'Mozilla/5.0' } });
          const steamData = r.data?.[id];

          if (steamData?.success && steamData.data) {
            const game = steamData.data;
            const discount = game.price_overview?.discount_percent || 0;
            const entry = {
              id,
              name: game.name || 'Titolo sconosciuto',
              image: `https://cdn.cloudflare.steamstatic.com/steam/apps/${id}/header.jpg`,
              discount_percent: discount,
              final_price: game.price_overview?.final_formatted || null,
              original_price: game.price_overview?.initial_formatted || null,
              is_free: game.is_free || false,
              members: gameCounter[id].users,
            };
            if (discount > 0) {
              discounted.push(entry);
              scanState.deals = discounted.length;
              console.log(`✅ ${game.name} -${discount}%`);
            } else {
              fullPrice.push(entry);
            }
            success = true;
            break;
          } else if (steamData?.success === false) {
            success = true;
            break;
          } else {
            console.warn(`⏳ Rate limit su ${id} (tentativo ${attempt + 1}/3)`);
            await sleep(5000 * (attempt + 1));
          }
        } catch (e) {
          // 429 = rate limit esplicito, aspetta di più
          if (e.response?.status === 429) {
            console.warn(`⏳ 429 su ${id} (tentativo ${attempt + 1}/3), aspetto ${10 * (attempt + 1)}s...`);
            await sleep(10000 * (attempt + 1));
          } else {
            console.error(`⚠️ ${id}: ${e.message}`);
            await sleep(2000);
          }
        }
      }

      if ((i + 1) % 20 === 0) {
        console.log(`📊 ${i + 1}/${allIds.length} — offerte: ${discounted.length}`);
      }
      // Pausa base: 600ms, ogni 20 giochi 3s per non fare arrabbiare Steam
      await sleep((i + 1) % 20 === 0 ? 3000 : 600);
    }

    // 3. Salva
    discounted.sort((a, b) => b.discount_percent - a.discount_percent);
    fullPrice.sort((a, b) => a.name.localeCompare(b.name));

    const newCache = {
      counts,
      totalIds: allIds.length,
      discounted,
      fullPrice,
      updatedAt: Date.now(),
      profiles: MEMBERS.map(m => ({
        id: m.id,
        name: m.name,
        initials: m.initials,
        avatar: m.avatar || null,
        displayName: m.displayName || m.name,
      })),
    };

    if (fullPrice.length > 5 || discounted.length > 0) {
      cache = newCache;
      saveCache(cache);
      scanState = { running: false, checked: allIds.length, total: allIds.length, deals: discounted.length, status: 'done', message: 'Scansione completata', startedAt: scanState.startedAt };
      console.log(`✅ Scansione completata: ${discounted.length} offerte, ${fullPrice.length} a prezzo pieno`);
    } else {
      scanState = { running: false, checked: allIds.length, total: allIds.length, deals: 0, status: 'error', message: 'Scansione fallita (Steam ha bloccato le richieste), riprova tra qualche minuto', startedAt: scanState.startedAt };
      console.warn('⚠️ Scansione sospetta, cache non aggiornata');
    }

  } catch (e) {
    console.error('❌ Errore scansione:', e.message);
    scanState = { running: false, checked: 0, total: 0, deals: 0, status: 'error', message: `Errore: ${e.message}`, startedAt: null };
  }
}

// ── API ───────────────────────────────────────────────────────────────────────

// Dati correnti (dalla cache)
app.get('/api/data', (req, res) => {
  res.json({
    cache: cache || null,
    scan: scanState,
  });
});

// Avvia scansione
app.post('/api/scan', (req, res) => {
  if (scanState.running) {
    return res.json({ ok: false, message: 'Scansione già in corso' });
  }
  runScan(); // fire and forget
  res.json({ ok: true, message: 'Scansione avviata' });
});

// Stato scansione (polling)
app.get('/api/scan/status', (req, res) => {
  res.json(scanState);
});

app.get('/api/members', (req, res) => res.json(MEMBERS));

// Profili aggiornati con avatar (inclusi nella cache)
app.get('/api/profiles', (req, res) => {
  res.json(MEMBERS.map(m => ({
    id: m.id,
    name: m.name,
    initials: m.initials,
    avatar: m.avatar || null,
    displayName: m.displayName || m.name,
  })));
});

app.listen(PORT, () => console.log(`✅ Server su porta ${PORT}`));
