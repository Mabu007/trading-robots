const dateOptions: Intl.DateTimeFormatOptions = {day:'numeric',month:'short',year:'numeric'};
const clockOptions: Intl.DateTimeFormatOptions = {hour:'2-digit',minute:'2-digit',hourCycle:'h23'};
const utcDate = new Intl.DateTimeFormat('en-GB',{...dateOptions,timeZone:'UTC'});
const saDate = new Intl.DateTimeFormat('en-GB',{...dateOptions,timeZone:'Africa/Johannesburg'});
const utcClock = new Intl.DateTimeFormat('en-GB',{...clockOptions,timeZone:'UTC'});
const saClock = new Intl.DateTimeFormat('en-GB',{...clockOptions,timeZone:'Africa/Johannesburg'});

/** Format a known instant (ISO string or epoch milliseconds) for the trading UI. */
export function displayTime(value: string | number | undefined | null): string {
 if(value===undefined||value===null||value==='')return '—';
 const date=new Date(value);
 if(!Number.isFinite(date.getTime()))return '—';
 const utcDay=utcDate.format(date), localDay=saDate.format(date);
 return `${utcDay}, ${utcClock.format(date)} UTC (${utcDay===localDay?'':localDay+', '}${saClock.format(date)} SAST)`;
}
