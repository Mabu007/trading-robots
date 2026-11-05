export type AppTheme='light'|'dark';
const THEME_KEY='trading-vibes:theme';

export function normalizeTheme(value:unknown):AppTheme{return value==='dark'?'dark':'light'}

export function readThemePreference(storage?:Pick<Storage,'getItem'>):AppTheme{
 try{return normalizeTheme((storage||globalThis.localStorage).getItem(THEME_KEY))}catch{return 'light'}
}

export function saveThemePreference(theme:AppTheme,storage?:Pick<Storage,'setItem'>):void{
 try{(storage||globalThis.localStorage).setItem(THEME_KEY,normalizeTheme(theme))}catch{/* Keep the current session usable when browser storage is disabled. */}
}
