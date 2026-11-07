export function connectedAppRequested(text:string){
 return /\b(?:composio|connected apps?|gmail|github|telegram|notion|discord|slack|google (?:drive|sheets)|googledrive|googlesheets)\b/i.test(text)
  || /\b(?:send|post|export|upload|read|fetch|sync|append|write|create|update)\b.{0,110}\b(?:to|from|in|on)\s+(?:my|our|the connected)\s+[\w-]+/i.test(text);
}
