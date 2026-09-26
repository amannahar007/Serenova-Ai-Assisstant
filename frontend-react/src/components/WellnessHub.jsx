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
    <div className="h-full overflow-y-auto bg-neu-base">
      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-6 py-6 lg:px-8">
        <section className="grid gap-5 lg:grid-cols-[1.25fr_0.75fr]">
          <div className="rounded-neu-xl neu-card p-6 bg-neu-base border border-white/80">
            <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-neu-gold">Daily health card</p>
                <h1 className="mt-1 text-3xl font-bold font-serif tracking-tight text-text-primary">A calm command center for every age, language, and question.</h1>
                <p className="mt-2 max-w-2xl text-sm leading-relaxed text-text-dim">
                  SERENOVA blends universal AI chat with wellness signals, regional language support, and human help paths when users need more than software.
                </p>
              </div>
              <button onClick={onUpgrade} className="rounded-neu-sm neu-btn-teal px-4 py-3 text-sm font-bold text-white transition-all focus-neu">
                Unlock Premium
              </button>
            </div>

            <div className="grid gap-4 md:grid-cols-4">
              <Metric icon={Smile} label="Mood Score" value={`${moodScore.toFixed(1)} / 10`} tone="green" />
              <Metric icon={HeartPulse} label="Heart Rate" value={isPro ? '74 bpm' : 'Premium'} tone="red" />
              <Metric icon={Moon} label="Fatigue" value={isPro ? 'Medium' : 'Locked'} tone="amber" />
              <Metric icon={Activity} label="Stress" value={moodScore < 5 ? 'High' : 'Low'} tone="blue" />
            </div>

            <div className="mt-5 rounded-neu-md neu-inset p-4 bg-neu-dark border border-[#ded7c8]/40">
              <p className="text-sm font-bold text-text-primary">AI tip</p>
              <p className="mt-1 text-sm leading-relaxed text-text-dim">
                You seem more balanced today. Keep the small routine: water, a short walk, and a screen-light wind-down before sleep.
              </p>
            </div>
          </div>

          <div className="rounded-neu-xl neu-card p-6 bg-[#212628] text-white border border-gray-700/60 shadow-[6px_6px_14px_rgba(0,0,0,0.35)]">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-emerald-400">Emergency SOS</p>
                <h2 className="mt-1 text-2xl font-bold font-serif text-white">Fast help, clearly visible.</h2>
              </div>
              <ShieldAlert className="text-amber-400" size={34} />
            </div>
            <p className="mt-4 text-sm leading-relaxed text-slate-300">
              If someone feels unsafe, the app puts trusted helplines and hospital search one tap away.
            </p>
            <button onClick={() => setSosOpen((open) => !open)} className="mt-5 w-full rounded-neu-sm bg-[#c94a46] px-4 py-3 text-sm font-bold text-white transition hover:bg-[#b03a37] focus-neu">
              Open SOS Panel
            </button>
            {sosOpen && (
              <div className="mt-4 grid gap-2 text-sm">
                <a className="rounded-neu-sm bg-white/10 px-3.5 py-2.5 hover:bg-white/15 focus-neu transition" href="tel:18602662345">Vandrevala Foundation: 1860-2662-345</a>
                <a className="rounded-neu-sm bg-white/10 px-3.5 py-2.5 hover:bg-white/15 focus-neu transition" href="tel:9152987821">iCall India: 9152987821</a>
                <a className="rounded-neu-sm bg-white/10 px-3.5 py-2.5 hover:bg-white/15 focus-neu transition" href="https://www.google.com/maps/search/hospital+near+me" target="_blank" rel="noreferrer">Find nearest hospital</a>
              </div>
            )}
          </div>
        </section>

        <section className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
          <div className="rounded-neu-xl neu-card p-6 bg-neu-base border border-white/80">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-neu-gold">Mood journal</p>
                <h2 className="text-xl font-bold font-serif text-text-primary">Log today in ten seconds</h2>
              </div>
              <CalendarCheck className="text-neu-teal" />
            </div>
            <div className="grid grid-cols-5 gap-2">
              {['great', 'good', 'okay', 'low', 'stressed'].map((mood) => (
                <button
                  key={mood}
                  onClick={() => setSelectedMood(mood)}
                  className={`rounded-neu-sm px-2 py-3 text-xs font-bold capitalize transition-all focus-neu ${
                    selectedMood === mood 
                      ? 'neu-inset bg-neu-dark text-neu-teal border border-neu-teal/40' 
                      : 'neu-btn text-text-dim border border-white/60 hover:text-neu-teal'
                  }`}
                >
                  {mood}
                </button>
              ))}
            </div>
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Add a short note: sleep, stress, school, work, family..."
              className="mt-4 min-h-24 w-full rounded-neu-md neu-inset bg-neu-dark p-3.5 text-sm text-text-primary placeholder:text-text-muted outline-none border border-[#ded7c8]/50 focus-neu"
            />
            <button onClick={saveMood} className="mt-4 w-full rounded-neu-sm neu-btn-teal px-4 py-3 text-sm font-bold text-white transition-all focus-neu">
              Save today's mood
            </button>
          </div>

          <div className="rounded-neu-xl neu-card p-6 bg-neu-base border border-white/80">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-neu-gold">Trend graph</p>
                <h2 className="text-xl font-bold font-serif text-text-primary">Weekly mood and stress</h2>
              </div>
              <p className="text-xs font-bold text-emerald-800 neu-card-flat px-3 py-1 rounded-neu-full">Best day: Saturday</p>
            </div>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={moodData} margin={{ top: 8, right: 12, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="mood" x1="0" x2="0" y1="0" y2="1">
                      <stop offset="5%" stopColor="#244d50" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="#244d50" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#ded7c8" />
                  <XAxis dataKey="day" tickLine={false} axisLine={false} tick={{ fill: '#727a76', fontSize: 12 }} />
                  <YAxis domain={[0, 10]} tickLine={false} axisLine={false} tick={{ fill: '#727a76', fontSize: 12 }} />
                  <Tooltip contentStyle={{ backgroundColor: '#eeebe2', borderRadius: '12px', border: '1px solid #ded7c8', boxShadow: '4px 4px 10px rgba(185,177,163,0.4)' }} />
                  <Area type="monotone" dataKey="mood" stroke="#244d50" fill="url(#mood)" strokeWidth={3} />
                  <Area type="monotone" dataKey="stress" stroke="#8a5649" fill="transparent" strokeWidth={2} />
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
          <div className="rounded-neu-xl neu-card p-6 bg-neu-base border border-white/80">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-neu-sm neu-card-flat flex items-center justify-center text-neu-rose shadow-neu-raised-sm">
                <Users size={20} />
              </div>
              <h2 className="text-xl font-bold font-serif text-text-primary">Anonymous community</h2>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-text-dim">
              Peer support can reduce loneliness without exposing identity. Community spaces stay moderated, anonymous, and wellness-focused.
            </p>
            <div className="mt-4 rounded-neu-md neu-inset p-4 text-sm text-text-primary bg-neu-dark border border-[#ded7c8]/40">
              Others feeling stressed today: <strong>2,847</strong><br />
              Most active group: <strong>Exam pressure support</strong>
            </div>
          </div>
          <div className="rounded-neu-xl neu-card p-6 bg-neu-base border border-white/80">
            <p className="text-xs font-bold uppercase tracking-wider text-neu-gold">Worldwide monetization ladder</p>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {pricing.map((tier) => (
                <div key={tier.name} className="rounded-neu-md neu-card-flat p-4 bg-neu-base border border-white/60">
                  <p className="text-sm font-bold text-text-primary">{tier.name}</p>
                  <p className="mt-1 text-2xl font-bold text-neu-teal">{tier.price}</p>
                  <p className="mt-2 text-xs leading-relaxed text-text-dim">{tier.detail}</p>
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
    green: 'bg-emerald-50 text-emerald-800',
    red: 'bg-rose-50 text-rose-800',
    amber: 'bg-amber-50 text-amber-900',
    blue: 'bg-sky-50 text-sky-800'
  };

  return (
    <div className="rounded-neu-md neu-card-flat p-4 bg-neu-base border border-white/60">
      <div className={`mb-3 flex h-10 w-10 items-center justify-center rounded-neu-sm shadow-neu-raised-sm ${tones[tone]}`}>
        <Icon size={20} />
      </div>
      <p className="text-xs font-bold uppercase tracking-wider text-text-muted">{label}</p>
      <p className="mt-1 text-xl font-bold text-text-primary">{value}</p>
    </div>
  );
}

function FeaturePanel({ icon: Icon, title, items }) {
  return (
    <div className="rounded-neu-xl neu-card p-6 bg-neu-base border border-white/80">
      <div className="mb-4 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-neu-sm neu-card-flat text-neu-teal shadow-neu-raised-sm">
          <Icon size={20} />
        </div>
        <h2 className="text-lg font-bold font-serif text-text-primary">{title}</h2>
      </div>
      <div className="grid gap-2">
        {items.map((item) => (
          <div key={item} className="rounded-neu-sm neu-inset px-3.5 py-2.5 text-sm leading-relaxed text-text-dim bg-neu-dark border border-[#ded7c8]/30">
            {item}
          </div>
        ))}
      </div>
    </div>
  );
}
