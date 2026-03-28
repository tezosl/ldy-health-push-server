// Lodaya Health Push Server
// Deploy to Railway or Render (free tier)
// npm install web-push node-cron express cors

const express = require('express');
const webpush = require('web-push');
const cron    = require('node-cron');
const cors    = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Set VAPID keys as environment variables:
// VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_EMAIL
webpush.setVapidDetails(
  `mailto:${process.env.VAPID_EMAIL}`,
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

// In-memory subscription store (use a DB for production)
const subscriptions = new Map();

app.post('/subscribe', (req, res) => {
  const { subscription, person, prefs, appointments, timezone } = req.body;
  subscriptions.set(subscription.endpoint, { subscription, person, prefs, appointments, timezone });
  console.log(`Subscribed: ${person}`);
  res.json({ ok: true });
});

app.post('/unsubscribe', (req, res) => {
  const { endpoint } = req.body;
  subscriptions.delete(endpoint);
  res.json({ ok: true });
});

app.get('/health', (req,res) => res.json({ status:'ok', subscribers: subscriptions.size }));

async function sendPush(subData, payload) {
  try {
    await webpush.sendNotification(subData.subscription, JSON.stringify(payload));
  } catch(e) {
    if (e.statusCode === 410) subscriptions.delete(subData.subscription.endpoint);
    else console.error('Push error:', e.message);
  }
}

// ── Monday 7 AM IST weight reminder ──────────────────
// IST = UTC+5:30, so 7:00 AM IST = 1:30 AM UTC
cron.schedule('30 1 * * 1', async () => {
  console.log('[CRON] Monday weight reminder');
  for (const [, sub] of subscriptions) {
    if (!sub.prefs?.weight) continue;
    await sendPush(sub, {
      title: '⚖️ Weekly weigh-in!',
      body: `Good morning ${sub.person}! Time to log your weight for this week.`,
      icon: '/icon-192.png',
      tag: 'weight-reminder',
      url: '/'
    });
  }
});

// ── Water reminders every 2 hrs, 8 AM–10 PM IST ──────
// IST hours: 8,10,12,14,16,18,20,22 → UTC: 2:30,4:30,6:30,8:30,10:30,12:30,14:30,16:30
const waterUTCHours = [2,4,6,8,10,12,14,16];
waterUTCHours.forEach(h => {
  cron.schedule(`30 ${h} * * *`, async () => {
    console.log(`[CRON] Water reminder UTC ${h}:30`);
    for (const [, sub] of subscriptions) {
      if (!sub.prefs?.water) continue;
      await sendPush(sub, {
        title: '💧 Drink water!',
        body: 'Stay hydrated – have a glass of water now.',
        icon: '/icon-192.png',
        tag: 'water-reminder',
        url: '/'
      });
    }
  });
});

// ── Appointment alerts – check every hour ────────────
cron.schedule('0 * * * *', async () => {
  const nowUTC = new Date();
  for (const [, sub] of subscriptions) {
    if (!sub.prefs?.appt || !sub.appointments) continue;
    for (const appt of sub.appointments) {
      const apptIST = new Date(`${appt.date}T${appt.time||'09:00'}:00+05:30`);
      const diff = apptIST - nowUTC;
      // 24 hr alert
      if (diff > 0 && diff <= 86400000 && diff > 82800000) {
        await sendPush(sub, { title:'🏥 Appointment tomorrow!', body:`${appt.doctor} · ${appt.time || '09:00'}`, tag:'appt-24h-'+appt.date });
      }
      // 1 hr alert
      if (diff > 0 && diff <= 3600000 && diff > 3540000) {
        await sendPush(sub, { title:'🏥 Appointment in 1 hour!', body:`${appt.doctor} – get ready!`, tag:'appt-1h-'+appt.date });
      }
    }
  }
});

// ── 9 PM smoke check-in ───────────────────────────────
// 9 PM IST = 3:30 PM UTC
cron.schedule('30 15 * * *', async () => {
  for (const [, sub] of subscriptions) {
    if (!sub.prefs?.smoke) continue;
    await sendPush(sub, {
      title: '🚬 Smoke check-in',
      body: "How did you do today? Log if you smoked – awareness is progress.",
      tag: 'smoke-checkin',
      url: '/'
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Lodaya Push Server on port ${PORT}`));
