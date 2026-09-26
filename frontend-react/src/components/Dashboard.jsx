import { useEffect, useState } from 'react';
import { auth, rtdb } from '../firebase';
import { onValue, ref } from 'firebase/database';
import ChatInterface from './ChatInterface';
import EmotionFusion from './EmotionFusion';
import Subscription from './Subscription';
import AdminDashboard from './AdminDashboard';
import WellnessHub from './WellnessHub';
import { LogOut, MessageSquare, BrainCircuit, CreditCard, BarChart2, Sparkles } from 'lucide-react';

export default function Dashboard({ user }) {
  const [activeTab, setActiveTab] = useState('today');
  const [isPro, setIsPro] = useState(false);
  const adminEmails = (import.meta.env.VITE_ADMIN_EMAILS || '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  const isAdmin = Boolean(user?.email && adminEmails.includes(user.email.toLowerCase()));

  useEffect(() => {
    if (!user?.uid) return;
    const unsubscribe = onValue(ref(rtdb, `subscriptions/${user.uid}`), (snapshot) => {
      const subscription = snapshot.val();
      const expiresAt = subscription?.planExpiresAt || Date.parse(subscription?.expiry_date || '');
      setIsPro(subscription?.status === 'active' && Number(expiresAt) > Date.now());
    });
    return () => unsubscribe();
  }, [user?.uid]);

  const navItem = (id, Icon, label) => (
    <button
      onClick={() => setActiveTab(id)}
      className={`flex items-center gap-3.5 px-4 py-3 rounded-neu-md text-sm font-semibold transition-all focus-neu ${
        activeTab === id
          ? 'neu-nav-active'
          : 'neu-nav-idle'
      }`}
    >
      <Icon size={18} className={activeTab === id ? 'text-neu-teal stroke-[2.2]' : 'text-text-muted'} /> 
      <span>{label}</span>
    </button>
  );

  return (
    <div className="flex h-screen bg-neu-base text-text-primary">
      <aside className="w-72 bg-neu-base border-r border-[#ded7c8]/70 flex flex-col p-6 shadow-[6px_0_18px_rgba(185,177,163,0.35)] relative z-20">
        <div className="flex items-center gap-3.5 mb-8">
          <div className="w-11 h-11 bg-gradient-to-br from-neu-teal-light to-neu-teal text-white rounded-neu-md flex items-center justify-center font-bold text-xl shadow-neu-raised-sm overflow-hidden">
            {user?.photoURL ? (
              <img src={user.photoURL} alt="Profile" className="w-full h-full object-cover" />
            ) : (
              'S'
            )}
          </div>
          <div className="flex flex-col">
            <span className="font-serif font-bold text-lg leading-tight tracking-tight text-text-primary">{user?.displayName || 'SERENOVA'}</span>
            <span className="text-[10px] text-text-muted font-mono tracking-wide">Universal health & AI</span>
          </div>
        </div>

        <nav className="flex flex-col gap-2.5 flex-1">
          {navItem('today', Sparkles, 'Today')}
          {navItem('chat', MessageSquare, 'Ask Anything')}
          {navItem('emotion', BrainCircuit, `Emotion Core ${isPro ? 'Active' : 'Premium'}`)}
          {navItem('billing', CreditCard, 'Plans & Payment')}
          {isAdmin && navItem('admin', BarChart2, 'Analytics')}
        </nav>

        <div className="mt-auto rounded-neu-md neu-card-flat p-4">
          <div className="flex items-center gap-3 mb-3.5">
            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-neu-teal-light to-neu-teal text-white flex items-center justify-center text-xs font-bold shadow-neu-raised-sm">
              {(user.email || user.phoneNumber || 'U').charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="text-xs font-bold text-text-primary truncate">{user.displayName || 'Global user'}</p>
              <p className="text-xs text-text-dim truncate">{user.email || user.phoneNumber || 'Signed in'}</p>
            </div>
          </div>
          <button 
            onClick={() => { localStorage.removeItem('serenova_user'); auth.signOut(); window.location.href = '/login'; }} 
            className="flex items-center justify-center gap-2 w-full p-2.5 rounded-neu-sm text-xs font-bold text-text-muted hover:text-neu-rose neu-btn focus-neu transition-all"
          >
            <LogOut size={14} /> Disconnect
          </button>
        </div>
      </aside>

      <main className="flex-1 flex flex-col relative overflow-hidden bg-neu-base min-h-0">
        {activeTab === 'today' && <WellnessHub user={user} isPro={isPro} onUpgrade={() => setActiveTab('billing')} />}
        {activeTab === 'chat' && <ChatInterface user={user} isPro={isPro} />}
        {activeTab === 'emotion' && <EmotionFusion isPro={isPro} />}
        {activeTab === 'billing' && <Subscription user={user} setIsPro={setIsPro} isPro={isPro} />}
        {activeTab === 'admin' && isAdmin && <AdminDashboard />}
      </main>
    </div>
  );
}
