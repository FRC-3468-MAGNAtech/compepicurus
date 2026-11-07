// P22: who may use the Form Builder. Pure, so it can be tested without React and mirrored in firestore.rules.
//
// Owner and admin only. firestore.rules' `canManageMembers()` is `isAdmin() || isOwner()` and gates every write to `forms`, `forms/{id}/versions`
// and `teams.activeForms`, so the UI's `can('manageForms')` and the rules agree: the builder is never shown a control the rules would refuse, and
// a scout who forges a request is refused by the rules regardless of the UI. (The team owner is an admin in practice; the rule doesn't depend on it.)

export function canManageForms(who: { isAdmin?: boolean | null; isOwner?: boolean | null } | null | undefined): boolean {
  return !!who && (who.isAdmin === true || who.isOwner === true);
}
