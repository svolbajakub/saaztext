/* SaazText Service Worker v2
   Web Push + Firebase polling */

const FIREBASE_URL = 'https://saaztext-default-rtdb.europe-west1.firebasedatabase.app';
const VAPID_PUBLIC = 'BFfOt5qfaeUAakxBYaRlKkHRizT90KuOnltxhWur9L3sBeHnjWWanrjlkD6G-McJF5SMcw2PuLDs7_Qin1uMHU8';

let lastId = null;
let currentUser = null;
let pollTimer = null;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

// Zprávy z hlavní app
self.addEventListener('message', e => {
  if (!e.data) return;
  if (e.data.type === 'SET_USER') {
    currentUser = e.data.user;
    lastId = e.data.lastId || null;
    if (currentUser) startPolling();
  }
  if (e.data.type === 'LOGOUT') {
    currentUser = null;
    stopPolling();
  }
  if (e.data.type === 'PING') {
    e.source?.postMessage({ type: 'PONG' });
  }
});

// Web Push notifikace (přijatá přímo přes FCM/push server)
self.addEventListener('push', e => {
  let data = {};
  try { data = e.data?.json() || {}; } catch(err) {}
  
  e.waitUntil(
    self.registration.showNotification(data.title || '🚨 SaazText', {
      body: data.body || '',
      icon: './icon-192.png',
      badge: './icon-192.png',
      tag: data.tag || 'saaztext',
      requireInteraction: true,
      vibrate: [300, 100, 300, 100, 300],
      data: data
    })
  );
});

// Klik na notifikaci
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      if (clients.length > 0) {
        clients[0].focus();
        clients[0].postMessage({ type: 'notification_click', data: e.notification.data });
      } else {
        self.clients.openWindow('./saaztext.html');
      }
    })
  );
});

// Firebase polling (záloha když push nefunguje)
function startPolling() {
  if (pollTimer) return;
  doPoll();
}

function stopPolling() {
  if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
}

async function doPoll() {
  try {
    const r = await fetch(`${FIREBASE_URL}/saazmed_dispatch/latest.json`);
    const data = await r.json();
    if (data && data._id && data._id !== lastId) {
      const isOld = !lastId && (Date.now() - data._ts > 15000);
      lastId = data._id;
      if (!isOld && currentUser) {
        await handleFbMessage(data);
      }
    }
  } catch(e) {}
  pollTimer = setTimeout(doPoll, 2500);
}

async function handleFbMessage(data) {
  if (!currentUser) return;
  const clients = await self.clients.matchAll({ type:'window', includeUncontrolled:true });
  
  // Pošli do otevřených tabů
  clients.forEach(c => c.postMessage({ type: data.type, payload: data.payload || data }));

  // Pokud app není na popředí, zobraz notifikaci
  const visible = clients.some(c => c.visibilityState === 'visible');
  if (visible) return;

  if (data.type === 'nova_vyzva' && currentUser.role === 'crew') {
    const p = data.payload;
    if (!p?.recipients?.includes(currentUser.id)) return;
    const addr = [p.ulice, p.cp, p.mesto].filter(Boolean).join(' ');
    await self.registration.showNotification('🚨 NOVÁ VÝZVA – SaazText', {
      body: `${p.klasifikaceLabel || p.klasifikace}\n${addr}`,
      icon: './icon-192.png',
      badge: './icon-192.png',
      tag: 'nova-vyzva',
      requireInteraction: true,
      vibrate: [300, 100, 300, 100, 300],
      data: { alertId: p.id }
    });
  }

  if (data.type === 'vyzva_doplnena' && currentUser.role === 'crew') {
    await self.registration.showNotification('📋 Doplnění výzvy', {
      body: data.text,
      icon: './icon-192.png',
      tag: 'doplneni',
      vibrate: [200, 100, 200]
    });
  }

  if (data.type === 'avizo_zz_reply' && currentUser.role === 'crew') {
    const map = { prijima:'✓ ZZ přijímá', odmita:'✗ ZZ odmítá', podminka:'⚡ ZZ s podmínkou' };
    await self.registration.showNotification('🏥 Odpověď ZZ', {
      body: map[data.status] || data.status,
      icon: './icon-192.png',
      tag: 'zz-reply',
      vibrate: [200, 100, 200]
    });
  }
}
