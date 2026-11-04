import { useEffect, useState } from 'react';

// 跟 index.css 的斷點一致；預設 768px 以下視為手機單欄版面。
export default function useCompactLayout(query = '(max-width: 768px)') {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const handleChange = (event) => setMatches(event.matches);
    media.addEventListener('change', handleChange);
    return () => media.removeEventListener('change', handleChange);
  }, [query]);
  return matches;
}
