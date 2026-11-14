import { createElement } from 'react';

export default function CitationRetrievalLabel({ label }) {
  if (!label) return null;
  return createElement('span', { 'aria-label': `比對方式：${label}` }, ` · 比對方式 ${label}`);
}
