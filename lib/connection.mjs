export async function checkAgentConnection(origin,token,{fetchImpl=fetch}={}){
 if(!origin)throw Error('The agent connection is not configured. Your case is saved; reconnect the service before starting.');
 const url=new URL(origin);if(url.protocol!=='https:'||url.username||url.password)throw Error('The agent connection requires a valid HTTPS address.');
 try{
  const response=await fetchImpl(new URL('/internal/health',url),{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(5000)});
  if(!response.ok||(await response.json()).ok!==true)throw Error('Connection check failed');
 }catch{throw Error('The agent connection is unavailable. Your case is saved. Reconnect the temporary tunnel before starting the investigation.');}
}
