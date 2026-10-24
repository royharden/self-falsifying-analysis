import { useState, type FormEvent } from 'react';
import { useAuth } from '../lib/auth';
import { supabase, supabaseReady } from '../lib/supabase';

export function AuthPage({ mode }: { mode: 'login' | 'signup' }) {
  const auth = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    if (!supabase) {
      setError('Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
      return;
    }
    setBusy(true);
    if (mode === 'signup') {
      const { data, error: signError } = await supabase.auth.signUp({ email, password });
      setBusy(false);
      if (signError) {
        setError(signError.message);
        return;
      }
      if (!data.session) {
        setMessage('Account created. Confirm the email if the project requires it, then sign in.');
        return;
      }
      window.location.hash = '#/';
      return;
    }
    const { error: signError } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (signError) {
      setError(signError.message);
      return;
    }
    window.location.hash = '#/';
  }

  return (
    <section>
      <h1>{mode === 'signup' ? 'Create an account' : 'Sign in'}</h1>
      {!supabaseReady ? (
        <p className="error" role="alert">Supabase is not configured. The workshop demo still runs without an account.</p>
      ) : null}
      {auth.email ? <p>Signed in as {auth.email}.</p> : null}
      <form className="stack" onSubmit={(event) => void onSubmit(event)}>
        <label>
          Email
          <input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
        </label>
        <label>
          Password
          <input
            type="password"
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            minLength={8}
            required
          />
        </label>
        {error ? <p className="error" role="alert">{error}</p> : null}
        {message ? <p role="status">{message}</p> : null}
        <button type="submit" disabled={busy || !supabaseReady}>{busy ? 'Working…' : mode === 'signup' ? 'Create account' : 'Sign in'}</button>
      </form>
      {mode === 'login' ? <p><a href="#/signup">Create an account</a></p> : <p><a href="#/login">Sign in</a></p>}
    </section>
  );
}
