import { useEffect, useState } from 'react';
import * as api from '../services/recut.js';
import { recutErrorText } from '../services/recutFlow.js';

// 同意的讀取與「這門課要補哪些同意」：製作頁用。
export default function useRecutConsent(courseId) {
  const [terms, setTerms] = useState(null);
  const [consent, setConsent] = useState(null);
  const [error, setError] = useState('');
  const [loadedFor, setLoadedFor] = useState('');
  useEffect(() => {
    if (!courseId) return undefined;
    let alive = true;
    Promise.all([api.getConsentTerms(), api.getConsent(courseId)])
      .then(([nextTerms, nextConsent]) => { if (alive) { setTerms(nextTerms); setConsent(nextConsent); setError(''); setLoadedFor(courseId); } })
      .catch((err) => { if (alive) { setError(recutErrorText(err)); setLoadedFor(courseId); } });
    return () => { alive = false; };
  }, [courseId]);
  const loading = Boolean(courseId) && loadedFor !== courseId;
  return { terms, consent: loadedFor === courseId ? consent : null, setConsent, error, loading };
}
