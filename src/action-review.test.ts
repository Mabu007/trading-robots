import {it,expect} from 'vitest';
import {createActionReview,consumeActionReview} from './action-review';
const identity={uid:'alice',botId:'agent',code:'v1',venue:'propdao'};
it('consumes a review once',()=>{const r=createActionReview(identity,0);expect(consumeActionReview(r,identity,1)).toBe(true);expect(consumeActionReview(r,identity,1)).toBe(false)});
it('rejects expiry and identity/code changes',()=>{expect(consumeActionReview(createActionReview(identity,0),identity,120000)).toBe(false);for(const k of Object.keys(identity))expect(consumeActionReview(createActionReview(identity,0),{...identity,[k]:'different'},1)).toBe(false)});
