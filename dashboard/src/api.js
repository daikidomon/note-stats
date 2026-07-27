async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`API error ${res.status}: ${url}`);
  }
  return res.json();
}

export const fetchWeeks = () => getJson('/api/weeks');
export const fetchSummary = () => getJson('/api/summary');
export const fetchWeek = (start) => getJson(`/api/week?start=${encodeURIComponent(start)}`);
