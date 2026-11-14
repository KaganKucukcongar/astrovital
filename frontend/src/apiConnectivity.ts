export type ApiConnection = { online: boolean; consecutiveFailures: number };
export function nextApiConnection(previous: ApiConnection, receivedResponse: boolean, failureLimit=3): ApiConnection {
  if (receivedResponse) return { online:true, consecutiveFailures:0 };
  const failures=previous.consecutiveFailures+1;
  return { online:previous.online && failures<failureLimit, consecutiveFailures:failures };
}
