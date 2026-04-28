const express = require('express');
const axios = require('axios');
const path = require('path');
const app = express();

app.use(express.static(path.join(__dirname, 'public')));

const MEMBERS = [
  { id: '76561198142803553', name: 'Neft97', initials: 'NE' },
  { id: '76561198044574276', name: 'ZangetsuKnight', initials: 'ZK' },
  { id: '76561198155403000', name: 'Riky68', initials: 'RI' },
  { id: '76561198093585873', name: 'Manush97', initials: 'MA' },
  { id: '76561198046999682', name: 'walger_', initials: 'WA' },
];

app.get('/api/wishlist/:steamId', async (req, res) => {
  try {
    const { steamId } = req.params;
    const url = `https://api.steampowered.com/IWishlistService/GetWishlist/v1/?key=${process.env.STEAM_KEY || '5C96F012772FF9309785A4F0055F784D'}&steamid=${steamId}`;
    const response = await axios.get(url, { timeout: 10000 });

    const items = response.data?.response?.items || [];
    const filtered = {};
    items.forEach(item => {
      filtered[String(item.appid)] = item;
    });

    res.json(filtered);
  } catch (err) {
    res.json({});
  }
});

app.get('/api/debug/:steamId', async (req, res) => {
  const { steamId } = req.params;
  const url = `https://store.steampowered.com/wishlist/profiles/${steamId}/wishlistdata/?p=0`;
  const response = await axios.get(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    timeout: 10000,
    responseType: 'text',
  });
  res.send(response.data.substring(0, 300));
});


app.get('/api/deals', async (req, res) => {
  try {
    const url = 'https://store.steampowered.com/api/featuredcategories?cc=it&l=italian';
    const response = await axios.get(url, { timeout: 10000 });
    res.json(response.data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/members', (req, res) => {
  res.json(MEMBERS);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server avviato su porta ${PORT}`));