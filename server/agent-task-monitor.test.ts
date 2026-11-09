import {describe,it,expect} from 'vitest';
import {summarizeDeploymentState} from './agent-task-monitor.ts';
describe('agent task read-only broker observation',()=>{
 it('does not claim empty exposure, stopped or healthy on an incomplete read',()=>{
  const result=summarizeDeploymentState({running:false,configured:false,connected:false,brokerExposure:'flat'},0);
  expect(result).toMatchObject({available:false,running:null,brokerExposure:'unknown',uncertain:true,brokerExposureVerified:false});
 });
 it('projects separately verified broker exposure and runtime grant',()=>{
  const codeHash='a'.repeat(64);
  expect(summarizeDeploymentState({configured:true,connected:true,uncertain:false,statusUnavailable:false,
   running:true,paused:false,activeAuthorization:true,brokerExposure:'open',brokerExposureVerified:true,codeHash},0))
   .toMatchObject({available:true,running:true,brokerExposure:'open',authorizationActive:true,codeHash});
 });
 it('rejects forged flat exposure without broker verification even if runtime is running',()=>{
  expect(summarizeDeploymentState({configured:true,connected:true,running:true,brokerExposure:'flat',
   brokerExposureVerified:false},0).brokerExposure).toBe('unknown');
 });
});
