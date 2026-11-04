// Both account aliases, when supplied, must agree. A known profile must be
// present in the signed body; sandbox/unresolved-profile events fail closed.
export function matchesZernioScope(payload, scope) {
  const account=payload?.account;
  if(!account||typeof account!=='object'||Array.isArray(account))return false;
  const identities=[account.accountId,account.id].filter(value=>value!==undefined);
  if(!identities.length||identities.some(value=>value!==scope.accountId))return false;
  if(account.platform!==undefined&&account.platform!=='whatsapp')return false;
  const profiles=payload.profiles;
  if(profiles!==undefined&&(!Array.isArray(profiles)||profiles.length!==1||profiles[0]?.id!==scope.profileId))return false;
  return account.profileId===scope.profileId || (account.profileId===undefined&&profiles?.[0]?.id===scope.profileId);
}
