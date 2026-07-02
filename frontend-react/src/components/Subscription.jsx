import { useEffect, useMemo, useState } from 'react';
import { functions, rtdb } from '../firebase';
import { httpsCallable } from 'firebase/functions';
import { onValue, ref, set, serverTimestamp } from 'firebase/database';
import QRCode from 'react-qr-code';
import { Brain, CheckCircle2, CreditCard, FileText, HeartPulse, ShieldCheck, Sparkles, Smartphone, Users, Watch } from 'lucide-react';

const UPI_ID = 'amannahar0807@oksbi';

const premiumFeatures = [
  { icon: Brain, label: 'Face and gesture health analysis' },
  { icon: HeartPulse, label: 'Stress, fatigue, and heart-rate estimation' },
  { icon: Sparkles, label: 'Unlimited priority AI responses' },
  { icon: FileText, label: 'Daily health card and reports' }
];

const tiers = [
  {
    name: 'Free',
    price: 0,
    amount: 'Rs.0',
    suffix: '',
    body: '20 messages/day, multilingual chat, memory basics',
    icon: Sparkles
  },
  {
    name: 'Premium',
    price: 90,
    amount: 'Rs.90',
    suffix: '/ month',
    body: 'Unlimited chat, face analysis, mood journal, daily health card',
    icon: Brain
  },
  {
    name: 'Pro',
    price: 299,
    amount: 'Rs.299',
    suffix: '/ month',
    body: 'Doctor connect, PDF reports, wearable sync, priority support',
    icon: Watch
  },
  {
    name: 'Family',
    price: 499,
    amount: 'Rs.499',
    suffix: '/ month',
    body: '5 family members, shared wellness dashboard, family nudges',
    icon: Users
  }
];

