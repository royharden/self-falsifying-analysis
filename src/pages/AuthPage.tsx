import { useState, type FormEvent } from 'react';
import { useAuth } from '../lib/auth';
import { authRedirect, supabase, supabaseReady } from '../lib/supabase';

type Mode = 'login' | 'signup' | 'forgot' | 'reset';

const TITLE: Record<Mode, string> = {
  login: 'Sign in',
  signup: 'Create an account',
  forgot: 'Reset your password',
  reset: 'Choose a new password',
};

/**
 * Email/password auth. Paid model planning additionally needs a confirmed email.
 * Redirect URLs must be in the project's allowlist; recovery behaviour on the
 * hosted origin is unverified until activation.
 */
export function AuthPage({ mode }: { mode: Mode }) {
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
      setError('The backend is not configured. Local mode needs no account.');
      return;
    }
    setBusy(true);
    try {
      if (mode === 'signup') {
        const { data, error: signError } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: authRedirect('#/') },
        });
        if (signError) setError(signError.message);
        else if (!data.session) setMessage('Check your inbox to confirm the address, then sign in.');
        else window.location.hash = '#/';
      } else if (mode === 'login') {
        const { error: signError } = await supabase.auth.signInWithPassword({ email, password });
        if (signError) setError(signError.message);
        else window.location.hash = '#/';
      } else if (mode === 'forgot') {
        const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: authRedirect('#/reset') });
        // Same message either way so the form does not reveal which addresses have accounts.
        if (resetError && resetError.status !== 400) setError(resetError.message);
        else setMessage('If that address has an account, a reset link is on its way.');
      } else {
        const { error: updateError } = await supabase.auth.updateUser({ password });
        if (updateError) setError(updateError.message);
        else {
          setMessage('Password updated.');
          window.location.hash = '#/';
        }
      }
    } finally {
      setBusy(false);
    }
  }

  const needsEmail = mode !== 'reset';
  const needsPassword = mode !== 'forgot';

  return (
    <section>
      <h1>{TITLE[mode]}</h1>
      {!supabaseReady ? <p className="error" role="alert">The backend is not configured. Demos, CSV analyses and the benchmark work without an account.</p> : null}
      {auth.email && mode !== 'reset' ? (
        <p>
          Signed in as {auth.email}.{' '}
          {auth.emailVerified ? 'Email confirmed.' : 'Email not confirmed yet: saving works, the paid model planner does not.'}
        </p>
      ) : null}
      {mode === 'reset' && !auth.email ? <p className="muted">Open this page from the reset link in your email.</p> : null}
      <form className="stack" onSubmit={(event) => void onSubmit(event)}>
        {needsEmail ? (
          <label>
            Email
            <input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
          </label>
        ) : null}
        {needsPassword ? (
          <label>
            {mode === 'reset' ? 'New password' : 'Password'}
            <input
              type="password"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              minLength={8}
              required
            />
          </label>
        ) : null}
        {error ? <p className="error" role="alert">{error}</p> : null}
        {message ? <p role="status">{message}</p> : null}
        <button type="submit" disabled={busy || !supabaseReady || (mode === 'reset' && !auth.email)}>
          {busy ? 'Working…' : TITLE[mode]}
        </button>
      </form>
      <p className="actions">
        {mode !== 'login' ? <a href="#/login">Sign in</a> : null}
        {mode !== 'signup' ? <a href="#/signup">Create an account</a> : null}
        {mode !== 'forgot' && mode !== 'reset' ? <a href="#/forgot">Forgot password</a> : null}
      </p>
    </section>
  );
}
