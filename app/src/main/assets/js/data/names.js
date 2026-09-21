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
NAMES.he.group = {Israel: 'ישראל', News: 'חדשות', Sport: 'ספורט', Sports: 'ספורט', Kids: 'ילדים', Children: 'ילדים',
  Movies: 'סרטים', Series: 'סדרות', Music: 'מוזיקה', Documentary: 'תיעודי', Documentaries: 'תיעודי', Entertainment: 'בידור',
  General: 'כללי', Religious: 'דת', Lifestyle: 'לייף סטייל', Nature: 'טבע', Cooking: 'בישול', Travel: 'טיולים',
  Arabic: 'ערבית', Russian: 'רוסית', Radio: 'רדיו', Channels: 'ערוצים'};
export const nameOf = (kind, s) => NAMES[UI]?.[kind]?.[s] ?? s;
export const genreName = g => nameOf('genre', g);
export const typeName = t => nameOf('type', t);
export const catalogName = n => nameOf('catalog', n);
/** A group of channels, as a playlist names it (in English, mostly). */
export const groupName = g => nameOf('group', g);
/* Israel's channels as a Hebrew viewer knows them. Playlists name them in English, with the picture's
   quality tacked on ("Kan 11 HD", "Ch 14 HD", "Channel HD 9"): that is written the way the viewer reads
   it - the whole name, so "Sport 5 Gold" is not taken for "Sport 5" - and any other channel is shown as
   the playlist has it, without the "HD". */
const HE_CHANNELS = [
  [/^kan\s*11$/i, 'כאן 11'], [/^(keshet|channel|ch)\s*12$/i, 'קשת 12'], [/^(reshet|channel|ch)\s*13$/i, 'רשת 13'],
  [/^(now|channel|ch)\s*14$/i, 'עכשיו 14'], [/^((channel|ch)\s*(hd\s*)?9|9\s*channel)$/i, 'ערוץ 9'], [/^(channel|ch)\s*10$/i, 'ערוץ 10'],
  [/^i24\s*news\s*hebrew$/i, 'i24NEWS בעברית'], [/^i24\s*news\s*arabic$/i, 'i24NEWS בערבית'], [/^i24\s*news\s*english$/i, 'i24NEWS באנגלית'],
  [/^makan\s*33$/i, 'מכאן 33'], [/^kan\s*(educational|23|hinuchit)$/i, 'כאן חינוכית'], [/^(knesset|channel\s*99)$/i, 'ערוץ הכנסת'],
  [/^sport\s*5$/i, 'ספורט 5'], [/^sport\s*1$/i, 'ספורט 1'], [/^hop!?$/i, 'הופ!'], [/^kan\s*kids$/i, 'כאן ילדים'],
];
export function channelName(name){
  const plain = String(name || '').replace(/\s+(u?hd|fhd|sd|4k|hevc)$/i, '').trim();
  if(UI !== 'he') return plain;
  return HE_CHANNELS.find(([re]) => re.test(plain))?.[1] || plain;
}
/** Where a catalogue comes from, for people: the built-in ones are Wikidata searches; one that says
    its own ([src], '' for none - the suggestions, data/taste.js) says so. */
export const srcName = a => a.src ?? (a.local ? 'Wikidata' : a.manifest.name);
