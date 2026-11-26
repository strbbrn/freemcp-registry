// Use the same lifecycle copy in the initial HTML and after the GitHub request.
export function lifecycleDisplay(registryArchived, repositoryStatus, lastChecked = false) {
  const repositoryArchived = repositoryStatus === 'Archived';
  const repositoryDisabled = repositoryStatus === 'Disabled';
  const badge = repositoryDisabled ? 'Repository disabled' :
    registryArchived || repositoryArchived ? 'Archived' : '';
  const repositoryLabel = repositoryStatus
    ? repositoryStatus + (lastChecked ? ' (last checked)' : '')
    : 'Unavailable';

  const messages = [];
  if (registryArchived) messages.push('FreeMCP lists this implementation as archived.');
  if (repositoryArchived || repositoryDisabled) {
    const source = lastChecked ? 'At the last check, GitHub reported' : 'GitHub reports';
    messages.push(source + ' that this repository is ' + repositoryStatus.toLowerCase() + '.');
  }

  return {
    badge,
    repositoryLabel,
    warningTitle: repositoryDisabled ? badge :
      registryArchived ? 'Archived implementation' : repositoryArchived ? 'Archived repository' : '',
    warning: messages.length ? [...messages, 'Review maintained alternatives before installing.'].join(' ') : '',
  };
}
