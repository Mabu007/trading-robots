/** Explain every broker-review prerequisite rather than rendering an inert button.
 * The server is still the final authority on source, account, risk and history.
 */
export type DeploymentPreflight={
 accountId:string;
 accountStatus:string|null;
 configured:boolean;
 connected?:boolean;
 statusUnavailable?:boolean;
 uncertain?:boolean;
 running?:boolean;
 paused?:boolean;
 pendingIntent?:unknown;
 accountOccupied?:boolean;
};
export function deploymentPreflightReason(state:DeploymentPreflight):string|null{
 if(!state.accountId)return 'Choose a PropDAO account. Connect your own demo account if none is listed.';
 if(!state.accountStatus)return 'The selected account is missing from your authenticated account list. Refresh status.';
 if(!['active','funded'].includes(state.accountStatus.toLowerCase()))
  return 'This PropDAO account is not active or funded. Choose an eligible demo or evaluation account.';
 if(state.running||state.paused)return 'This robot already has a live or paused authorization. Inspect and stop it before deploying a revision.';
 if(state.pendingIntent)return 'An unresolved broker order intent blocks deployment. Reconcile the account before continuing.';
 if(state.accountOccupied)return 'This PropDAO account is running a different robot. Inspect the account before deploying.';
 if(state.uncertain||state.statusUnavailable)return 'The Worker or broker state is unverified. Refresh runtime status before deploying; exposure may be unknown.';
 if(!state.configured)return 'The PropDAO Cloudflare runtime is not enabled or healthy. Refresh status or ask the administrator to check its Worker connection.';
 return null;
}
