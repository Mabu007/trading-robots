import { replayStep, type ReplayBar, type ReplayCosts, type ReplaySession } from './market-replay-engine';

/** Snapshots record user decisions, not unrevealed market data. The future branch
 * stays available until the user changes a decision at the rewound cursor. */
export type ReplayTimeline={origin:ReplaySession;decisions:ReplaySession[]};
export const newReplayTimeline=(state:ReplaySession):ReplayTimeline=>({origin:state,decisions:[]});
export function recordReplayDecision(timeline:ReplayTimeline,state:ReplaySession):ReplayTimeline{
 if(state.index<timeline.origin.index)throw Error('Decision is before the replay boundary.');
 return {...timeline,decisions:[...timeline.decisions.filter(item=>item.index<state.index),state]};
}
export function replayTo(timeline:ReplayTimeline,index:number,bars:ReplayBar[],costs:ReplayCosts):ReplaySession{
 if(!Number.isInteger(index)||index<timeline.origin.index||index>=bars.length)throw Error('Replay cursor is outside the session.');
 const candidates=timeline.decisions.filter(s=>s.index<=index);
 let state=candidates.at(-1)||timeline.origin;
 while(state.index<index){const next=replayStep(state,bars,costs);if(next.index===state.index)break;state=next;}
 return state;
}