function loadRazorpayScript() {
  return new Promise((resolve) => {
    if (window.Razorpay) {
      resolve(true);
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
}

export default function Subscription({ user, setIsPro }) {
  const [subscription, setSubscription] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedTier, setSelectedTier] = useState('Premium');
  const [transactionId, setTransactionId] = useState('');
  const [upiSubmitted, setUpiSubmitted] = useState(false);

  const tier = tiers.find((item) => item.name === selectedTier) || tiers[1];
  const expiresAt = subscription?.planExpiresAt || Date.parse(subscription?.expiry_date || '');
  const isActive = subscription?.status === 'active' && Number(expiresAt) > Date.now();

  const upiUrl = useMemo(() => {
    const params = new URLSearchParams({
      pa: UPI_ID,
      pn: 'SERENOVA',
      am: String(tier.price),
      cu: 'INR',
      tn: `${tier.name} plan for SERENOVA`
    });
    return `upi://pay?${params.toString()}`;
  }, [tier.name, tier.price]);

  useEffect(() => {
    if (!user?.uid) return;
    const unsubscribe = onValue(ref(rtdb, `subscriptions/${user.uid}`), (snapshot) => {
      const data = snapshot.val();
      const nextExpiresAt = data?.planExpiresAt || Date.parse(data?.expiry_date || '');
      setSubscription(data);
      setIsPro(Boolean(data?.status === 'active' && Number(nextExpiresAt) > Date.now()));
    });
    return () => unsubscribe();
  }, [setIsPro, user?.uid]);

  const handleRazorpayUpgrade = async () => {
    setLoading(true);
    setError('');

    try {
      const scriptLoaded = await loadRazorpayScript();
      if (!scriptLoaded) {
        throw new Error('Unable to load Razorpay Checkout. Use Google Pay UPI below or try again.');
      }

      const createPremiumOrder = httpsCallable(functions, 'createPremiumOrder');
      const verifyPremiumPayment = httpsCallable(functions, 'verifyPremiumPayment');
      const { data: order } = await createPremiumOrder();

      const checkout = new window.Razorpay({
        key: order.keyId,
        amount: order.amount,
        currency: order.currency,
        name: 'SERENOVA Health Assistant',
        description: 'Premium Plan - Face and Gesture Analysis',
        order_id: order.id,
        prefill: {
          name: user.displayName || '',
          email: user.email || ''
        },
        notes: {
          uid: user.uid,
          plan: 'premium'
        },
        theme: { color: '#2f5d62' },
        handler: async (response) => {
          const { data } = await verifyPremiumPayment(response);
          setSubscription(data);
          setIsPro(true);
          setLoading(false);
        },
        modal: {
          ondismiss: () => setLoading(false)
        }
      });

      checkout.on('payment.failed', (response) => {
        setError(response.error?.description || 'Payment failed. Please try again.');
        setLoading(false);
      });

      checkout.open();
    } catch (err) {
      console.error(err);
      setError(err.message || 'Upgrade failed. Please try again.');
      setLoading(false);
    }
  };

  const submitUpiPayment = async (event) => {
    event.preventDefault();
    if (!transactionId.trim() || !user?.uid) return;

    setLoading(true);
    setError('');
    try {
      await set(ref(rtdb, `payment_requests/${user.uid}`), {
        user_id: user.uid,
        email: user.email || user.phoneNumber || 'unknown',
        plan: tier.name.toLowerCase(),
        amount: tier.price,
        currency: 'INR',
        upi_id: UPI_ID,
        transaction_id: transactionId.trim(),
        status: 'pending',
        timestamp: serverTimestamp()
      });
      await set(ref(rtdb, `subscriptions/${user.uid}`), {
        user_id: user.uid,
        plan: tier.name.toLowerCase(),
        status: 'pending',
        paymentMethod: 'upi',
        updatedAt: serverTimestamp()
      });
      setUpiSubmitted(true);
      setTransactionId('');
    } catch (err) {
      console.error(err);
      setError('Could not submit UPI payment for verification.');
    } finally {
      setLoading(false);
    }
  };

  if (isActive) {
    return (
      <div className="flex-1 bg-[#f7f4ec] p-10 flex flex-col items-center justify-center">
        <div className="rounded-lg border border-[#ded5c4] bg-white p-10 text-center max-w-md shadow-sm">
          <CheckCircle2 className="mx-auto mb-4 text-neon-green" size={44} />
          <h2 className="text-2xl font-serif font-bold text-text-primary mb-2">Premium Active</h2>
          <p className="text-text-muted mb-6 text-sm">Face analysis, daily cards, reports, and unlimited chat are unlocked.</p>
          <div className="p-4 bg-neon-green/10 text-neon-green border border-neon-green/20 rounded-lg text-sm font-bold">
            Valid until {new Date(expiresAt).toLocaleDateString()}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto bg-[#f7f4ec] p-6 lg:p-8">
      <div className="mx-auto grid max-w-7xl gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <section className="rounded-lg border border-[#ded5c4] bg-white p-6 shadow-sm">
          <div className="mb-6 flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-[#846a4e]">Plans for a worldwide audience</p>
              <h1 className="mt-1 text-3xl font-bold tracking-tight text-[#24211e]">Choose how SERENOVA grows with you.</h1>
              <p className="mt-2 text-sm leading-6 text-[#66615a]">
                Built for students, parents, professionals, elders, and teams. Ask anything, track wellness, and upgrade when you need richer care.
              </p>
            </div>
            <ShieldCheck className="shrink-0 text-[#2f5d62]" size={38} />
          </div>

          <div className="grid gap-3">
            {tiers.map(({ icon: Icon, ...item }) => (
              <button
                key={item.name}
                onClick={() => setSelectedTier(item.name)}
                className={`rounded-lg border p-4 text-left transition ${selectedTier === item.name ? 'border-[#2f5d62] bg-[#e8f3ef]' : 'border-[#e8dfd0] bg-[#fbfaf6] hover:border-[#2f5d62]'}`}
              >
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white text-[#2f5d62]">
                    <Icon size={19} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="font-bold text-[#24211e]">{item.name}</p>
                      <p className="font-bold text-[#2f5d62]">{item.amount}<span className="text-xs font-normal text-[#66615a]">{item.suffix}</span></p>
                    </div>
                    <p className="mt-1 text-sm leading-5 text-[#66615a]">{item.body}</p>
                  </div>
                </div>
              </button>
            ))}
          </div>

          <div className="mt-6 grid gap-3">
            {premiumFeatures.map(({ icon: Icon, label }) => (
              <div key={label} className="flex items-center gap-3 rounded-lg border border-[#e8dfd0] bg-[#fbfaf6] px-4 py-3">
                <Icon size={18} className="text-[#2f5d62] shrink-0" />
                <span className="text-sm text-[#24211e]">{label}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="grid gap-6">
          <div className="rounded-lg border border-[#ded5c4] bg-white p-6 shadow-sm">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-[#846a4e]">Google Pay / UPI</p>
                <h2 className="mt-1 text-2xl font-bold text-[#24211e]">Pay to {UPI_ID}</h2>
                <p className="mt-2 text-sm leading-6 text-[#66615a]">
                  Scan this QR in Google Pay, PhonePe, Paytm, or any UPI app. After payment, submit the transaction ID for admin verification.
                </p>
              </div>
              <Smartphone className="shrink-0 text-[#2f5d62]" size={34} />
            </div>

            <div className="mt-5 grid gap-5 md:grid-cols-[220px_1fr] md:items-center">
              <div className="rounded-lg border border-[#e8dfd0] bg-white p-4">
                <QRCode value={upiUrl} size={188} />
              </div>
              <div>
                <div className="rounded-lg bg-[#fbfaf6] p-4">
                  <p className="text-xs font-bold uppercase tracking-wider text-[#847d72]">Selected plan</p>
                  <p className="mt-1 text-3xl font-bold text-[#24211e]">{tier.amount}<span className="text-sm font-normal text-[#66615a]">{tier.suffix}</span></p>
                  <p className="mt-1 text-sm text-[#66615a]">{tier.name} plan via UPI</p>
                </div>
                <a href={upiUrl} className="mt-4 inline-flex w-full items-center justify-center rounded-lg bg-[#2f5d62] px-4 py-3 text-sm font-bold text-white transition hover:bg-[#23494d]">
                  Open Google Pay / UPI app
                </a>
              </div>
            </div>

            <form onSubmit={submitUpiPayment} className="mt-5 grid gap-3">
              <label className="text-xs font-bold uppercase tracking-wider text-[#847d72]" htmlFor="upi-transaction">
                UPI transaction ID
              </label>
              <input
                id="upi-transaction"
                value={transactionId}
                onChange={(event) => setTransactionId(event.target.value)}
                placeholder="Enter Google Pay transaction/reference ID"
                className="rounded-lg border border-[#ded5c4] bg-[#fbfaf6] px-4 py-3 text-sm outline-none focus:border-[#2f5d62]"
              />
              <button disabled={loading || !transactionId.trim()} className="rounded-lg border border-[#2f5d62] px-4 py-3 text-sm font-bold text-[#2f5d62] transition hover:bg-[#e8f3ef] disabled:opacity-50">
                {loading ? 'Submitting...' : 'Submit UPI payment for verification'}
              </button>
            </form>

            {upiSubmitted && (
              <div className="mt-4 rounded-lg border border-[#b58c42]/30 bg-[#fbf1dc] p-3 text-sm font-bold text-[#8a682e]">
                Payment submitted. Premium unlocks after admin verification.
              </div>
            )}
          </div>

          <div className="rounded-lg border border-[#ded5c4] bg-white p-6 shadow-sm">
            <div className="flex items-center gap-3">
              <CreditCard className="text-[#2f5d62]" />
              <div>
                <h2 className="text-xl font-bold text-[#24211e]">Secure card/netbanking checkout</h2>
                <p className="text-sm text-[#66615a]">Razorpay remains available for automated Premium activation.</p>
              </div>
            </div>

            {error && (
              <div className="mt-4 rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-600">
                {error}
              </div>
            )}

            <button onClick={handleRazorpayUpgrade} disabled={loading || selectedTier !== 'Premium'} className="mt-5 w-full rounded-lg bg-[#1f2933] px-4 py-3 text-sm font-bold text-white transition hover:bg-[#111827] disabled:opacity-50">
              {selectedTier === 'Premium' ? (loading ? 'Opening secure checkout...' : 'Pay Premium with Razorpay') : 'Razorpay auto-checkout currently supports Premium'}
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
