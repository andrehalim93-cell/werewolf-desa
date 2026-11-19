// server.js - WEREWOLF FULL - copy paste utuh
require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.https://iisxxgaihgtcuzynjcus.supabase.co/rest/v1/, process.env.sb_publishable_y2IpdW-81zOi5qha15J0Ew_OTmhdrNA);

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/health', (req, res) => res.send('OK'));
app.get('/ping', (req, res) => res.send('pong'));

// ===== AUTH - WEREWOLF - tabel werewolf_users =====
app.post('/api/register', async (req, res) => {
  try {
    const { id, password, display_name } = req.body || {};
    if(!id || id.length < 3 || id.length > 20) return res.json({ ok:false, msg:'ID harus 3-20 karakter' });
    if(!password || password.length < 4) return res.json({ ok:false, msg:'Password minimal 4 karakter' });
    const { data: exist } = await supabase.from('werewolf_users').select('id').eq('id', id).maybeSingle();
    if(exist) return res.json({ ok:false, msg:'ID udah dipake!' });
    const hash = await bcrypt.hash(password, 10);
    const { error } = await supabase.from('werewolf_users').insert({ id, password: hash, display_name: display_name || id, avatar: '🧑' });
    if(error) return res.json({ ok:false, msg: error.message });
    res.json({ ok:true, msg:'Daftar berhasil! Silahkan login' });
  } catch(e){ res.json({ ok:false, msg: e.message }); }
});

app.post('/api/login', async (req, res) => {
  try {
    const { id, password } = req.body || {};
    const { data: user } = await supabase.from('werewolf_users').select('*').eq('id', id).maybeSingle();
    if(!user) return res.json({ ok:false, msg:'ID gak ketemu' });
    const cocok = await bcrypt.compare(password || '', user.password || '');
    if(!cocok) return res.json({ ok:false, msg:'Password salah!' });
    delete user.password;
    res.json({ ok:true, user });
  } catch(e){ res.json({ ok:false, msg: e.message }); }
});

app.get('/api/leaderboard', async (req, res) => {
  const { data } = await supabase.from('werewolf_users').select('id, display_name, avatar, win, wolf_win, villager_win, games').order('win', { ascending:false }).limit(20);
  res.json(data || []);
});

app.post('/api/change-avatar', async (req, res) => {
  const { id, avatar } = req.body || {};
  const { error } = await supabase.from('werewolf_users').update({ avatar }).eq('id', id);
  if(error) return res.json({ ok:false, msg: error.message });
  res.json({ ok:true });
});

// ===== LOBBY PUBLIC / PRIVATE =====
let publicRooms = {};
app.get('/api/rooms', (req,res)=>{
  const list = Object.values(publicRooms).filter(r=>!r.isPrivate).map(r=>({ code:r.code, name:r.name, host:r.host, count:r.players.length, maxPlayers:r.maxPlayers, createdAt:r.createdAt }));
  res.json(list);
});

const server = http.createServer(app);
const io = socketIo(server, {
  cors: { origin: "*" },
  pingInterval: 25000,
  pingTimeout: 60000,
  transports: ["websocket", "polling"],
  maxHttpBufferSize: 10 * 1024 * 1024
});

