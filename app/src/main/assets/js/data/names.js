/* Names for what the add-ons describe in English: genres, catalogues, kinds. */
import {UI} from '../i18n.js';

/* ---------- Hebrew labels for add-on data ---------- */
/* Names of what the add-ons describe in English - genres, catalogue titles, types. They are shown as they
   come unless the interface language has a table for them (English is the source language of the data). */
export const NAMES = {
  he: {
    genre: {Action: 'אקשן', Adventure: 'הרפתקאות', Animation: 'אנימציה', Anime: 'אנימה', Biography: 'ביוגרפיה',
      Comedy: 'קומדיה', Crime: 'פשע', Documentary: 'תיעודי', Drama: 'דרמה', Family: 'משפחה', Fantasy: 'פנטזיה',
      'Film-Noir': 'פילם נואר', 'Game-Show': 'שעשועון', History: 'היסטוריה', Horror: 'אימה', Kids: 'ילדים',
      Music: 'מוזיקה', Musical: 'מחזמר', Mystery: 'מסתורין', News: 'חדשות', 'Reality-TV': 'ריאליטי', Reality: 'ריאליטי',
      Romance: 'רומנטיקה', 'Sci-Fi': 'מדע בדיוני', 'Science Fiction': 'מדע בדיוני', Short: 'סרט קצר', Sport: 'ספורט',
      'Talk-Show': 'תוכנית אירוח', Thriller: 'מותחן', War: 'מלחמה', Western: 'מערבון', 'TV Movie': 'סרט טלוויזיה'},
    type: {movie: 'סרטים', series: 'סדרות', channel: 'ערוצים', tv: 'טלוויזיה'},
    catalog: {Popular: 'פופולרי', New: 'חדש', Featured: 'מומלצים',
      'Netflix Top 10 Movies (Global)': 'Netflix – טופ 10', 'Netflix Top 10 Shows (Global)': 'Netflix – טופ 10',
      'Popular documentaries': 'תיעודיים פופולריים', 'Israeli films': 'סרטים ישראליים', 'New Israeli films': 'סרטים ישראליים חדשים',
      'Israeli series': 'סדרות ישראליות', 'Israeli movies': 'סרטים ישראליים', 'New Israeli movies': 'סרטים ישראליים חדשים',
      'Israeli comedies': 'קומדיות ישראליות', 'Israeli comedy series': 'סדרות קומדיה ישראליות'},
  },
  en: {type: {movie: 'Movies', series: 'Series', channel: 'Channels', tv: 'TV'}},
};
export const nameOf = (kind, s) => NAMES[UI]?.[kind]?.[s] ?? s;
export const genreName = g => nameOf('genre', g);
export const typeName = t => nameOf('type', t);
export const catalogName = n => nameOf('catalog', n);
/** Where a catalogue comes from, for people: the built-in ones are Wikidata searches. */
export const srcName = a => a.local ? 'Wikidata' : a.manifest.name;
