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
      className={`flex items-center gap-3 p-3 rounded-lg text-sm font-medium transition-all ${activeTab === id ? 'bg-white text-neon-cyan border border-glass-border shadow-sm' : 'text-text-dim hover:bg-black/5 hover:text-text-primary'}`}
    >
      <Icon size={18} /> {label}
    </button>
  );

  return (
    <div className="flex h-screen bg-[#f7f4ec] text-text-primary">
      <aside className="w-72 bg-[#fcfaf5] border-r border-[#ded5c4] flex flex-col p-6">
        <div className="flex items-center gap-4 mb-8">
          <div className="w-11 h-11 bg-[#2f5d62] text-white rounded-lg flex items-center justify-center font-bold text-xl shadow-sm overflow-hidden">
            {user?.photoURL ? (
              <img src={user.photoURL} alt="Profile" className="w-full h-full object-cover" />
            ) : (
              'S'
            )}
          </div>
          <div className="flex flex-col">
            <span className="font-serif font-bold text-lg leading-tight">{user?.displayName || 'SERENOVA'}</span>
            <span className="text-[10px] text-text-muted font-mono">Universal health + knowledge AI</span>
          </div>
        </div>

        <nav className="flex flex-col gap-2 flex-1">
          {navItem('today', Sparkles, 'Today')}
          {navItem('chat', MessageSquare, 'Ask Anything')}
          {navItem('emotion', BrainCircuit, `Emotion Core ${isPro ? 'Active' : 'Premium'}`)}
          {navItem('billing', CreditCard, 'Plans & Payment')}
          {isAdmin && navItem('admin', BarChart2, 'Analytics')}
        </nav>

        <div className="mt-auto rounded-lg border border-[#ded5c4] bg-white p-4">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-8 h-8 rounded-full bg-neon-cyan text-white flex items-center justify-center text-xs font-bold">
              {(user.email || user.phoneNumber || 'U').charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="text-xs font-bold text-[#24211e] truncate">{user.displayName || 'Global user'}</p>
              <p className="text-xs text-text-dim truncate">{user.email || user.phoneNumber || 'Signed in'}</p>
            </div>
          </div>
          <button onClick={() => auth.signOut()} className="flex items-center gap-3 w-full p-2 text-sm text-text-muted hover:text-neon-purple transition-colors">
            <LogOut size={16} /> Disconnect
          </button>
        </div>
      </aside>

      <main className="flex-1 flex flex-col relative overflow-hidden">
        {activeTab === 'today' && <WellnessHub user={user} isPro={isPro} onUpgrade={() => setActiveTab('billing')} />}
        {activeTab === 'chat' && <ChatInterface user={user} isPro={isPro} />}
        {activeTab === 'emotion' && (isPro ? <EmotionFusion user={user} /> : <Subscription user={user} setIsPro={setIsPro} />)}
        {activeTab === 'billing' && <Subscription user={user} setIsPro={setIsPro} isPro={isPro} />}
        {activeTab === 'admin' && isAdmin && <AdminDashboard />}
      </main>
    </div>
  );
}