const ROOMS = {};
const ALL_ROLES = {
  villager: { emoji: '👨‍🌾', name: 'Villager', desc: 'Warga biasa. Siang vote gantung yang dicurigai.', color: '#8a8a8a', night: false },
  werewolf: { emoji: '🐺', name: 'Werewolf', desc: 'Malam pilih 1 mangsa untuk dibunuh bareng wolf lain.', color: '#ff4a4a', night: true },
  seer: { emoji: '🔮', name: 'Seer', desc: 'Intip role 1 orang.', color: '#6d4aff', night: true },
  doctor: { emoji: '💉', name: 'Doctor', desc: 'Heal 1 orang.', color: '#4aff8a', night: true },
  alpha: { emoji: '👑', name: 'Alpha Wolf', desc: 'Bos werewolf. Vote mangsa 2x.', color: '#ff2a2a', night: true },
  bodyguard: { emoji: '🛡️', name: 'Bodyguard', desc: 'Jaga 1 orang. Kalau dia diserang, kamu mati gantiin.', color: '#4a8aff', night: true },
  mayor: { emoji: '🎩', name: 'Mayor', desc: 'Vote siang 2x.', color: '#ffd700', night: false },
  witch: { emoji: '🧙', name: 'Witch', desc: 'Punya 1x Heal & 1x Poison.', color: '#9d4aff', night: true },
  cupid: { emoji: '💘', name: 'Cupid', desc: 'Malam pertama jodohkan 2 lovers.', color: '#ff4ab2', night: true },
  jester: { emoji: '🤡', name: 'Jester', desc: 'Menang jika digantung siang hari.', color: '#ffaa00', night: false },
  hunter: { emoji: '🏹', name: 'Hunter', desc: 'Kalau mati, boleh tembak 1 orang ikut mati.', color: '#ff7a00', night: false },
  traitor: { emoji: '🎭', name: 'Traitor', desc: 'Warga palsu. Menang bareng Werewolf. Seer ngeliat kamu sebagai Villager.', color: '#c44aff', night: false },
  silencer: { emoji: '🤫', name: 'Silencer', desc: 'Malam pilih 1 orang. Besok siang dia gak bisa chat.', color: '#00d1ff', night: true }
};

const DEFAULT_CONFIG = { wolfCount: 1, nightTime: 60, dayTime: 120, enabledRoles: { villager:true, werewolf:true, seer:true, doctor:true, alpha:false, bodyguard:false, mayor:false, witch:false, cupid:false, jester:false, hunter:false, traitor:false, silencer:false } };
const NARATOR = {
  winWolf: ['🐺 Serigala menguasai desa!', '🌕 Malam abadi. Desa kalah!'],
  winVillager: ['🎉 Desa menang! Serigala musnah!', '☀️ Matahari terbit, desa aman!'],
  night: ['🌙 Malam tiba... tutup mata kalian...', '🦉 Hening... semua tertidur...'],
  noLynch: ['Tidak ada yang digantung hari ini.', 'Desa masih ragu...'],
  lynch: (n, r) => `⚰️ ${n} digantung! Dia adalah ${r}.`
};
function pick(a){ return a[Math.floor(Math.random()*a.length)]; }
function cleanName(n){ return String(n||'').trim().slice(0,16); }

