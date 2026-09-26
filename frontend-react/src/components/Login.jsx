import { useState } from 'react';
import { 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signInWithPopup
} from 'firebase/auth';
import { auth, googleProvider } from '../firebase';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLogin, setIsLogin] = useState(true);
  const [error, setError] = useState('');

  const handleEmailAuth = async (e) => {
    e.preventDefault();
    setError('');
    try {
      if (isLogin) {
        await signInWithEmailAndPassword(auth, email, password);
      } else {
        await createUserWithEmailAndPassword(auth, email, password);
      }
    } catch (err) {
      setError(err.message);
    }
  };

  const handleOAuth = async (provider) => {
    try {
      await signInWithPopup(auth, provider);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="fixed inset-0 bg-neu-base/95 backdrop-blur-md flex items-center justify-center z-50 p-4">
      <div className="w-[420px] p-8 sm:p-10 rounded-neu-xl text-center neu-card border border-white/80 relative overflow-hidden bg-neu-base">
        <h2 className="font-serif text-2xl mb-1 text-text-primary font-bold">Welcome to SERENOVA</h2>
        <p className="text-sm font-semibold text-neu-teal mb-1">Intelligence That Understands You</p>
        <p className="text-xs text-text-muted mb-6">Log in to enter the interface.</p>
        
        {error && <div className="neu-inset bg-red-50 text-red-800 text-xs p-2.5 rounded-neu-sm mb-4 border border-red-200">{error}</div>}

        <div className="flex flex-col gap-3 mb-6">
          <button 
            onClick={() => handleOAuth(googleProvider)}
            className="flex items-center justify-center gap-3 p-3 rounded-neu-sm neu-btn text-text-primary text-sm font-semibold cursor-pointer transition-all focus-neu border border-white/60"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" xmlns="http://www.w3.org/2000/svg">
              <g transform="matrix(1, 0, 0, 1, 27.009001, -39.238998)">
                <path fill="#4285F4" d="M -3.264 51.509 C -3.264 50.719 -3.334 49.969 -3.454 49.239 L -14.754 49.239 L -14.754 53.749 L -8.284 53.749 C -8.574 55.229 -9.424 56.479 -10.684 57.329 L -10.684 60.329 L -6.824 60.329 C -4.564 58.239 -3.264 55.159 -3.264 51.509 Z"/>
                <path fill="#34A853" d="M -14.754 63.239 C -11.514 63.239 -8.804 62.159 -6.824 60.329 L -10.684 57.329 C -11.764 58.049 -13.134 58.489 -14.754 58.489 C -17.884 58.489 -20.534 56.379 -21.484 53.529 L -25.464 53.529 L -25.464 56.619 C -23.494 60.539 -19.444 63.239 -14.754 63.239 Z"/>
                <path fill="#FBBC05" d="M -21.484 53.529 C -21.734 52.809 -21.864 52.039 -21.864 51.239 C -21.864 50.439 -21.724 49.669 -21.484 48.949 L -21.484 45.859 L -25.464 45.859 C -26.284 47.479 -26.754 49.299 -26.754 51.239 C -26.754 53.179 -26.284 54.999 -25.464 56.619 L -21.484 53.529 Z"/>
                <path fill="#EA4335" d="M -14.754 43.989 C -12.984 43.989 -11.404 44.599 -10.154 45.789 L -6.734 42.369 C -8.804 40.429 -11.514 39.239 -14.754 39.239 C -19.444 39.239 -23.494 41.939 -25.464 45.859 L -21.484 48.949 C -20.534 46.099 -17.884 43.989 -14.754 43.989 Z"/>
              </g>
            </svg>
            Sign in with Google
          </button>
          <button 
            type="button"
            onClick={() => {
              localStorage.setItem('serenova_user', JSON.stringify({
                uid: 'local_dev_user',
                email: 'aman@serenova.ai',
                displayName: 'Aman Nahar'
              }));
              window.location.href = '/';
            }}
            className="flex items-center justify-center gap-2 p-3 rounded-neu-sm neu-card-flat text-text-primary text-sm font-semibold cursor-pointer transition-all hover:text-neu-teal focus-neu border border-white/60"
          >
            Continue as Guest / Demo
          </button>
        </div>
        
        <div className="flex items-center mb-6 text-text-muted text-xs">
          <div className="flex-1 border-b border-[#ded7c8] mx-3"></div>
          <span className="font-semibold tracking-wider">OR EMAIL</span>
          <div className="flex-1 border-b border-[#ded7c8] mx-3"></div>
        </div>
        
        <form onSubmit={handleEmailAuth} className="flex flex-col gap-3">
          <input 
            type="email" 
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email address" 
            className="p-3 px-4 rounded-neu-sm neu-inset bg-neu-dark text-text-primary placeholder:text-text-muted outline-none font-main border border-[#ded7c8]/50 focus-neu"
            required
          />
          <input 
            type="password" 
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password" 
            className="p-3 px-4 rounded-neu-sm neu-inset bg-neu-dark text-text-primary placeholder:text-text-muted outline-none font-main border border-[#ded7c8]/50 focus-neu"
            required
          />
          <button type="submit" className="p-3.5 rounded-neu-sm font-bold cursor-pointer transition-all neu-btn-teal text-white mt-2 focus-neu">
            {isLogin ? 'Enter Interface' : 'Create Access Key'}
          </button>
        </form>
        
        <p className="mt-5 text-xs text-text-muted cursor-pointer hover:text-neu-teal transition-colors" onClick={() => setIsLogin(!isLogin)}>
          {isLogin ? 'Need an account? Sign up' : 'Already have access? Log in'}
        </p>
      </div>
    </div>
  );
}
