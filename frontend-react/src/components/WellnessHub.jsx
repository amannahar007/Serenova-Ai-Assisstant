import { useEffect, useMemo, useState } from 'react';
import { rtdb } from '../firebase';
import { onValue, ref, set, push, serverTimestamp } from 'firebase/database';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Activity, Bell, CalendarCheck, HeartPulse, Moon, ShieldAlert, Smile, Stethoscope, Users, Watch } from 'lucide-react';

const defaultMoodData = [
  { day: 'Mon', mood: 6.4, stress: 4.2 },
  { day: 'Tue', mood: 7.1, stress: 3.8 },
  { day: 'Wed', mood: 8.3, stress: 2.9 },
  { day: 'Thu', mood: 7.4, stress: 3.4 },
  { day: 'Fri', mood: 6.8, stress: 4.5 },
  { day: 'Sat', mood: 8.8, stress: 2.2 },
  { day: 'Sun', mood: 7.9, stress: 3.0 }
];

const nudges = [
  { time: '08:00', title: 'Morning check-in', body: 'Start with a 30-second mood log and one hydration reminder.' },
  { time: '14:00', title: 'Stress reset', body: 'If yesterday was heavy, take a five-minute breathing break.' },
  { time: '22:00', title: 'Sleep wind-down', body: 'Dim lights, pause screens, and let SERENOVA prep tomorrow gently.' }
];

const pricing = [
  { name: 'Free', price: 'Rs.0', detail: '20 messages/day, multilingual chat, memory basics' },
  { name: 'Premium', price: 'Rs.90/mo', detail: 'Unlimited chat, face analysis, daily health card' },
  { name: 'Pro', price: 'Rs.299/mo', detail: 'Doctor connect, PDF reports, wearable sync, priority' },
  { name: 'Family', price: 'Rs.499/mo', detail: '5 members, shared dashboard, family nudges' }
];

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function scoreFromMood(mood) {
  const scores = {
    great: 8.7,
    good: 7.4,
    okay: 6.1,
    low: 4.2,
    stressed: 3.6
  };
  return scores[mood] || 7.2;
}

