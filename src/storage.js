// Saves readings in the browser (localStorage). Nothing is uploaded.
const KEY = "bpwitness.readings.v1";

export function loadReadings() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) ?? [];
  } catch {
    return [];
  }
}

export function saveReading(reading) {
  const all = loadReadings();
  all.unshift(reading);
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // Storage full or blocked (private browsing). The result still shows on screen.
  }
  return all;
}

export function clearReadings() {
  try {
    localStorage.removeItem(KEY);
  } catch {}
}
