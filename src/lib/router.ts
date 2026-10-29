import { useEffect, useState } from 'react';

export type Route =
  | { name: 'home' }
  | { name: 'auth'; mode: 'login' | 'signup' | 'forgot' | 'reset' }
  | { name: 'new' }
  | { name: 'bench' }
  | { name: 'analysis'; id: string }
  | { name: 'attempt'; id: string; ordinal: number }
  | { name: 'share'; token: string }
  | { name: 'share-attempt'; token: string; ordinal: number };

export function parseHash(hash: string): Route {
  const parts = (hash.replace(/^#/, '') || '/').split('/').filter(Boolean);
  if (parts.length === 0) return { name: 'home' };
  if (parts[0] === 'login') return { name: 'auth', mode: 'login' };
  if (parts[0] === 'signup') return { name: 'auth', mode: 'signup' };
  if (parts[0] === 'forgot') return { name: 'auth', mode: 'forgot' };
  if (parts[0] === 'reset') return { name: 'auth', mode: 'reset' };
  if (parts[0] === 'new') return { name: 'new' };
  if (parts[0] === 'bench') return { name: 'bench' };
  if (parts[0] === 'analyses' && parts[1] && parts[2] === 'attempts' && parts[3]) {
    const ordinal = Number(parts[3]);
    if (Number.isInteger(ordinal)) return { name: 'attempt', id: decodeURIComponent(parts[1]), ordinal };
  }
  if (parts[0] === 'analyses' && parts[1]) return { name: 'analysis', id: decodeURIComponent(parts[1]) };
  if (parts[0] === 'share' && parts[1] && parts[2] === 'attempts' && parts[3]) {
    const ordinal = Number(parts[3]);
    if (Number.isInteger(ordinal)) return { name: 'share-attempt', token: decodeURIComponent(parts[1]), ordinal };
  }
  if (parts[0] === 'share' && parts[1]) return { name: 'share', token: decodeURIComponent(parts[1]) };
  return { name: 'home' };
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}
