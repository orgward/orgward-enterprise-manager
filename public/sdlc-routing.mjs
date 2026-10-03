// A linked case selects that exact saved case or leaves the workspace unselected.
export async function openInitialCase({ search, cases, loadCase, showWelcome, notify }) {
  const requestedCase = new URLSearchParams(search).get('case');
  if (requestedCase !== null) {
    if (cases.some((entry) => entry.id === requestedCase)) {
      await loadCase(requestedCase);
      return { state: 'opened', caseId: requestedCase };
    }
    showWelcome();
    notify('The linked change case is unavailable to your current identity. Choose an available case.');
    return { state: 'unavailable', caseId: requestedCase };
  }
  if (cases.length) {
    await loadCase(cases[0].id);
    return { state: 'opened', caseId: cases[0].id };
  }
  showWelcome();
  return { state: 'welcome', caseId: null };
}
