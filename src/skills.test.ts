import {describe,it,expect} from 'vitest';
import {chooseSkills,skillPrompt,validateSkill,type UserSkill} from './skills';
const make=(overrides:Partial<UserSkill>={}):UserSkill=>({id:'skill-123456789',name:'Liquidity Sweeps',description:'Find sweeps',instructions:'Require confirmed swing breaks.',triggers:['liquidity sweep','sweep'],enabled:true,alwaysOn:false,...overrides});
describe('owner-authored skill selection',()=>{
 it('selects only enabled skills with relevant triggers',()=>{expect(chooseSkills('Scan liquidity sweeps today',[make()])).toHaveLength(1);expect(chooseSkills('Tell me a joke',[make()])).toHaveLength(0);expect(chooseSkills('Scan liquidity sweeps',[make({enabled:false})])).toHaveLength(0)});
 it('supports always-on guidance without changing other disabled skills',()=>expect(chooseSkills('hello',[make({alwaysOn:true})])).toHaveLength(1));
 it('rejects oversized instructions and too many triggers',()=>{expect(()=>validateSkill(make({instructions:'x'.repeat(16001)}))).toThrow();expect(()=>validateSkill(make({triggers:Array(13).fill('sweep')}))).toThrow()});
 it('bounds prompt insertion and never includes irrelevant skills',()=>{const a=skillPrompt('hello',[make({alwaysOn:true,instructions:'x'.repeat(8000)})]);expect(a.length).toBeLessThan(7001);expect(skillPrompt('hi',[make()])).toBe('')});
});
