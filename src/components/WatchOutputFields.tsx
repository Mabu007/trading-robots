export type MonitorOutput={type:'log'}|{type:'ai'};

export function WatchOutputFields({value,onChange}:{value:MonitorOutput;onChange:(value:MonitorOutput)=>void}){
 return <>
  <label>On detection <select aria-label="Monitor output" value={value.type} onChange={event=>onChange({type:event.currentTarget.value==='ai'?'ai':'log'})}>
   <option value="log">Record detection</option><option value="ai">Summarize with AI</option>
  </select></label>
  {value.type==='ai'&&<p>Your connected OpenRouter model can summarize qualifying detections at most once every 15 minutes.</p>}
 </>;
}