export default function WellnessHub({ user, isPro, onUpgrade }) {
  const [journal, setJournal] = useState({});
  const [selectedMood, setSelectedMood] = useState('good');
  const [note, setNote] = useState('');
  const [sosOpen, setSosOpen] = useState(false);

  useEffect(() => {
    if (!user?.uid) return;
    const unsub = onValue(ref(rtdb, `users/${user.uid}/wellness`), (snapshot) => {
      setJournal(snapshot.val() || {});
    });
    return () => unsub();
  }, [user?.uid]);

  const todayEntry = journal?.daily?.[todayKey()];
  const moodScore = todayEntry?.moodScore || scoreFromMood(selectedMood);
  const moodData = useMemo(() => {
    const saved = journal?.trend;
    if (Array.isArray(saved) && saved.length) return saved;
    return defaultMoodData;
  }, [journal?.trend]);

  const saveMood = async () => {
    if (!user?.uid) return;
    const entry = {
      mood: selectedMood,
      moodScore: scoreFromMood(selectedMood),
      note,
      updatedAt: Date.now()
    };
    await set(ref(rtdb, `users/${user.uid}/wellness/daily/${todayKey()}`), entry);
    await push(ref(rtdb, 'analytics_events'), {
      event: 'mood_logged',
      userId: user.uid,
      mood: selectedMood,
      timestamp: serverTimestamp()
    });
    setNote('');
  };

  return (
    <div className="h-full overflow-y-auto bg-[#f7f4ec]">
      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-6 py-6 lg:px-8">
        <section className="grid gap-5 lg:grid-cols-[1.25fr_0.75fr]">
          <div className="rounded-lg border border-[#ded5c4] bg-white p-6 shadow-sm">
            <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-[#846a4e]">Daily health card</p>
                <h1 className="mt-1 text-3xl font-bold tracking-tight text-[#24211e]">A calm command center for every age, language, and question.</h1>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-[#66615a]">
                  SERENOVA blends universal AI chat with wellness signals, regional language support, and human help paths when users need more than software.
                </p>
              </div>
              <button onClick={onUpgrade} className="rounded-lg bg-[#2f5d62] px-4 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-[#23494d]">
                Unlock Premium
              </button>
            </div>

            <div className="grid gap-4 md:grid-cols-4">
              <Metric icon={Smile} label="Mood Score" value={`${moodScore.toFixed(1)} / 10`} tone="green" />
              <Metric icon={HeartPulse} label="Heart Rate" value={isPro ? '74 bpm' : 'Premium'} tone="red" />
              <Metric icon={Moon} label="Fatigue" value={isPro ? 'Medium' : 'Locked'} tone="amber" />
              <Metric icon={Activity} label="Stress" value={moodScore < 5 ? 'High' : 'Low'} tone="blue" />
            </div>

            <div className="mt-5 rounded-lg border border-[#e8dfd0] bg-[#fbfaf6] p-4">
              <p className="text-sm font-bold text-[#24211e]">AI tip</p>
              <p className="mt-1 text-sm leading-6 text-[#66615a]">
                You seem more balanced today. Keep the small routine: water, a short walk, and a screen-light wind-down before sleep.
              </p>
            </div>
          </div>

          <div className="rounded-lg border border-[#ded5c4] bg-[#1f2933] p-6 text-white shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-[#9fd5ca]">Emergency SOS</p>
                <h2 className="mt-1 text-2xl font-bold">Fast help, clearly visible.</h2>
              </div>
              <ShieldAlert className="text-[#f6b26b]" size={34} />
            </div>
            <p className="mt-4 text-sm leading-6 text-white/75">
              If someone feels unsafe, the app puts trusted helplines and hospital search one tap away.
            </p>
            <button onClick={() => setSosOpen((open) => !open)} className="mt-5 w-full rounded-lg bg-[#d9534f] px-4 py-3 text-sm font-bold text-white transition hover:bg-[#bf3f3b]">
              Open SOS Panel
            </button>
            {sosOpen && (
              <div className="mt-4 grid gap-2 text-sm">
                <a className="rounded-lg bg-white/10 px-3 py-2 hover:bg-white/15" href="tel:18602662345">Vandrevala Foundation: 1860-2662-345</a>
                <a className="rounded-lg bg-white/10 px-3 py-2 hover:bg-white/15" href="tel:9152987821">iCall India: 9152987821</a>
                <a className="rounded-lg bg-white/10 px-3 py-2 hover:bg-white/15" href="https://www.google.com/maps/search/hospital+near+me" target="_blank" rel="noreferrer">Find nearest hospital</a>
              </div>
            )}
          </div>
        </section>

        <section className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
          <div className="rounded-lg border border-[#ded5c4] bg-white p-6 shadow-sm">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-[#846a4e]">Mood journal</p>
                <h2 className="text-xl font-bold text-[#24211e]">Log today in ten seconds</h2>
              </div>
              <CalendarCheck className="text-[#2f5d62]" />
            </div>
            <div className="grid grid-cols-5 gap-2">
              {['great', 'good', 'okay', 'low', 'stressed'].map((mood) => (
                <button
                  key={mood}
                  onClick={() => setSelectedMood(mood)}
                  className={`rounded-lg border px-2 py-3 text-xs font-bold capitalize transition ${selectedMood === mood ? 'border-[#2f5d62] bg-[#e8f3ef] text-[#23494d]' : 'border-[#e8dfd0] bg-[#fbfaf6] text-[#66615a] hover:border-[#2f5d62]'}`}
                >
                  {mood}
                </button>
              ))}
            </div>
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Add a short note: sleep, stress, school, work, family..."
              className="mt-4 min-h-24 w-full rounded-lg border border-[#ded5c4] bg-[#fbfaf6] p-3 text-sm outline-none focus:border-[#2f5d62]"
            />
            <button onClick={saveMood} className="mt-3 w-full rounded-lg bg-[#2f5d62] px-4 py-3 text-sm font-bold text-white">
              Save today's mood
            </button>
          </div>

          <div className="rounded-lg border border-[#ded5c4] bg-white p-6 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-[#846a4e]">Trend graph</p>
                <h2 className="text-xl font-bold text-[#24211e]">Weekly mood and stress</h2>
              </div>
              <p className="text-xs font-bold text-[#688a58]">Best day: Saturday</p>
            </div>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={moodData} margin={{ top: 8, right: 12, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="mood" x1="0" x2="0" y1="0" y2="1">
                      <stop offset="5%" stopColor="#2f5d62" stopOpacity={0.32} />
                      <stop offset="95%" stopColor="#2f5d62" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eadfcd" />
                  <XAxis dataKey="day" tickLine={false} axisLine={false} />
                  <YAxis domain={[0, 10]} tickLine={false} axisLine={false} />
                  <Tooltip />
                  <Area type="monotone" dataKey="mood" stroke="#2f5d62" fill="url(#mood)" strokeWidth={3} />
                  <Area type="monotone" dataKey="stress" stroke="#b06a4b" fill="transparent" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </section>

        <section className="grid gap-5 lg:grid-cols-3">
          <FeaturePanel icon={Bell} title="Smart nudges" items={nudges.map((nudge) => `${nudge.time} - ${nudge.title}: ${nudge.body}`)} />
          <FeaturePanel icon={Stethoscope} title="Doctor connect" items={['Pro tier therapist handoff', 'One session/month roadmap', 'Escalate after repeated stress signals']} />
          <FeaturePanel icon={Watch} title="Wearable sync" items={['Google Fit ready concept', 'Steps, sleep, SpO2, heart rate', 'Combines wearable data with face analysis']} />
        </section>

        <section className="grid gap-5 lg:grid-cols-[0.8fr_1.2fr]">
          <div className="rounded-lg border border-[#ded5c4] bg-white p-6 shadow-sm">
            <div className="flex items-center gap-3">
              <Users className="text-[#8c5a4d]" />
              <h2 className="text-xl font-bold text-[#24211e]">Anonymous community</h2>
            </div>
            <p className="mt-3 text-sm leading-6 text-[#66615a]">
              Peer support can reduce loneliness without exposing identity. Community spaces stay moderated, anonymous, and wellness-focused.
            </p>
            <div className="mt-4 rounded-lg bg-[#fbfaf6] p-4 text-sm text-[#24211e]">
              Others feeling stressed today: <strong>2,847</strong><br />
              Most active group: <strong>Exam pressure support</strong>
            </div>
          </div>
          <div className="rounded-lg border border-[#ded5c4] bg-white p-6 shadow-sm">
            <p className="text-xs font-bold uppercase tracking-wider text-[#846a4e]">Worldwide monetization ladder</p>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {pricing.map((tier) => (
                <div key={tier.name} className="rounded-lg border border-[#e8dfd0] bg-[#fbfaf6] p-4">
                  <p className="text-sm font-bold text-[#24211e]">{tier.name}</p>
                  <p className="mt-1 text-2xl font-bold text-[#2f5d62]">{tier.price}</p>
                  <p className="mt-2 text-xs leading-5 text-[#66615a]">{tier.detail}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function Metric({ icon: Icon, label, value, tone }) {
  const tones = {
    green: 'bg-[#e8f3ef] text-[#2f5d62]',
    red: 'bg-[#f8e9e4] text-[#9f4d42]',
    amber: 'bg-[#fbf1dc] text-[#8a682e]',
    blue: 'bg-[#e8eef5] text-[#315d7d]'
  };

  return (
    <div className="rounded-lg border border-[#e8dfd0] bg-[#fbfaf6] p-4">
      <div className={`mb-4 flex h-10 w-10 items-center justify-center rounded-lg ${tones[tone]}`}>
        <Icon size={20} />
      </div>
      <p className="text-xs font-bold uppercase tracking-wider text-[#847d72]">{label}</p>
      <p className="mt-1 text-xl font-bold text-[#24211e]">{value}</p>
    </div>
  );
}

function FeaturePanel({ icon: Icon, title, items }) {
  return (
    <div className="rounded-lg border border-[#ded5c4] bg-white p-6 shadow-sm">
      <div className="mb-4 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#e8f3ef] text-[#2f5d62]">
          <Icon size={20} />
        </div>
        <h2 className="text-lg font-bold text-[#24211e]">{title}</h2>
      </div>
      <div className="grid gap-2">
        {items.map((item) => (
          <div key={item} className="rounded-lg bg-[#fbfaf6] px-3 py-2 text-sm leading-5 text-[#66615a]">
            {item}
          </div>
        ))}
      </div>
    </div>
  );
}