function checkWinner(room){
  let alive = room.players.filter(p=>p.alive);
  let wolves = alive.filter(p=>['werewolf','alpha','traitor'].includes(p.role));
  let villagers = alive.filter(p=>!['werewolf','alpha','traitor','jester'].includes(p.role));
  if(wolves.length===0) return 'villagers';
  if(wolves.length >= villagers.length) return 'werewolves';
  return null;
}
function endGame(room, win, msg){
  room.phase='ended';
  io.to(room.code).emit('gameOver', { winner: win, msg, players: room.players });
  if(publicRooms[room.code]) delete publicRooms[room.code];
}
function doStartGame(room){
  let players = room.players;
  let roles = [];
  let cfg = room.config;
  for(let i=0;i<cfg.wolfCount;i++) roles.push('werewolf');
  for(let r in cfg.enabledRoles){ if(cfg.enabledRoles[r] && r!=='villager' && r!=='werewolf' && roles.length < players.length) roles.push(r); }
  while(roles.length < players.length) roles.push('villager');
  roles = roles.sort(()=>Math.random()-0.5);
  players.forEach((p,i)=>{ p.role=roles[i]; p.alive=true; p.voted=false; });
  room.phase='night'; room.day=1; room.nightActions={}; room.votes={}; room.silenced={};
  players.forEach(p=>{ let s=io.sockets.sockets.get(p.id); if(s) s.emit('roleAssigned', { role:p.role, roleData:ALL_ROLES[p.role], allPlayers:players }); });
  io.to(room.code).emit('gameStarted', { players });
  io.to(room.code).emit('nightStarted', { narration: pick(NARATOR.night), players, log: room.log });
}
function doDay(room){
  room.phase='day'; room.votes={};
  io.to(room.code).emit('dayStarted', { players: room.players, log: room.log });
}
function doLynch(room){
  let counts={};
  for(let v in room.votes){ let t=room.votes[v].target; counts[t]=(counts[t]||0)+room.votes[v].weight; }
  let max=0, lynched=null;
  for(let t in counts){ if(counts[t]>max){ max=counts[t]; lynched=t; } }
  if(lynched){
    let p=room.players.find(x=>x.name===lynched);
    if(p){
      // JESTER menang kalau digantung
      if(p.role==='jester'){ p.alive=false; room.log.push(`🤡 ${p.name} digantung, Jester MENANG!`); io.to(room.code).emit('gameOver', { winner:'jester', msg:`🤡 ${p.name} adalah Jester! Dia MENANG karena digantung!`, players: room.players }); return; }
      // HUNTER - kasih kesempatan nembak
      if(p.role==='hunter'){ p.alive=false; io.to(room.code).emit('hunterTurn', { hunterName:p.name, msg:'🏹 Hunter mati! Pilih 1 orang untuk ditembak!' }); room.log.push(`🏹 ${p.name} (Hunter) digantung, dia menembak balik!`); }
      else { p.alive=false; room.log.push(NARATOR.lynch(p.name, ALL_ROLES[p.role].name)); }
    }
  }
  let win=checkWinner(room);
  if(win){ endGame(room, win, win==='werewolves'?pick(NARATOR.winWolf):pick(NARATOR.winVillager)); return; }
  room.phase='night'; room.day++;
  io.to(room.code).emit('nightStarted', { narration: pick(NARATOR.night), players: room.players, log: room.log });
}

