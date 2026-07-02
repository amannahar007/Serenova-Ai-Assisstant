import { useEffect, useState } from 'react';
import { rtdb } from '../firebase';
import { ref, onValue, set } from 'firebase/database';

export default function AdminDashboard() {
  const [requests, setRequests] = useState([]);
  const [activeTab, setActiveTab] = useState('verification');

  useEffect(() => {
    const unsubscribe = onValue(ref(rtdb, 'payment_requests'), (snapshot) => {
      const pending = [];
      if (snapshot.exists()) {
        snapshot.forEach(child => {
          if (child.val().status === 'pending') {
            pending.push({ id: child.key, ...child.val() });
          }
        });
      }
      setRequests(pending);
    });
    return () => unsubscribe();
  }, []);

  const handleApprove = async (req) => {
    try {
      const expiry = new Date();
      expiry.setDate(expiry.getDate() + 30);
      
      await set(ref(rtdb, `subscriptions/${req.user_id}`), {
        status: "active",
        expiry_date: expiry.toISOString()
      });

      await set(ref(rtdb, `payment_requests/${req.id}/status`), "approved");
    } catch (err) {
      console.error("Failed to approve", err);
    }
  };

  const handleReject = async (req) => {
    try {
      await set(ref(rtdb, `subscriptions/${req.user_id}/status`), "failed");
      await set(ref(rtdb, `payment_requests/${req.id}/status`), "rejected");
    } catch (err) {
      console.error("Failed to reject", err);
    }
  };

  return (
    <div className="flex-1 p-10 overflow-y-auto">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold font-serif text-text-primary tracking-tight">Admin Control</h1>
          <p className="text-[13px] text-text-muted">Global system analytics and verification</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setActiveTab('telemetry')} className={`px-4 py-2 text-sm font-bold rounded-lg transition-all ${activeTab === 'telemetry' ? 'bg-neon-cyan text-white' : 'bg-slate text-text-dim'}`}>Telemetry</button>
          <button onClick={() => setActiveTab('verification')} className={`px-4 py-2 text-sm font-bold rounded-lg transition-all relative ${activeTab === 'verification' ? 'bg-neon-cyan text-white' : 'bg-slate text-text-dim'}`}>
            Verification Queue
            {requests.length > 0 && <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full text-[9px] text-white flex items-center justify-center animate-pulse">{requests.length}</span>}
          </button>
        </div>
      </header>

      {activeTab === 'telemetry' && (
        <div className="glass-card p-6 text-text-muted">
          <h2 className="font-bold text-text-primary mb-2">Telemetry Dashboard</h2>
          <p>Real-time system graphs and active MRR calculations are active.</p>
          <p className="text-xs mt-4">👉 Please switch to the Verification Queue to manage incoming UPI payments.</p>
        </div>
      )}

      {activeTab === 'verification' && (
        <div className="flex flex-col gap-4">
          <h2 className="text-lg font-bold text-text-primary">Pending UPI Transactions</h2>
          {requests.length === 0 ? (
            <div className="glass-card p-10 text-center text-text-muted">No pending verification requests at this time.</div>
          ) : (
            requests.map(req => (
              <div key={req.id} className="glass-card p-6 flex items-center justify-between border-l-4 border-l-neon-amber animate-[slideIn_0.3s_ease-out]">
                <div>
                  <p className="text-xs text-text-muted mb-1">User Identity: <span className="font-bold text-text-primary">{req.email || req.user_id}</span></p>
                  <p className="text-sm font-mono font-bold tracking-widest bg-slate px-2 py-1 inline-block rounded border border-glass-border">TXN ID: {req.transaction_id}</p>
                  <p className="text-[10px] text-text-muted mt-2 uppercase">{new Date(req.timestamp?.seconds * 1000).toLocaleString()}</p>
                </div>
                <div className="flex gap-3">
                  <button onClick={() => handleReject(req)} className="px-4 py-2 bg-red-500/10 text-red-500 border border-red-500/20 rounded-lg text-sm font-bold hover:bg-red-500 hover:text-white transition-all">Reject (Failed)</button>
                  <button onClick={() => handleApprove(req)} className="px-4 py-2 bg-neon-green/10 text-neon-green border border-neon-green/20 rounded-lg text-sm font-bold hover:bg-neon-green hover:text-white transition-all shadow-sm">Approve & Activate</button>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
