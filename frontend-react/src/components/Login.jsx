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
    <div className="fixed inset-0 bg-[#fdfcf8]/95 backdrop-blur-md flex items-center justify-center z-50">
      <div className="w-[400px] p-10 rounded-2xl text-center shadow-[0_10px_40px_rgba(0,0,0,0.05)] bg-white border border-[#e6e2d6] relative overflow-hidden">
        <h2 className="font-serif text-2xl mb-2 text-[#2b2927]">Welcome to SERENOVA</h2>
        <p className="text-sm font-semibold text-[#3b5b59] mb-1">Intelligence That Understands You</p>
        <p className="text-sm text-[#858076] mb-8">Log in to continue.</p>
        
        {error && <p className="text-red-500 text-xs mb-4">{error}</p>}

        <div className="flex flex-col gap-3 mb-6">
          <button 
            onClick={() => handleOAuth(googleProvider)}
            className="flex items-center justify-center gap-3 p-3 rounded-lg border border-[#e6e2d6] bg-white text-[#2b2927] text-sm font-semibold cursor-pointer transition-all hover:bg-[#f5f3eb] hover:border-[#d1ccbf] hover:-translate-y-px"
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
        </div>
        
        <div className="flex items-center mb-6 text-[#858076] text-xs">
          <div className="flex-1 border-b border-[#e6e2d6] mx-3"></div>
          <span>OR EMAIL</span>
          <div className="flex-1 border-b border-[#e6e2d6] mx-3"></div>
        </div>
        
        <form onSubmit={handleEmailAuth} className="flex flex-col gap-3">
          <input 
            type="email" 
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email address" 
            className="p-3 px-4 rounded-lg border border-[#e6e2d6] outline-none font-main focus:border-[#3b5b59]"
            required
          />
          <input 
            type="password" 
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password" 
            className="p-3 px-4 rounded-lg border border-[#e6e2d6] outline-none font-main focus:border-[#3b5b59]"
            required
          />
          <button type="submit" className="p-3 rounded-lg border-none font-semibold cursor-pointer transition-all bg-[#3b5b59] text-white hover:bg-[#2f4a48] hover:-translate-y-px mt-2 shadow-sm">
            {isLogin ? 'Enter Interface' : 'Create Access Key'}
          </button>
        </form>
        
        <p className="mt-4 text-xs text-[#858076] cursor-pointer hover:text-[#3b5b59]" onClick={() => setIsLogin(!isLogin)}>
          {isLogin ? 'Need an account? Sign up' : 'Already have access? Log in'}
        </p>
      </div>
    </div>
  );
}