io.on('connection', socket => {
  socket.on('createRoom', ({ name, isPrivate, maxPlayers, roomName }) => {
    name = cleanName(name); if(!name) return socket.emit('errorMsg', 'Nama dulu!');
    let code = Math.random().toString(36).substring(2, 6).toUpperCase();
    ROOMS[code] = { code, hostId: socket.id, players: [], log: [], nightActions: {}, votes: {}, werewolfChat: [], lobbyChat: [], phase: 'lobby', timeLeft: 0, config: JSON.parse(JSON.stringify(DEFAULT_CONFIG)), cupidDone: false, voiceUsers: [], silenced: {} };
    ROOMS[code].players.push({ id: socket.id, name, role: null, alive: true, lover: null, witchHeal: true, witchPoison: true, bodyguardLastTarget: null });
    publicRooms[code] = { code, name: roomName || ('Desa '+code), host: name, players:[socket.id], maxPlayers: maxPlayers||8, isPrivate: !!isPrivate, createdAt: Date.now() };
    socket.join(code);
    socket.emit('roomCreated', { code, config: ROOMS[code].config });
    io.to(code).emit('updateLobby', ROOMS[code]);
  });

  socket.on('joinRoom', ({ code, name }) => {
    code = (code || '').toUpperCase(); name = cleanName(name);
    let room = ROOMS[code]; if (!room) return socket.emit('errorMsg', 'Kode salah');
    if (!name) return socket.emit('errorMsg', 'Nama dulu!');
    if (room.phase !== 'lobby') return socket.emit('errorMsg', 'Game sudah mulai!');
    if (room.players.some(p => p.name.toLowerCase() === name.toLowerCase())) return socket.emit('errorMsg', `Nama "${name}" sudah dipakai!`);
    if (room.players.some(p => p.id === socket.id)) return socket.emit('errorMsg', 'Kamu sudah di room ini!');
    room.players.push({ id: socket.id, name, role: null, alive: true, lover: null, witchHeal: true, witchPoison: true, bodyguardLastTarget: null });
    if(publicRooms[code] && !publicRooms[code].players.includes(socket.id)) publicRooms[code].players.push(socket.id);
    socket.join(code);
    socket.emit('joinedRoom', { code, config: room.config });
    io.to(code).emit('updateLobby', room);
  });

  socket.on('startGame', ({ code }) => {
    let room = ROOMS[code]; if (!room || room.hostId !== socket.id) return;
    if (room.phase !== 'lobby') return socket.emit('errorMsg', 'Game sudah jalan!');
    if (room.players.length < 3) return socket.emit('errorMsg', 'Minimal 3 pemain!');
    if (room.players.length > 15) return socket.emit('errorMsg', 'Maksimal 15 pemain!');
    if(publicRooms[code]) delete publicRooms[code];
    doStartGame(room);
  });

  socket.on('nightAction', ({ code, targetName }) => {
    let room = ROOMS[code]; if (!room || room.phase !== 'night') return;
    let pl = room.players.find(p => p.id === socket.id); if (!pl || !pl.alive) return;
    let target = room.players.find(p => p.name === targetName && p.alive); if(!target) return socket.emit('errorMsg', 'Target sudah mati / tidak ada!');
    room.nightActions = room.nightActions || {};
    if (['werewolf', 'alpha'].includes(pl.role)){
      room.nightActions.wolfVotes = room.nightActions.wolfVotes || {};
      room.nightActions.wolfVotes[pl.name] = targetName;
      let totalWolves = room.players.filter(p => p.alive && ['werewolf', 'alpha'].includes(p.role)).length;
      if (Object.keys(room.nightActions.wolfVotes).length >= totalWolves) doDay(room);
    }
    if (pl.role === 'seer') socket.emit('seerResult', { target: targetName, isWerewolf: ['werewolf','alpha'].includes(target?.role), role: target?.role==='traitor' ? 'villager' : target?.role });
    if (pl.role === 'doctor') room.nightActions.doctorTarget = targetName;
    if (pl.role === 'silencer'){ room.silenced = {}; let t2 = room.players.find(p=>p.name===targetName); if(t2) room.silenced[t2.id]=true; socket.emit('actionDone', { msg:'🤫 '+targetName+' akan di-silence besok siang!' }); }
    if (pl.role === 'bodyguard'){
      if (targetName === pl.name) return socket.emit('errorMsg', '🛡️ Bodyguard GAK bisa jaga diri sendiri!');
      if (pl.bodyguardLastTarget === targetName) return socket.emit('errorMsg', `🛡️ GAK boleh jaga ${targetName} 2 malam berturut-turut!`);
      room.nightActions.bodyguardTarget = targetName; pl.bodyguardLastTarget = targetName;
    }
  });

  socket.on('hunterShot', ({ code, targetName }) => {
    let room = ROOMS[code]; if(!room) return;
    let t = room.players.find(p=>p.name===targetName); if(t){ t.alive=false; room.log.push(`🏹 Hunter menembak ${t.name}!`); }
    io.to(code).emit('updateLobby', room);
    io.to(code).emit('playerList', room.players);
    let win = checkWinner(room); if(win) endGame(room, win, win==='werewolves'?pick(NARATOR.winWolf):pick(NARATOR.winVillager));
    else { room.phase='night'; io.to(code).emit('nightStarted', { narration: pick(NARATOR.night), players: room.players, log: room.log }); }
  });

  socket.on('witchAction', ({ code, action, targetName }) => {
    let room = ROOMS[code]; if (!room || room.phase !== 'night') return;
    let me = room.players.find(p => p.id === socket.id); if (!me || me.role !== 'witch' || !me.alive) return;
    room.nightActions = room.nightActions || {};
    if (action === 'heal' && me.witchHeal){ room.nightActions.witchHealTarget = targetName; me.witchHeal = false; socket.emit('witchDone', { action: 'heal' }); }
    if (action === 'poison' && me.witchPoison){ room.nightActions.witchPoisonTarget = targetName; me.witchPoison = false; socket.emit('witchDone', { action: 'poison' }); }
  });

  socket.on('cupidChoice', ({ code, lover1, lover2 }) => {
    let room = ROOMS[code]; if (!room || room.phase !== 'night') return;
    let me = room.players.find(p => p.id === socket.id); if(!me || me.role !== 'cupid' || !me.alive) return;
    if(room.cupidDone) return;
    let p1 = room.players.find(p => p.name === lover1 && p.alive); let p2 = room.players.find(p => p.name === lover2 && p.alive);
    if(!p1 || !p2) return;
    room.cupidDone = true; p1.lover = p2.name; p2.lover = p1.name; room.log.push(`💘 ${p1.name} & ${p2.name} jadi LOVERS!`);
    socket.emit('cupidDone', { lover1, lover2 });
  });

  socket.on('vote', ({ code, targetName }) => {
    let room = ROOMS[code]; if (!room || room.phase !== 'day') return;
    let voter = room.players.find(p => p.id === socket.id); if (!voter || !voter.alive) return;
    let target = room.players.find(p => p.name === targetName && p.alive); if(!target) return;
    if(room.votes[voter.name]) return socket.emit('errorMsg', '🔒 Vote kamu udah terkunci!');
    room.votes[voter.name] = { target: targetName, weight: voter.role === 'mayor' ? 2 : 1 };
    io.to(code).emit('voteUpdate', room.votes);
    let aliveCount = room.players.filter(p => p.alive).length;
    if (Object.keys(room.votes).length >= aliveCount) doLynch(room);
  });

  socket.on('chatAll', ({ code, msg }) => {
    let room = ROOMS[code]; if (!room) return;
    if (room.phase !== 'day') return socket.emit('errorMsg', 'Chat cuma bisa siang hari!');
    let p = room.players.find(x => x.id === socket.id); if (!p || !p.alive) return;
    if(room.silenced && room.silenced[p.id]) return socket.emit('errorMsg', '🤫 Kamu di-silence! Gak bisa chat siang ini.');
    msg = String(msg || '').trim().slice(0, 200); if (!msg) return;
    io.to(code).emit('chatAllMsg', { name: p.name, msg, time: new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) });
  });

  socket.on('werewolfChat', ({ code, msg }) => {
    let room = ROOMS[code]; if (!room) return;
    if(room.phase==='lobby' || room.phase==='ended') return;
    let p = room.players.find(x => x.id === socket.id); if (!p || !p.alive || !['werewolf','alpha'].includes(p.role)) return;
    msg = String(msg || '').trim().slice(0, 200); if(!msg) return;
    if(!room.werewolfChat) room.werewolfChat = [];
    room.werewolfChat.push({ name: p.name, msg });
    room.players.filter(x => ['werewolf', 'alpha'].includes(x.role) && x.alive).forEach(w => { io.to(w.id).emit('werewolfChatMsg', { chat: room.werewolfChat }); });
  });

  socket.on('sendAd', ({ code, image, duration, caption }) => {
    let room = ROOMS[code]; if (!room) return;
    if (room.hostId !== socket.id) return socket.emit('errorMsg', '⛔ Cuma HOST yang bisa kirim iklan!');
    if (!image || !image.startsWith('data:image/')) return socket.emit('errorMsg', 'Gambar iklan tidak valid!');
    let dur = Math.max(2, Math.min(30, parseInt(duration)||5));
    let cap = String(caption || '').trim().slice(0, 80);
    io.to(code).emit('showAd', { image, duration: dur, caption: cap, from: room.players.find(p=>p.id===socket.id)?.name || 'HOST' });
  });

  socket.on('disconnect', ()=>{
    for(let code in ROOMS){
      let room = ROOMS[code];
      room.players = room.players.filter(p=>p.id!==socket.id);
      if(publicRooms[code]) publicRooms[code].players = publicRooms[code].players.filter(id=>id!==socket.id);
      io.to(code).emit('updateLobby', room);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => console.log('🐺 ONLINE di port ' + PORT));
