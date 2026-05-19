/* SaazText Service Worker
   Běží na pozadí, polluje Firebase a zobrazuje push notifikace */

const FIREBASE_URL = 'https://saaztext-default-rtdb.europe-west1.firebasedatabase.app';
const CACHE_NAME = 'saaztext-v1';

let lastId = null;
let pollTimer = null;
let currentUser = null;

// Instalace SW
self.addEventListener('install', e => {
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(self.clients.claim());
});

// Zprávy z hlavního vlákna (přihlášení/odhlášení)
self.addEventListener('message', e => {
  if (e.data.type === 'SET_USER') {
    currentUser = e.data.user; // { id, role, display }
    if (currentUser) startPolling();
    else stopPolling();
  }
  if (e.data.type === 'LOGOUT') {
    currentUser = null;
    stopPolling();
  }
  if (e.data.type === 'SET_LAST_ID') {
    lastId = e.data.id;
  }
});

function startPolling() {
  if (pollTimer) return;
  poll();
}

function stopPolling() {
  if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
}

async function poll() {
  try {
    const r = await fetch(`${FIREBASE_URL}/saazmed_dispatch/latest.json`);
    const data = await r.json();

    if (data && data._id && data._id !== lastId) {
      const isOld = !lastId && (Date.now() - data._ts > 15000);
      lastId = data._id;

      if (!isOld && currentUser) {
        await handleMessage(data);
      }
    }
  } catch(e) {}

  pollTimer = setTimeout(poll, 2000);
}

async function handleMessage(data) {
  if (!currentUser) return;

  // Nova výzva pro posádku
  if (data.type === 'nova_vyzva' && currentUser.role === 'crew') {
    const p = data.payload;
    if (!p || !p.recipients || !p.recipients.includes(currentUser.id)) return;

    // Zkontroluj jestli je app otevřená
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });

    // Zobraz notifikaci
    const addr = [p.ulice, p.cp, p.mesto].filter(Boolean).join(' ');
    await self.registration.showNotification('🚨 NOVÁ VÝZVA – SaazText', {
      body: `${p.klasifikaceLabel || p.klasifikace}\n${addr}`,
      icon: './icon-192.png',
      badge: './icon-192.png',
      tag: 'nova-vyzva-' + p.id,
      requireInteraction: true,
      vibrate: [300, 100, 300, 100, 300],
      data: { url: './saaztext.html', alertId: p.id }
    });

    // Pošli zprávu do otevřených tabů
    clients.forEach(client => {
      client.postMessage({ type: 'nova_vyzva', payload: p });
    });
  }

  // Doplnění výzvy
  if (data.type === 'vyzva_doplnena' && currentUser.role === 'crew') {
    await self.registration.showNotification('📋 Doplnění výzvy', {
      body: data.text,
      icon: './icon-192.png',
      tag: 'doplneni',
      requireInteraction: false,
      vibrate: [200, 100, 200]
    });
  }

  // Nová avízo zpráva
  if (data.type === 'avizo_zz_reply' && currentUser.role === 'crew') {
    const labelMap = { prijima: 'ZZ přijímá ✓', odmita: 'ZZ odmítá ✗', podminka: 'ZZ s podmínkou ⚡' };
    await self.registration.showNotification('🏥 Odpověď ZZ', {
      body: labelMap[data.status] || data.status,
      icon: './icon-192.png',
      tag: 'zz-reply',
      vibrate: [200, 100, 200]
    });
  }
}

// Klik na notifikaci → otevři app
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      if (clients.length > 0) {
        clients[0].focus();
        clients[0].postMessage({ type: 'notification_click', data: e.notification.data });
      } else {
        self.clients.openWindow(e.notification.data?.url || './saaztext.html');
      }
    })
  );
});
