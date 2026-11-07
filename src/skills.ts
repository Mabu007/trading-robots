/** User-owned plain-text/Markdown AI skills. Never execute these documents as code. */
export type UserSkill={id:string;name:string;description:string;instructions:string;triggers:string[];enabled:boolean;alwaysOn:boolean;updatedAt?:number};
export const MAX_SKILL_LENGTH=16000;
const safeId=(id:string)=>/^skill-[a-zA-Z0-9_-]{8,90}$/.test(id);
export function validateSkill(input:UserSkill):UserSkill {
 if(!safeId(input.id))throw Error('Invalid skill ID.');
 const name=input.name.trim().slice(0,80);
 const description=input.description.trim().slice(0,240);
 const instructions=input.instructions.trim();
 if(name.length<2)throw Error('Give this skill a name.');
 if(!instructions||instructions.length>MAX_SKILL_LENGTH)throw Error('Skill instructions must be 1–16,000 characters.');
 if(!Array.isArray(input.triggers)||input.triggers.length>12)throw Error('Use at most 12 skill trigger phrases.');
 const triggers=[...new Set(input.triggers.map(t=>t.trim().toLowerCase()).filter(Boolean))];
 if(triggers.some(t=>t.length>70))throw Error('Each skill trigger must be 70 characters or shorter.');
 return {id:input.id,name,description,instructions,triggers,enabled:input.enabled===true,alwaysOn:input.alwaysOn===true,updatedAt:input.updatedAt};
}
export function chooseSkills(message:string,skills:UserSkill[],max=3):UserSkill[]{
 const question=message.toLocaleLowerCase().replace(/\s+/g,' ');
 const explicit=skills.filter(s=>question.includes(s.name.toLocaleLowerCase()));
 const matched=skills.filter(s=>s.enabled&&(s.alwaysOn||s.triggers.some(term=>question.includes(term.toLowerCase()))));
 return [...new Map([...explicit.filter(s=>s.enabled),...matched].map(s=>[s.id,s])).values()].slice(0,max);
}
export function skillPrompt(message:string,skills:UserSkill[]):string{
 const chosen=chooseSkills(message,skills);
 if(!chosen.length)return '';
 const maxInstructions=5500;
 let remaining=maxInstructions;
 return chosen.map((skill,index)=>{
   const share=Math.floor(remaining/(chosen.length-index));
   const instructions=skill.instructions.slice(0,share);
   remaining-=instructions.length;
   return '\n### '+skill.name.replace(/[<>{}]/g,'')+'\n'+instructions;
 }).join('\n');
}
