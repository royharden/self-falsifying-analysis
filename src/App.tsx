import { AnalysisPage } from './pages/AnalysisPage';
import { AttemptRoute } from './pages/AttemptRoute';
import { AuthPage } from './pages/AuthPage';
import { BenchPage } from './pages/BenchPage';
import { HomePage } from './pages/HomePage';
import { NewAnalysisPage } from './pages/NewAnalysisPage';
import { SharePage } from './pages/SharePage';
import { useAuth } from './lib/auth';
import { useRoute } from './lib/router';
import { supabase } from './lib/supabase';

export function App() {
  const route = useRoute();
  const auth = useAuth();
  return (
    <>
      <header className="top">
        <a className="brand" href="#/">Self-falsifying analysis</a>
        <nav>
          <a href="#/new">New analysis</a>
          <a href="#/bench">Bench</a>
          {auth.email ? <span className="who">{auth.email}</span> : <a href="#/login">Sign in</a>}
          {auth.email ? (
            <button type="button" className="text" onClick={() => void supabase?.auth.signOut()}>Sign out</button>
          ) : null}
        </nav>
      </header>
      <main>
        {!auth.configured ? (
          <p className="banner">
            Local guided mode: no backend is configured (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY). Demos, CSV analyses, reruns,
            exports and the benchmark run entirely in this tab. Nothing is saved or uploaded, and a reload loses unsaved work.
          </p>
        ) : null}
        {route.name === 'home' ? <HomePage /> : null}
        {route.name === 'auth' ? <AuthPage key={route.mode} mode={route.mode} /> : null}
        {route.name === 'new' ? <NewAnalysisPage /> : null}
        {route.name === 'bench' ? <BenchPage /> : null}
        {route.name === 'analysis' ? <AnalysisPage key={route.id} id={route.id} /> : null}
        {route.name === 'attempt' ? <AttemptRoute key={`${route.id}:${route.ordinal}`} id={route.id} ordinal={route.ordinal} /> : null}
        {route.name === 'share' ? <SharePage key={route.token} token={route.token} /> : null}
        {route.name === 'share-attempt' ? <SharePage key={`${route.token}:${route.ordinal}`} token={route.token} ordinal={route.ordinal} /> : null}
      </main>
    </>
  );
}
