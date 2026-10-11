const normalize = value => String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase();
function fuzzy(needle, haystack) {
  const direct = haystack.indexOf(needle);
  if (direct >= 0) return direct + (direct === 0 ? 0 : 20);
  let cursor = 0, cost = 80;
  for (const character of needle) {
    const position = haystack.indexOf(character, cursor);
    if (position < 0) return Infinity;
    cost += position - cursor; cursor = position + 1;
  }
  return cost;
}
export function filterApplications(apps, query = '') {
  const words = normalize(query).trim().split(/\s+/).filter(Boolean);
  return apps.map(app => {
    const name = normalize(app.name);
    const detail = normalize([app.genericName, app.comment, app.keywords, app.categories, app.executable, app.id].join(' '));
    const score = words.reduce((total, word) => total + Math.min(fuzzy(word, name), fuzzy(word, detail) + 40), 0);
    return { app, score };
  }).filter(item => Number.isFinite(item.score)).sort((a, b) => a.score - b.score || a.app.name.localeCompare(b.app.name)).map(item => item.app);
}
export class LauncherModel {
  constructor(apps = []) { this.apps = apps; this.query = ''; this.cursor = 0; this.selected = 0; this.results = filterApplications(apps); }
  filter(query, cursor = Array.from(query).length) {
    this.query = Array.from(query).slice(0, 256).join('');
    this.cursor = Math.max(0, Math.min(Array.from(this.query).length, cursor));
    this.results = filterApplications(this.apps, this.query); this.selected = 0;
  }
  insert(text) {
    const characters = Array.from(this.query), inserted = Array.from(text);
    characters.splice(this.cursor, 0, ...inserted); this.filter(characters.join(''), this.cursor + inserted.length);
  }
  erase(forward = false) {
    const characters = Array.from(this.query), index = forward ? this.cursor : this.cursor - 1;
    if (index < 0 || index >= characters.length) return;
    characters.splice(index, 1); this.filter(characters.join(''), forward ? this.cursor : index);
  }
  moveCursor(delta) { this.cursor = Math.max(0, Math.min(Array.from(this.query).length, this.cursor + delta)); }
  refresh(apps) {
    const id = this.current?.id; this.apps = apps; this.results = filterApplications(apps, this.query);
    this.selected = Math.max(0, this.results.findIndex(app => app.id === id));
  }
  move(delta) { this.selected = Math.max(0, Math.min(Math.max(0, this.results.length - 1), this.selected + delta)); }
  get current() { return this.results[this.selected]; }
}
