import {beforeEach,describe,expect,it,vi} from 'vitest';
import {mergePracticeHistory,readLocalHistory,saveLocalHistory,syncPracticeHistory,type PracticeRecord} from './practice-history';
const record:PracticeRecord={id:'attempt-1',kind:'sweep',day:'2026-11-10',completedAt:'2026-11-14T10:00:00.000Z',candlesViewed:12,tradeCount:0,net:0,notes:'I waited.'};
const memory=new Map<string,string>();
beforeEach(()=>{memory.clear();vi.stubGlobal('localStorage',{getItem:(key:string)=>memory.get(key)??null,setItem:(key:string,value:string)=>memory.set(key,value)})});
describe('practice history',()=>{
 it('keeps a no-trade session isolated to its owner and retries the same ID',async()=>{
  saveLocalHistory('alice',record);expect(readLocalHistory('bob')).toEqual([]);
  const save=vi.fn().mockRejectedValueOnce(Error('offline')).mockResolvedValueOnce(undefined);
  await expect(syncPracticeHistory('alice',{savePracticeRecord:save})).rejects.toThrow('offline');
  expect(readLocalHistory('alice')[0].synced).toBe(false);
  await syncPracticeHistory('alice',{savePracticeRecord:save});
  expect(readLocalHistory('alice')[0].synced).toBe(true);
  expect(save).toHaveBeenCalledTimes(2);
  expect(mergePracticeHistory(readLocalHistory('alice'),[record])).toHaveLength(1);
 });
 it('prefers unsynced local changes to an older cloud record',()=>{
  saveLocalHistory('alice',{...record,notes:'Updated reflection'});
  expect(mergePracticeHistory(readLocalHistory('alice'),[record])[0].notes).toBe('Updated reflection');
 });
});
